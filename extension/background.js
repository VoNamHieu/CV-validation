/**
 * JobFit AI — Auto Apply Extension — Background Service Worker
 * Handles: single apply, batch apply queue, extension communication
 */

// ─── Job Queue State ───
let applyQueue = [];       // [{jobUrl, profile, jobTitle, company}, ...]
let currentJobIndex = -1;
let currentTabId = null;
let isProcessing = false;
const TAB_DELAY_MS = 3000; // Delay between opening tabs

// ─── Restore in-flight state on service-worker wake (MV3 kills idle SWs) ───
chrome.storage.local.get(['applyQueue', 'isProcessing', 'currentJobIndex', 'currentTabId'], (data) => {
    if (data.isProcessing && Array.isArray(data.applyQueue) && data.applyQueue.length > 0) {
        applyQueue = data.applyQueue;
        isProcessing = data.isProcessing;
        currentJobIndex = typeof data.currentJobIndex === 'number' ? data.currentJobIndex : -1;
        currentTabId = data.currentTabId ?? null;
        console.log('[JobFit AI] SW woke — restored batch state:', {
            queue: applyQueue.length, currentJobIndex, currentTabId,
        });
    }
});

function persistState() {
    chrome.storage.local.set({ applyQueue, isProcessing, currentJobIndex, currentTabId });
}

// ─── Listen for external messages from JobFit AI web app ───
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (message.type === 'JOBFIT_EXPORT_PROFILE') {
        chrome.storage.local.set({ jobfitProfile: message.profile }, () => {
            sendResponse({ success: true });
            chrome.runtime.sendMessage({ type: 'PROFILE_UPDATED' }).catch(() => { });
        });
        return true;
    }

    // Single auto-apply (legacy)
    if (message.type === 'AUTO_APPLY_START') {
        const { jobUrl, profile } = message;
        if (!jobUrl || !profile) {
            sendResponse({ success: false, error: 'Missing jobUrl or profile' });
            return true;
        }
        chrome.storage.local.set({
            jobfitProfile: profile,
            pendingAutoApply: true,
            autoApplyJobUrl: jobUrl,
        }, () => {
            chrome.tabs.create({ url: jobUrl, active: true }, (tab) => {
                console.log('[JobFit AI] Auto Apply: opened tab', tab.id, 'for', jobUrl);
                sendResponse({ success: true, tabId: tab.id });
            });
        });
        return true;
    }

    // Ping check
    if (message.type === 'JOBFIT_PING') {
        sendResponse({ success: true, version: chrome.runtime.getManifest().version });
        return true;
    }
});

