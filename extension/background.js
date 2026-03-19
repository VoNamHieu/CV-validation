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

    if (message.type === 'GET_APP_URL') {
        chrome.storage.local.get('jobfitAppUrl', (data) => {
            sendResponse({ url: data.jobfitAppUrl || 'http://localhost:3000' });
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
                const appUrl = data.jobfitAppUrl || 'http://localhost:3000';

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
                const appUrl = data.jobfitAppUrl || 'http://localhost:3000';

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
        chrome.storage.local.set({ applyQueue, isProcessing: true });

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
        chrome.storage.local.remove(['applyQueue', 'isProcessing']);
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
            chrome.storage.local.set({ applyQueue });

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
        chrome.storage.local.set({ applyQueue, isProcessing: false });
        broadcastProgress();
        return;
    }

    const job = applyQueue[currentJobIndex];
    job.status = 'processing';
    chrome.storage.local.set({ applyQueue });

    console.log(`[JobFit AI] Batch Apply: processing job ${currentJobIndex + 1}/${applyQueue.length} — ${job.jobUrl}`);

    // Save profile for this specific job + set pending flag
    chrome.storage.local.set({
        jobfitProfile: job.profile,
        pendingAutoApply: true,
        autoApplyJobUrl: job.jobUrl,
        batchMode: true,
    }, () => {
        // Open the job URL in a new tab
        chrome.tabs.create({ url: job.jobUrl, active: true }, (tab) => {
            currentTabId = tab.id;
            broadcastProgress();

            // Safety timeout: if content script doesn't report back in 60s, skip
            setTimeout(() => {
                if (isProcessing && currentJobIndex < applyQueue.length &&
                    applyQueue[currentJobIndex]?.status === 'processing') {
                    console.warn(`[JobFit AI] Batch Apply: timeout for job ${currentJobIndex + 1}, skipping`);
                    applyQueue[currentJobIndex].status = 'error';
                    applyQueue[currentJobIndex].result = { success: false, detail: 'Timeout — page did not respond' };
                    chrome.storage.local.set({ applyQueue });
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
            chrome.storage.local.set({ applyQueue });
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

// ─── Install event ───
chrome.runtime.onInstalled.addListener(() => {
    console.log('[JobFit AI] Extension installed!');
    // Clear any stale queue
    chrome.storage.local.remove(['applyQueue', 'isProcessing', 'pendingAutoApply', 'autoApplyJobUrl', 'batchMode']);
});