// ─── Listen for internal messages (content scripts + popup) ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // ── Profile management ──
    if (message.type === 'GET_PROFILE') {
        chrome.storage.local.get('jobfitProfile', (data) => {
            sendResponse({ profile: data.jobfitProfile || null });
        });
        return true;
    }

    if (message.type === 'SAVE_PROFILE') {
        chrome.storage.local.set({ jobfitProfile: message.profile }, () => {
            sendResponse({ success: true });
        });
        return true;
    }

    // Sync generated CV PDF from the web app into extension storage so the
    // agent can upload it without the user manually using the popup.
    if (message.type === 'SYNC_CV_FILE') {
        const { cvFileBase64, cvFileName } = message;
        if (!cvFileBase64 || !cvFileName) {
            sendResponse({ success: false, error: 'Missing cvFileBase64 or cvFileName' });
            return true;
        }
        chrome.storage.local.set({ cvFileBase64, cvFileName }, () => {
            sendResponse({ success: true });
        });
        return true;
    }

    if (message.type === 'GET_APP_URL') {
        chrome.storage.local.get('jobfitAppUrl', (data) => {
            sendResponse({ url: data.jobfitAppUrl || 'https://cv-validation.vercel.app' });
        });
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    // ── LLM PROXY — content scripts can't fetch localhost (CORS) ──
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'PROXY_LLM_MAP_FORM') {
        const { formFields, profileData } = message;
        (async () => {
            try {
                const data = await chrome.storage.local.get('jobfitAppUrl');
                const appUrl = data.jobfitAppUrl || 'https://cv-validation.vercel.app';

                // Try Vercel first, then localhost
                const urls = [
                    appUrl,
                    appUrl.includes('localhost') ? null : 'http://localhost:3000',
                ].filter(Boolean);

                let lastError = null;
                for (const baseUrl of urls) {
                    try {
                        const res = await fetch(`${baseUrl}/api/ai/map-form`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ formFields, profileData }),
                            signal: AbortSignal.timeout(30000),
                        });
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            throw new Error(err.detail || `API error: ${res.status}`);
                        }
                        const result = await res.json();
                        sendResponse({ success: true, data: result });
                        return;
                    } catch (e) {
                        lastError = e;
                        console.warn(`[JobFit AI] LLM proxy failed for ${baseUrl}:`, e.message);
                    }
                }
                sendResponse({ success: false, error: lastError?.message || 'All endpoints failed' });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true; // async response
    }

    // ══════════════════════════════════════════════════════════════
    // ── LLM PROXY — Agent Plan (agentic loop brain) ──
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'PROXY_LLM_AGENT_PLAN') {
        const { pageState, profileData, history, hasCV } = message;
        (async () => {
            try {
                const data = await chrome.storage.local.get('jobfitAppUrl');
                const appUrl = data.jobfitAppUrl || 'https://cv-validation.vercel.app';

                const urls = [
                    appUrl,
                    appUrl.includes('localhost') ? null : 'http://localhost:3000',
                ].filter(Boolean);

                let lastError = null;
                for (const baseUrl of urls) {
                    try {
                        const res = await fetch(`${baseUrl}/api/ai/agent-plan`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ pageState, profileData, history, hasCV }),
                            signal: AbortSignal.timeout(30000),
                        });
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            throw new Error(err.detail || `API error: ${res.status}`);
                        }
                        const result = await res.json();
                        sendResponse({ success: true, data: result });
                        return;
                    } catch (e) {
                        lastError = e;
                        console.warn(`[JobFit AI] Agent plan proxy failed for ${baseUrl}:`, e.message);
                    }
                }
                sendResponse({ success: false, error: lastError?.message || 'All endpoints failed' });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    // ── EXT_CRAWL — Crawl a URL by opening a background tab. ──
    //    Used by the web app as a Cloudflare bypass: when the Railway
    //    backend's Playwright fetch is blocked, we open the page in the
    //    user's own browser (residential IP, real Chrome) and scrape it
    //    via chrome.scripting.executeScript.
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'EXT_CRAWL') {
        const { url } = message;
        if (!url) {
            sendResponse({ success: false, error: 'Missing url' });
            return true;
        }
        extCrawl(url).then(sendResponse).catch((e) => {
            sendResponse({ success: false, error: e?.message || String(e) });
        });
        return true; // async
    }

    // ══════════════════════════════════════════════════════════════
    // ── BATCH AUTO APPLY — Start processing a queue of jobs ──
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'AUTO_APPLY_ALL_START') {
        const { jobs } = message; // [{jobUrl, profile, jobTitle, company}, ...]
        if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
            sendResponse({ success: false, error: 'No jobs provided' });
            return true;
        }

        if (isProcessing) {
            sendResponse({ success: false, error: 'Already processing a batch' });
            return true;
        }

        console.log(`[JobFit AI] Batch Apply: starting ${jobs.length} jobs`);

        // Initialize queue
        applyQueue = jobs.map((job, idx) => ({
            ...job,
            index: idx,
            status: 'pending', // pending | processing | done | error
            result: null,
        }));
        currentJobIndex = -1;
        isProcessing = true;

        // Save queue to storage for persistence
        persistState();

        // Notify web app
        broadcastProgress();

        // Start processing first job
        processNextJob();

        sendResponse({ success: true, totalJobs: jobs.length });
        return true;
    }

    // ── Cancel batch ──
    if (message.type === 'AUTO_APPLY_ALL_CANCEL') {
        console.log('[JobFit AI] Batch Apply: cancelled by user');
        isProcessing = false;
        applyQueue = [];
        currentJobIndex = -1;
        currentTabId = null;
        chrome.storage.local.remove(['applyQueue', 'isProcessing', 'currentJobIndex', 'currentTabId']);
        broadcastProgress();
        sendResponse({ success: true });
        return true;
    }

    // ── Get batch progress ──
    if (message.type === 'GET_APPLY_PROGRESS') {
        sendResponse({
            isProcessing,
            queue: applyQueue,
            currentIndex: currentJobIndex,
            total: applyQueue.length,
            completed: applyQueue.filter(j => j.status === 'done' || j.status === 'error').length,
        });
        return true;
    }

    // ── Content script reports single auto-apply result ──
    if (message.type === 'AUTO_APPLY_RESULT') {
        console.log('[JobFit AI] Auto Apply result:', message.result);

        // If this is part of a batch, update queue and continue
        if (isProcessing && currentJobIndex >= 0 && currentJobIndex < applyQueue.length) {
            applyQueue[currentJobIndex].status = message.result?.success ? 'done' : 'error';
            applyQueue[currentJobIndex].result = message.result;
            persistState();

            // Broadcast progress update to web app
            broadcastProgress();

            // Process next job after a delay
            setTimeout(() => processNextJob(), TAB_DELAY_MS);
        } else {
            // Single apply (not batch)
            chrome.storage.local.remove(['pendingAutoApply', 'autoApplyJobUrl']);
        }

        sendResponse({ success: true });
        return true;
    }
});

// ─── Process next job in queue ───
function processNextJob() {
    if (!isProcessing) return;

    currentJobIndex++;

    if (currentJobIndex >= applyQueue.length) {
        // All done!
        console.log('[JobFit AI] Batch Apply: all jobs completed!');
        isProcessing = false;
        currentTabId = null;
        persistState();
        broadcastProgress();
        return;
    }

    const job = applyQueue[currentJobIndex];
    job.status = 'processing';
    persistState();

    console.log(`[JobFit AI] Batch Apply: processing job ${currentJobIndex + 1}/${applyQueue.length} — ${job.jobUrl}`);

    // Save profile + (optional) per-job CV file for this specific job + set pending flag
    const storage = {
        jobfitProfile: job.profile,
        pendingAutoApply: true,
        autoApplyJobUrl: job.jobUrl,
        batchMode: true,
    };
    if (job.cvFileBase64 && job.cvFileName) {
        storage.cvFileBase64 = job.cvFileBase64;
        storage.cvFileName = job.cvFileName;
    }
    chrome.storage.local.set(storage, () => {
        // Open the job URL in a new tab
        chrome.tabs.create({ url: job.jobUrl, active: true }, (tab) => {
            currentTabId = tab.id;
            persistState();
            broadcastProgress();

            // Safety timeout: if content script doesn't report back in 60s, skip
            setTimeout(() => {
                if (isProcessing && currentJobIndex < applyQueue.length &&
                    applyQueue[currentJobIndex]?.status === 'processing') {
                    console.warn(`[JobFit AI] Batch Apply: timeout for job ${currentJobIndex + 1}, skipping`);
                    applyQueue[currentJobIndex].status = 'error';
                    applyQueue[currentJobIndex].result = { success: false, detail: 'Timeout — page did not respond' };
                    persistState();
                    broadcastProgress();
                    processNextJob();
                }
            }, 60000);
        });
    });
}

// ─── Broadcast progress to all content scripts (web app) ───
function broadcastProgress() {
    const progress = {
        type: 'JOBFIT_APPLY_PROGRESS',
        isProcessing,
        queue: applyQueue.map(j => ({
            jobUrl: j.jobUrl,
            jobTitle: j.jobTitle,
            company: j.company,
            status: j.status,
            result: j.result,
        })),
        currentIndex: currentJobIndex,
        total: applyQueue.length,
        completed: applyQueue.filter(j => j.status === 'done' || j.status === 'error').length,
        successful: applyQueue.filter(j => j.status === 'done').length,
    };

    // Send to all tabs that have content scripts
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, progress).catch(() => { });
        }
    });
}

// ─── Handle tab closed — if current processing tab is closed, skip to next ───
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === currentTabId && isProcessing && currentJobIndex < applyQueue.length) {
        if (applyQueue[currentJobIndex]?.status === 'processing') {
            console.log('[JobFit AI] Batch Apply: tab closed, marking as error and continuing');
            applyQueue[currentJobIndex].status = 'error';
            applyQueue[currentJobIndex].result = { success: false, detail: 'Tab was closed' };
            persistState();
            broadcastProgress();
            setTimeout(() => processNextJob(), 1000);
        }
    }
});

// ─── Badge: show active status ───
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        const isSupported = tab.url.includes('vietnamworks.com') || tab.url.includes('topcv.vn');
        if (isSupported) {
            chrome.action.setBadgeText({ text: '⚡', tabId });
            chrome.action.setBadgeBackgroundColor({ color: '#7C3AED', tabId });
        }
    }
});

// ─── Show batch count on badge ───
function updateBadge() {
    if (isProcessing) {
        const done = applyQueue.filter(j => j.status === 'done' || j.status === 'error').length;
        chrome.action.setBadgeText({ text: `${done}/${applyQueue.length}` });
        chrome.action.setBadgeBackgroundColor({ color: '#7C3AED' });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
}

// ═══════════════════════════════════════════════════════════════════════
// ─── EXT_CRAWL implementation ───
// Opens a background tab, waits for Cloudflare's JS challenge (if any)
// to auto-resolve in the user's real browser, scrapes content, closes tab.
// ═══════════════════════════════════════════════════════════════════════

const EXT_CRAWL_TAB_LOAD_TIMEOUT = 30000;  // max time waiting for tabs.onUpdated complete
const EXT_CRAWL_CHALLENGE_TIMEOUT = 25000; // max time for challenge to clear after load
const EXT_CRAWL_POLL_INTERVAL = 1500;

function _waitForTabComplete(tabId, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('Tab load timed out'));
        }, timeoutMs);
        const listener = (id, info) => {
            if (id === tabId && info.status === 'complete') {
                clearTimeout(timer);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}

// Runs inside the target page. Returns content + whether the page still
// looks like an anti-bot challenge so the background script can keep polling.
function _extractPageContent() {
    const title = document.title || '';
    const bodyText = (document.body && document.body.innerText) || '';
    const looksLikeChallenge =
        /just a moment|attention required|checking your browser|verifying you are human/i.test(title)
        || /attention required! \| cloudflare|cf-browser-verification|cf-error-details|ray id:/i
            .test(bodyText.slice(0, 2000));

    const html = document.documentElement ? document.documentElement.outerHTML : '';
    const text = bodyText.slice(0, 50000);

    // Build a compact text-with-links representation so the AI extractor on
    // the frontend can find job URLs even though the first 20KB of raw HTML
    // would be mostly <head>/scripts/CSS noise.
    // Mirrors the backend's /api/crawl-url ?keepLinks=true logic.
    let textWithLinks = '';
    try {
        textWithLinks = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(
                /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
                (_, href, innerText) => {
                    const cleanInner = innerText.replace(/<[^>]+>/g, '').trim();
                    return `[LINK:${href}] ${cleanInner} [/LINK]`;
                }
            )
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 25000);
    } catch (_) { /* fall back to empty */ }

    let jsonLd = null;
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const el of scripts) {
        try {
            const parsed = JSON.parse(el.textContent || 'null');
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
                if (item && item['@type'] === 'JobPosting') {
                    jsonLd = item;
                    break;
                }
            }
            if (jsonLd) break;
        } catch (_) { /* ignore */ }
    }

    return { html, text, textWithLinks, jsonLd, title, looksLikeChallenge };
}

async function extCrawl(url) {
    let tabId = null;
    try {
        const tab = await chrome.tabs.create({ url, active: false });
        tabId = tab.id;
        console.log(`[JobFit AI] EXT_CRAWL: opened background tab ${tabId} for ${url}`);

        // Wait for initial load (Cloudflare challenge page may load first)
        try {
            await _waitForTabComplete(tabId, EXT_CRAWL_TAB_LOAD_TIMEOUT);
        } catch (e) {
            console.warn(`[JobFit AI] EXT_CRAWL: initial load timeout — continuing to poll`);
        }

        // Poll until the page no longer looks like a challenge, OR timeout.
        // Real Chrome auto-solves Cloudflare's JS challenge in ~5s.
        const deadline = Date.now() + EXT_CRAWL_CHALLENGE_TIMEOUT;
        let last = null;
        let pollIdx = 0;
        while (Date.now() < deadline) {
            try {
                const [{ result }] = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: _extractPageContent,
                });
                last = result;

                // ── DEBUG: dump what we actually got so we can tell whether
                //    a "successful" 25k-char return is real content or a soft
                //    anti-bot page that our looksLikeChallenge regex missed.
                const hasTopCVJobLinks = /\/viec-lam\/[^"\s]+\.html/.test(result?.html || '');
                const hasVNWJobLinks = /-jv(?:["\/]|$)/.test(result?.html || '');
                console.log(`[JobFit AI] EXT_CRAWL DEBUG poll #${pollIdx}`, {
                    url,
                    title: result?.title,
                    textLen: result?.text?.length || 0,
                    htmlLen: result?.html?.length || 0,
                    looksLikeChallenge: result?.looksLikeChallenge,
                    hasTopCVJobLinks,
                    hasVNWJobLinks,
                    firstChars: (result?.text || '').slice(0, 300),
                });
                pollIdx++;

                if (result && !result.looksLikeChallenge && (result.text?.length || 0) >= 200) {
                    console.log(`[JobFit AI] EXT_CRAWL: extracted ${result.text.length} chars from ${url}`);
                    return {
                        success: true,
                        text: result.text,
                        textWithLinks: result.textWithLinks,
                        html: result.html,
                        jsonLd: result.jsonLd,
                        method: 'extension',
                    };
                }
            } catch (e) {
                console.warn(`[JobFit AI] EXT_CRAWL: executeScript error:`, e.message);
            }
            await new Promise(r => setTimeout(r, EXT_CRAWL_POLL_INTERVAL));
        }

        // Timed out. If we ever got content but it was a challenge, return blocked.
        const blocked = !!(last && last.looksLikeChallenge);
        console.log(`[JobFit AI] EXT_CRAWL DEBUG timeout`, {
            url,
            blocked,
            finalTitle: last?.title,
            finalTextLen: last?.text?.length || 0,
            finalFirstChars: (last?.text || '').slice(0, 300),
        });
        return {
            success: false,
            blocked,
            error: blocked
                ? 'Anti-bot challenge did not auto-resolve. The site may require manual interaction.'
                : 'Extension crawl produced no usable content.',
        };
    } catch (e) {
        return { success: false, error: e?.message || String(e) };
    } finally {
        if (tabId != null) {
            chrome.tabs.remove(tabId).catch(() => { });
        }
    }
}

// ─── Install event ───
chrome.runtime.onInstalled.addListener(() => {
    console.log('[JobFit AI] Extension installed!');
    // Clear any stale queue
    chrome.storage.local.remove([
        'applyQueue', 'isProcessing', 'currentJobIndex', 'currentTabId',
        'pendingAutoApply', 'autoApplyJobUrl', 'batchMode',
    ]);
});
