/**
 * Copo — Auto Apply Extension — Background Service Worker
 * Handles: single apply, batch apply queue, extension communication
 */

// ─── Job Queue State ───
let applyQueue = [];       // [{jobUrl, profile, jobTitle, company}, ...]
let currentJobIndex = -1;
let currentTabId = null;
let isProcessing = false;
let jobSafetyTimer = null;  // per-job watchdog handle, re-armed by agent heartbeats
let jobStartedAt = 0;       // when the current job's tab was opened
const TAB_DELAY_MS = 3000; // Delay between opening tabs

// Watchdog window. One agent iteration can legitimately take a minute+ (LLM
// call up to 30s, scroll passes, post-action waits), so a fixed short timeout
// would kill healthy jobs. The agent sends AUTO_APPLY_HEARTBEAT every
// iteration; the timer only fires if the page goes silent for a full window.
const JOB_SAFETY_WINDOW_MS = 120000;
// Absolute ceiling per job — heartbeats stop extending past this point so a
// looping page can't hold the queue hostage.
const JOB_HARD_CAP_MS = 15 * 60 * 1000;

// ─── Restore in-flight state on service-worker wake (MV3 kills idle SWs) ───
chrome.storage.local.get(['applyQueue', 'isProcessing', 'currentJobIndex', 'currentTabId', 'jobStartedAt'], (data) => {
    if (data.isProcessing && Array.isArray(data.applyQueue) && data.applyQueue.length > 0) {
        applyQueue = data.applyQueue;
        isProcessing = data.isProcessing;
        currentJobIndex = typeof data.currentJobIndex === 'number' ? data.currentJobIndex : -1;
        currentTabId = data.currentTabId ?? null;
        jobStartedAt = typeof data.jobStartedAt === 'number' ? data.jobStartedAt : Date.now();
        console.log('[Copo] SW woke — restored batch state:', {
            queue: applyQueue.length, currentJobIndex, currentTabId,
        });
        // The timer died with the old SW. Re-arm it so a tab that crashed
        // while we slept can't leave the queue stuck forever.
        if (currentJobIndex >= 0 && applyQueue[currentJobIndex]?.status === 'processing') {
            armJobSafetyTimer(currentJobIndex);
        }
    }
});

function persistState() {
    chrome.storage.local.set({ applyQueue, isProcessing, currentJobIndex, currentTabId, jobStartedAt });
}

// ─── Per-job watchdog ───
function armJobSafetyTimer(timedJobIndex) {
    if (jobSafetyTimer) clearTimeout(jobSafetyTimer);
    jobSafetyTimer = setTimeout(() => {
        if (isProcessing && timedJobIndex === currentJobIndex &&
            applyQueue[timedJobIndex]?.status === 'processing') {
            console.warn(`[Copo] Batch Apply: timeout for job ${timedJobIndex + 1}, skipping`);
            applyQueue[timedJobIndex].status = 'error';
            applyQueue[timedJobIndex].result = { success: false, detail: 'Timeout — page did not respond' };
            persistState();
            broadcastProgress();
            processNextJob();
        }
    }, JOB_SAFETY_WINDOW_MS);
}

// ─── Optional host-permission gating ───────────────────────────────────────
// The manifest ships a NARROW host_permissions allowlist (known job boards +
// ATS platforms) so the install-time warning reads "đọc dữ liệu trên các trang
// tuyển dụng đã biết" instead of "…mọi trang web". Any other site is covered
// by optional_host_permissions ("https://*/*") and must be granted just-in-time.
//
// Known hosts get the content-agent via the declarative content_scripts entry.
// On a freshly granted UNKNOWN host there's no declarative match, so we inject
// the agent programmatically (chrome.scripting) after the tab loads.

// Mirror of manifest content_scripts.matches — these auto-inject, no grant needed.
const KNOWN_HOST_RE = /(^|\.)(topcv\.vn|vietnamworks\.com|itviec\.com|careerbuilder\.vn|careerlink\.vn|careerviet\.vn|vieclam24h\.vn|linkedin\.com|lever\.co|greenhouse\.io|ashbyhq\.com|myworkdayjobs\.com|smartrecruiters\.com|icims\.com|taleo\.net|jobvite\.com|breezy\.hr|bamboohr\.com|workable\.com|recruitee\.com|teamtailor\.com)$/i;

function originPattern(url) {
    try { return `${new URL(url).origin}/*`; } catch (e) { return null; }
}
function isKnownHost(url) {
    try { return KNOWN_HOST_RE.test(new URL(url).hostname); } catch (e) { return false; }
}

// Ensure the agent is allowed to run on `url`. Known hosts: always. Unknown
// hosts: check the optional grant and, if missing, request it just-in-time with
// a clear reason. NOTE: chrome.permissions.request() needs a user gesture; mid-
// batch in the service worker that gesture is usually absent, so the request is
// best-effort — if it rejects, the job is skipped with a "needs permission"
// result and the user can grant it from the popup ("Cho phép trên trang này").
async function ensureHostAccess(url) {
    if (isKnownHost(url)) return { ok: true, known: true };
    const pattern = originPattern(url);
    if (!pattern) return { ok: false, known: false };
    const has = await chrome.permissions.contains({ origins: [pattern] }).catch(() => false);
    if (has) return { ok: true, known: false };
    try {
        // "Trang này dùng hệ thống tuyển dụng chưa nhận diện — Copo cần quyền
        //  truy cập để điền form tự động." (the Chrome dialog shows the origin)
        const granted = await chrome.permissions.request({ origins: [pattern] });
        return { ok: granted, known: false };
    } catch (e) {
        return { ok: false, known: false, gestureRequired: true };
    }
}

// Inject the agent into a granted UNKNOWN host once the tab finishes loading
// (known hosts already have it via the declarative content script).
function injectAgentOnLoad(tabId) {
    const listener = (id, info) => {
        if (id !== tabId || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] }).catch(() => { });
        chrome.scripting.executeScript({ target: { tabId }, files: ['utils.js', 'content-agent.js'] })
            .catch((e) => console.warn('[Copo] inject agent failed:', e?.message || e));
    };
    chrome.tabs.onUpdated.addListener(listener);
}

// ─── Credit metering ────────────────────────────────────────────────────────
// Charge the user for an LLM-backed action via the web app's /api/credits/spend
// (server prices the action; we just name it). Auth = the JWT the web app synced
// into storage (jobfitToken). Returns:
//   { ok: true }                        — charged, proceed
//   { ok: false, insufficient: true }   — out of credits (HTTP 402)
//   { ok: false, auth: true }           — no/expired token (re-sync from web app)
//   { ok: false }                       — transient/other (fail-open: don't block)
async function extSpend(action, units = 1) {
    const { jobfitAppUrl, jobfitToken } = await chrome.storage.local.get(['jobfitAppUrl', 'jobfitToken']);
    if (!jobfitToken) return { ok: false, auth: true };
    const appUrl = jobfitAppUrl || 'https://copoai.net';
    try {
        const res = await fetch(`${appUrl}/api/credits/spend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jobfitToken}` },
            body: JSON.stringify({ action, units }),
        });
        if (res.ok) return { ok: true };
        if (res.status === 402) return { ok: false, insufficient: true };
        if (res.status === 401) return { ok: false, auth: true };
        return { ok: false }; // unexpected — fail open so a billing hiccup can't block applies
    } catch (e) {
        console.warn('[Copo] credit spend failed (fail-open):', e?.message || e);
        return { ok: false }; // network error — fail open
    }
}

// ─── Single auto-apply (shared by relay + external paths) ───
function handleAutoApplyStart(message, sendResponse) {
    const { jobUrl, profile } = message;
    if (!jobUrl || !profile) {
        sendResponse({ success: false, error: 'Missing jobUrl or profile' });
        return true;
    }
    // A single apply mid-batch would overwrite jobfitProfile/pendingAutoApply
    // in storage and corrupt the job the batch is currently driving.
    if (isProcessing) {
        sendResponse({ success: false, error: 'Batch apply đang chạy — hãy chờ xong hoặc hủy batch trước.' });
        return true;
    }
    const storage = {
        jobfitProfile: profile,
        pendingAutoApply: true,
        autoApplyJobUrl: jobUrl,
    };
    // Per-job CV file from the web app (rendered at Optimize time) so the
    // agent can satisfy required file-upload fields on single applies too.
    if (message.cvFileBase64 && message.cvFileName) {
        storage.cvFileBase64 = message.cvFileBase64;
        storage.cvFileName = message.cvFileName;
    }
    (async () => {
        const access = await ensureHostAccess(jobUrl);
        if (!access.ok) {
            sendResponse({ success: false, error: 'Cần cấp quyền truy cập trang này. Mở popup Copo để cho phép.' });
            return;
        }
        // Per-job flat fee (covers all the agent-plan + map-form LLM calls).
        const charge = await extSpend('auto_apply');
        if (charge.insufficient) {
            sendResponse({ success: false, error: 'Không đủ credit để ứng tuyển. Nạp thêm tại Copo.' });
            return;
        }
        if (charge.auth) {
            sendResponse({ success: false, error: 'Phiên đăng nhập đã hết hạn — mở Copo và đồng bộ lại để tiếp tục.' });
            return;
        }
        chrome.storage.local.set(storage, () => {
            chrome.tabs.create({ url: jobUrl, active: true }, (tab) => {
                if (!access.known) injectAgentOnLoad(tab.id);  // unknown host: no declarative script
                console.log('[Copo] Auto Apply: opened tab', tab.id, 'for', jobUrl);
                sendResponse({ success: true, tabId: tab.id });
            });
        });
    })();
    return true;
}

// ─── Listen for external messages from Copo web app ───
// NOTE: only reachable if the manifest declares externally_connectable.
// The supported path is the content-webapp.js relay → onMessage below.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (message.type === 'JOBFIT_EXPORT_PROFILE') {
        const syncedAt = Date.now();
        chrome.storage.local.set(
            { jobfitProfile: message.profile, jobfitProfileSyncedAt: syncedAt },
            () => {
                sendResponse({ success: true, syncedAt });
                chrome.runtime.sendMessage({ type: 'PROFILE_UPDATED', syncedAt }).catch(() => { });
            },
        );
        return true;
    }

    if (message.type === 'AUTO_APPLY_START') {
        return handleAutoApplyStart(message, sendResponse);
    }

    // Ping check
    if (message.type === 'JOBFIT_PING') {
        sendResponse({ success: true, version: chrome.runtime.getManifest().version });
        return true;
    }
});

// ─── Listen for internal messages (content scripts + popup) ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Single auto-apply relayed from the web app via content-webapp.js.
    // This used to live ONLY in onMessageExternal, which never fires without
    // externally_connectable in the manifest — so web-app single applies
    // silently went nowhere.
    if (message.type === 'AUTO_APPLY_START') {
        return handleAutoApplyStart(message, sendResponse);
    }

    // ── Profile management ──
    if (message.type === 'GET_PROFILE') {
        chrome.storage.local.get('jobfitProfile', (data) => {
            sendResponse({ profile: data.jobfitProfile || null });
        });
        return true;
    }

    if (message.type === 'SAVE_PROFILE') {
        const syncedAt = Date.now();
        // Persist the JWT alongside the profile so credit-metered auto-apply /
        // tailor calls can be charged to this user. Only overwrite when present
        // (a profile-only sync without a token shouldn't wipe a good token).
        const toStore = { jobfitProfile: message.profile, jobfitProfileSyncedAt: syncedAt };
        if (message.token) toStore.jobfitToken = message.token;
        chrome.storage.local.set(
            toStore,
            () => {
                sendResponse({ success: true, syncedAt });
                // Push to popup if open so the "Synced …" line refreshes immediately.
                chrome.runtime.sendMessage({ type: 'PROFILE_UPDATED', syncedAt }).catch(() => { });
            },
        );
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
            sendResponse({ url: data.jobfitAppUrl || 'https://copoai.net' });
        });
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    // ── LLM PROXY — content scripts route AI calls through the background ──
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'PROXY_LLM_MAP_FORM') {
        const { formFields, profileData } = message;
        (async () => {
            try {
                const data = await chrome.storage.local.get(['jobfitAppUrl', 'jobfitToken']);
                const appUrl = data.jobfitAppUrl || 'https://copoai.net';
                // The AI routes require a login (the synced JWT) server-side.
                const authHeaders = data.jobfitToken
                    ? { Authorization: `Bearer ${data.jobfitToken}` } : {};

                const urls = [appUrl];

                let lastError = null;
                for (const baseUrl of urls) {
                    try {
                        const res = await fetch(`${baseUrl}/api/ai/map-form`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...authHeaders },
                            body: JSON.stringify({ formFields, profileData }),
                            signal: AbortSignal.timeout(30000),
                        });
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            // The AI routes now require the synced login; a
                            // stale/expired token 401s → tell the user to re-sync.
                            if (res.status === 401) {
                                throw new Error('Phiên đăng nhập đã hết hạn — mở Copo và đồng bộ lại để tiếp tục.');
                            }
                            throw new Error(err.detail || `API error: ${res.status}`);
                        }
                        const result = await res.json();
                        sendResponse({ success: true, data: result });
                        return;
                    } catch (e) {
                        lastError = e;
                        console.warn(`[Copo] LLM proxy failed for ${baseUrl}:`, e.message);
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
                const data = await chrome.storage.local.get(['jobfitAppUrl', 'jobfitToken']);
                const appUrl = data.jobfitAppUrl || 'https://copoai.net';
                // The AI routes require a login (the synced JWT) server-side.
                const authHeaders = data.jobfitToken
                    ? { Authorization: `Bearer ${data.jobfitToken}` } : {};

                const urls = [appUrl];

                let lastError = null;
                for (const baseUrl of urls) {
                    try {
                        const res = await fetch(`${baseUrl}/api/ai/agent-plan`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...authHeaders },
                            body: JSON.stringify({ pageState, profileData, history, hasCV }),
                            signal: AbortSignal.timeout(30000),
                        });
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            // The AI routes now require the synced login; a
                            // stale/expired token 401s → tell the user to re-sync.
                            if (res.status === 401) {
                                throw new Error('Phiên đăng nhập đã hết hạn — mở Copo và đồng bộ lại để tiếp tục.');
                            }
                            throw new Error(err.detail || `API error: ${res.status}`);
                        }
                        const result = await res.json();
                        sendResponse({ success: true, data: result });
                        return;
                    } catch (e) {
                        lastError = e;
                        console.warn(`[Copo] Agent plan proxy failed for ${baseUrl}:`, e.message);
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
    // ── MODE 1 — Sync rich CV JSON (needed for tailoring) ──
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'SAVE_CV_DATA') {
        if (!message.cv) {
            sendResponse({ success: false, error: 'Missing cv' });
            return true;
        }
        chrome.storage.local.set({ jobfitCv: message.cv, jobfitCvSyncedAt: Date.now() }, () => {
            sendResponse({ success: true });
        });
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    // ── MODE 1 — Tailor CV for the JD on the current job page. ──
    //    Proxies the no-store /api/ai/tailor (the ONLY endpoint that
    //    sees raw board JD). On success: store source_ref → job_url
    //    LOCALLY (the server never learns the URL) and hand the
    //    tailored CV to the web app for rendering.
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'MODE1_TAILOR') {
        const M1 = '[Copo Mode1/bg]';
        const { cv, jdText, sourceRef, jobUrl, jobTitle, options } = message;
        console.log(`${M1} received`, {
            hasCv: !!cv, jdChars: jdText?.length || 0, sourceRef,
            jobUrl, options,
        });
        (async () => {
            try {
                if (!cv || !jdText || !sourceRef || !jobUrl) {
                    console.warn(`${M1} ✖ missing fields`, { cv: !!cv, jdText: !!jdText, sourceRef: !!sourceRef, jobUrl: !!jobUrl });
                    sendResponse({ success: false, error: 'Missing cv, jdText, sourceRef, or jobUrl' });
                    return;
                }
                const data = await chrome.storage.local.get(['jobfitAppUrl', 'jobfitToken']);
                const appUrl = data.jobfitAppUrl || 'https://copoai.net';
                // The AI routes require a login (the synced JWT) server-side.
                const authHeaders = data.jobfitToken
                    ? { Authorization: `Bearer ${data.jobfitToken}` } : {};
                const urls = [appUrl];
                console.log(`${M1} endpoints to try (in order):`, urls);

                // Charge the tailor fee up front (the pipeline is 3 LLM calls).
                const charge = await extSpend('tailor');
                if (charge.insufficient) {
                    sendResponse({ success: false, error: 'Không đủ credit để tối ưu CV. Nạp thêm tại Copo.' });
                    return;
                }
                if (charge.auth) {
                    sendResponse({ success: false, error: 'Phiên đăng nhập hết hạn — mở Copo và đồng bộ lại.' });
                    return;
                }

                let lastError = null;
                for (const baseUrl of urls) {
                    const t0 = Date.now();
                    try {
                        console.log(`${M1} → POST ${baseUrl}/api/ai/tailor`);
                        const res = await fetch(`${baseUrl}/api/ai/tailor`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...authHeaders },
                            body: JSON.stringify({ cv, jd_text: jdText, source_ref: sourceRef, options }),
                            // Pipeline = 3 sequential LLM calls (extract → score → optimize).
                            signal: AbortSignal.timeout(120000),
                        });
                        console.log(`${M1} ← ${baseUrl} status=${res.status} ok=${res.ok} in ${Date.now() - t0}ms`);
                        if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            // The AI routes now require the synced login; a
                            // stale/expired token 401s → tell the user to re-sync.
                            if (res.status === 401) {
                                throw new Error('Phiên đăng nhập đã hết hạn — mở Copo và đồng bộ lại để tiếp tục.');
                            }
                            throw new Error(err.detail || `API error: ${res.status}`);
                        }
                        const result = await res.json();
                        console.log(`${M1} ✓ tailor result`, {
                            keys: Object.keys(result || {}),
                            variants: result?.variants?.length ?? 0,
                            score: result?.match?.overall_score,
                        });
                        // source_ref → job_url lives ONLY here, never on the server.
                        const store = await chrome.storage.local.get('mode1RefMap');
                        const map = store.mode1RefMap || {};
                        map[sourceRef] = { jobUrl, at: Date.now() };
                        await chrome.storage.local.set({ mode1RefMap: map });
                        console.log(`${M1} stored sourceRef→jobUrl map (local only)`);
                        // Push the tailored CV to the web-app tab(s) to render
                        // (pushToWebApp logs the Copo-app tab count + warns if none open).
                        // jobUrl + jobTitle ride along so the web app can save the
                        // job to history (client-side only — still never sent to
                        // the server; source_ref stays the apply handle).
                        pushToWebApp({ type: 'JOBFIT_MODE1_RESULT', ...result, jobUrl, jobTitle });
                        sendResponse({ success: true, data: result });
                        return;
                    } catch (e) {
                        lastError = e;
                        console.warn(`${M1} ✖ tailor proxy failed for ${baseUrl} after ${Date.now() - t0}ms:`, e.message);
                    }
                }
                console.error(`${M1} ✖ all endpoints failed:`, lastError?.message);
                sendResponse({ success: false, error: lastError?.message || 'All endpoints failed' });
            } catch (e) {
                console.error(`${M1} ✖ handler exception:`, e);
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    // ══════════════════════════════════════════════════════════════
    // ── MODE 1 — Apply: resolve source_ref → job_url LOCALLY, then
    //    reuse the existing single-apply path. The web app only ever
    //    holds the opaque source_ref.
    // ══════════════════════════════════════════════════════════════
    if (message.type === 'MODE1_APPLY') {
        const MA = '[Copo Mode1/apply]';
        // Wrap sendResponse so the final outcome is always logged.
        const reply = (r) => {
            if (r?.success) console.log(`${MA} ✅ apply handed off / started`, r);
            else console.warn(`${MA} ✖ apply failed:`, r?.error, r);
            sendResponse(r);
        };
        (async () => {
            try {
                const { sourceRef } = message;
                console.log(`${MA} received`, {
                    sourceRef,
                    profileInMsg: !!message.profile,
                    cvFile: message.cvFileName || null,
                    cvBytes: message.cvFileBase64?.length || 0,
                });
                const store = await chrome.storage.local.get(['mode1RefMap', 'jobfitProfile']);
                const entry = (store.mode1RefMap || {})[sourceRef];
                if (!entry?.jobUrl) {
                    console.warn(`${MA} ✖ unknown source_ref — not in local ref-map (tailor this job first?)`, {
                        sourceRef, knownRefs: Object.keys(store.mode1RefMap || {}).length,
                    });
                    reply({ success: false, error: 'Unknown source_ref — hãy tailor job này trước.' });
                    return;
                }
                console.log(`${MA} ✓ resolved source_ref → jobUrl (local only)`, {
                    jobUrl: entry.jobUrl,
                    tailoredAt: entry.at ? new Date(entry.at).toISOString() : '?',
                });
                const profile = message.profile || store.jobfitProfile;
                if (!profile) {
                    console.warn(`${MA} ✖ no profile (message + storage both empty) — sync profile first`);
                    reply({ success: false, error: 'Chưa có profile — hãy đồng bộ profile trước.' });
                    return;
                }
                console.log(`${MA} → handleAutoApplyStart (opens tab + runs auto-apply agent)`, {
                    jobUrl: entry.jobUrl,
                    hasCvFile: !!message.cvFileBase64,
                    profileFields: Object.keys(profile || {}).length,
                });
                handleAutoApplyStart(
                    {
                        jobUrl: entry.jobUrl,
                        profile,
                        cvFileBase64: message.cvFileBase64,
                        cvFileName: message.cvFileName,
                    },
                    reply,
                );
            } catch (e) {
                console.error(`${MA} ✖ handler exception:`, e);
                reply({ success: false, error: e.message });
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

        console.log(`[Copo] Batch Apply: starting ${jobs.length} jobs`);

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
        console.log('[Copo] Batch Apply: cancelled by user');
        isProcessing = false;
        applyQueue = [];
        currentJobIndex = -1;
        currentTabId = null;
        chrome.storage.local.remove(['applyQueue', 'isProcessing', 'currentJobIndex', 'currentTabId', 'jobStartedAt']);
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

    // ── Agent heartbeat: the driven page is alive, extend the watchdog ──
    if (message.type === 'AUTO_APPLY_HEARTBEAT') {
        if (isProcessing && sender.tab && sender.tab.id === currentTabId
            && Date.now() - jobStartedAt < JOB_HARD_CAP_MS) {
            armJobSafetyTimer(currentJobIndex);
        }
        sendResponse({ ok: true });
        return true;
    }

    // ── Content script reports single auto-apply result ──
    if (message.type === 'AUTO_APPLY_RESULT') {
        console.log('[Copo] Auto Apply result:', message.result);

        // Ignore stray/late results from tabs that aren't the one we're driving —
        // otherwise a result from a previous job's tab can corrupt the current entry.
        if (isProcessing && sender.tab && sender.tab.id !== currentTabId) {
            sendResponse({ success: false, detail: 'stale tab' });
            return true;
        }

        // If this is part of a batch, update queue and continue
        if (isProcessing && currentJobIndex >= 0 && currentJobIndex < applyQueue.length) {
            // This job reported back — cancel its safety timeout so it can't fire
            // later against a different job.
            if (jobSafetyTimer) { clearTimeout(jobSafetyTimer); jobSafetyTimer = null; }
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
        console.log('[Copo] Batch Apply: all jobs completed!');
        isProcessing = false;
        currentTabId = null;
        persistState();
        broadcastProgress();
        return;
    }

    const job = applyQueue[currentJobIndex];
    job.status = 'processing';
    persistState();

    console.log(`[Copo] Batch Apply: processing job ${currentJobIndex + 1}/${applyQueue.length} — ${job.jobUrl}`);

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
    (async () => {
        // Gate on host access first — an unknown host needs an optional-permission
        // grant before we can drive it; skip the job cleanly if it's not granted.
        const access = await ensureHostAccess(job.jobUrl);
        if (!access.ok) {
            job.status = 'error';
            job.result = { success: false, detail: 'Cần cấp quyền truy cập trang này (mở popup Copo để cho phép).' };
            persistState();
            broadcastProgress();
            setTimeout(() => processNextJob(), TAB_DELAY_MS);
            return;
        }
        // Per-job flat fee (covers all this job's agent-plan + map-form calls).
        const charge = await extSpend('auto_apply');
        if (charge.insufficient || charge.auth) {
            job.status = 'error';
            job.result = {
                success: false,
                detail: charge.insufficient
                    ? 'Không đủ credit để ứng tuyển job này.'
                    : 'Phiên đăng nhập hết hạn — mở Copo và đồng bộ lại.',
            };
            persistState();
            broadcastProgress();
            // Out of credits applies to every remaining job → stop the batch
            // instead of churning failures; expired auth is the same.
            isProcessing = false;
            persistState();
            broadcastProgress();
            return;
        }
        chrome.storage.local.set(storage, () => {
            // Open the job URL in a new tab
            chrome.tabs.create({ url: job.jobUrl, active: true }, (tab) => {
                currentTabId = tab.id;
                jobStartedAt = Date.now();
                if (!access.known) injectAgentOnLoad(tab.id);  // unknown host: inject agent manually
                persistState();
                broadcastProgress();

                // Watchdog: skip the job if the page goes silent. The agent's
                // heartbeats keep re-arming this while it's actively working
                // (capture the index so a stale timer can't skip a later job).
                armJobSafetyTimer(currentJobIndex);
            });
        });
    })();
}

// ─── Broadcast progress to all content scripts (web app) ───
function broadcastProgress() {
    updateBadge();
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
        // 'done' splits into two very different outcomes: 'submitted' (a success
        // signal appeared after the agent acted) vs 'filled' (form filled, the
        // tab is open awaiting the user's review + manual submit). The web app
        // must not present 'filled' as a sent application.
        submitted: applyQueue.filter(j => j.status === 'done' && j.result?.outcome === 'submitted').length,
        filled: applyQueue.filter(j => j.status === 'done' && j.result?.outcome !== 'submitted').length,
    };

    // Send to all tabs that have content scripts
    chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, progress).catch(() => { });
        }
    });
}

// When we open a Copo-app tab for a cold Mode-1 result, remember when — so a
// burst of tailors (multiple jobs, no tab open) opens ONE tab, not one each.
// Resets if the worker is recycled, by which point the tab exists and is taken
// by the firstAppTab branch instead.
let mode1ColdTabOpenAt = 0;

// Push an arbitrary message to every tab; content-webapp.js forwards the
// Copo-app ones to the page. Used to deliver the Mode-1 tailored CV.
function pushToWebApp(message) {
    chrome.tabs.query({}, (tabs) => {
        let appTabs = 0;
        let firstAppTab = null;
        for (const tab of tabs) {
            if (tab.id == null) continue;
            if (/copoai\.net|cv-validation\.vercel\.app|localhost:3000/.test(tab.url || '')) {
                appTabs++;
                if (firstAppTab == null) firstAppTab = tab;
            }
            chrome.tabs.sendMessage(tab.id, message).catch(() => { });
        }
        if (message?.type === 'JOBFIT_MODE1_RESULT') {
            console.log(`[Copo Mode1/bg] pushed ${message.type} → ${appTabs} Copo-app tab(s) open`);
            if (firstAppTab) {
                // The user tailored on a job board, so the Copo-app tab is in
                // the background. Bring it to the front so the auto-opened CV
                // editor is actually visible. tabs.update selects the tab in its
                // window; windows.update is needed when it's in another window.
                chrome.tabs.update(firstAppTab.id, { active: true }).catch(() => { });
                if (firstAppTab.windowId != null) {
                    chrome.windows.update(firstAppTab.windowId, { focused: true }).catch(() => { });
                }
                console.log(`[Copo Mode1/bg] focused Copo-app tab ${firstAppTab.id} (win ${firstAppTab.windowId})`);
            } else {
                // No Copo-app tab open. Stash the result and open ONE tab; the
                // new tab claims it from storage via the JOBFIT_WEBAPP_READY
                // handshake (MV3 workers are ephemeral and a fresh tab hasn't
                // subscribed yet, so we can't just sendMessage). Tailoring several
                // jobs while no tab is open accumulates into a LIST so none is
                // lost, and the in-memory guard keeps the whole burst to one tab
                // (later results land in the now-open tab via the firstAppTab
                // branch above).
                chrome.storage.local.get('pendingMode1Results', (d) => {
                    const list = (d.pendingMode1Results || []).concat({ message, at: Date.now() });
                    chrome.storage.local.set({ pendingMode1Results: list.slice(-10) });
                });
                if (Date.now() - mode1ColdTabOpenAt > 15000) {
                    mode1ColdTabOpenAt = Date.now();
                    chrome.storage.local.get('jobfitAppUrl', (d) => {
                        const appUrl = d.jobfitAppUrl || 'https://copoai.net';
                        chrome.tabs.create({ url: appUrl, active: true });
                        console.log(`[Copo Mode1/bg] no app tab — stashed tailored CV + opened ${appUrl}`);
                    });
                } else {
                    console.log('[Copo Mode1/bg] no app tab, but one is already opening — stashed for that tab');
                }
            }
        }
    });
}

// ─── Handle tab closed — if current processing tab is closed, skip to next ───
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === currentTabId && isProcessing && currentJobIndex < applyQueue.length) {
        if (applyQueue[currentJobIndex]?.status === 'processing') {
            console.log('[Copo] Batch Apply: tab closed, marking as error and continuing');
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
        // topcv.vn disabled — only fetch jobs from embedded sites. Keep VNW.
        // const isSupported = tab.url.includes('vietnamworks.com') || tab.url.includes('topcv.vn');
        const isSupported = tab.url.includes('vietnamworks.com');
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
    let textWithLinksLinkCount = 0;
    let textWithLinksBuildError = '';
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
            // VNW search pages bury job cards under a heavy filter sidebar
            // + ads — the first 25k chars often run out before the cards. Use
            // 80k to give the AI room to see all visible postings.
            // (topcv path disabled — only fetch from embedded sites.)
            .slice(0, 80000);
        textWithLinksLinkCount = (textWithLinks.match(/\[LINK:/g) || []).length;
    } catch (e) {
        textWithLinksBuildError = e?.message || String(e);
    }

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

    return {
        html, text, textWithLinks, jsonLd, title, looksLikeChallenge,
        // Debug fields — surfaced in EXT_CRAWL polling logs so we can tell
        // whether textWithLinks actually contains usable [LINK:] markers
        // before we ship it to the AI extractor downstream.
        textWithLinksLinkCount,
        textWithLinksBuildError,
    };
}

async function extCrawl(url) {
    let tabId = null;
    try {
        const tab = await chrome.tabs.create({ url, active: false });
        tabId = tab.id;
        console.log(`[Copo] EXT_CRAWL: opened background tab ${tabId} for ${url}`);

        // Wait for initial load (Cloudflare challenge page may load first)
        try {
            await _waitForTabComplete(tabId, EXT_CRAWL_TAB_LOAD_TIMEOUT);
        } catch (e) {
            console.warn(`[Copo] EXT_CRAWL: initial load timeout — continuing to poll`);
        }

        // Poll until the page no longer looks like a challenge, OR timeout.
        // Real Chrome auto-solves Cloudflare's JS challenge in ~5s.
        const deadline = Date.now() + EXT_CRAWL_CHALLENGE_TIMEOUT;
        let last = null;
        let pollIdx = 0;
        // Search-result pages render job cards via JS after initial load. If
        // we return on poll #0 the DOM is "complete" but <a> tags aren't there
        // yet — text is full of header/footer, no usable job URLs. Force the
        // loop to keep polling until job links actually appear in the DOM.
        // topcv.vn search pattern disabled — only fetch from embedded sites. Keep VNW.
        // const isSearchPage = /topcv\.vn\/(?:tim-viec-lam-|tim-kiem|search)|vietnamworks\.com\/(?:tim-viec-lam|jobs)/i.test(url);
        const isSearchPage = /vietnamworks\.com\/(?:tim-viec-lam|jobs)/i.test(url);
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
                //
                // The job-link regexes are anchored to `href=` so we only
                // accept the page once real <a> tags with job URLs exist —
                // matching loose text would let us return when /viec-lam/...
                // appears only inside data-attrs or inline JSON.
                // topcv link detection disabled — only fetch from embedded sites. Keep VNW.
                // const hasTopCVJobLinks =
                //     /href=["'][^"']*\/viec-lam\/[^"'\s]+\.html/.test(result?.html || '');
                const hasTopCVJobLinks = false;
                const hasVNWJobLinks =
                    /href=["'][^"']*-jv(?:["'?#\/])/.test(result?.html || '');
                const hasJobLinks = hasTopCVJobLinks || hasVNWJobLinks;
                // Sample a few [LINK:] markers so we can eyeball whether the
                // textWithLinks payload is what we expect to ship downstream.
                const linkSamples = (result?.textWithLinks || '')
                    .match(/\[LINK:[^\]]+\][^[]{0,80}/g)
                    ?.slice(0, 3) || [];
                console.log(`[Copo] EXT_CRAWL DEBUG poll #${pollIdx}`, {
                    url,
                    title: result?.title,
                    textLen: result?.text?.length || 0,
                    htmlLen: result?.html?.length || 0,
                    textWithLinksLen: result?.textWithLinks?.length || 0,
                    textWithLinksLinkCount: result?.textWithLinksLinkCount || 0,
                    textWithLinksBuildError: result?.textWithLinksBuildError || '',
                    looksLikeChallenge: result?.looksLikeChallenge,
                    hasTopCVJobLinks,
                    hasVNWJobLinks,
                    isSearchPage,
                    firstChars: (result?.text || '').slice(0, 300),
                    linkSamples,
                });
                pollIdx++;

                const contentReady = result && !result.looksLikeChallenge && (result.text?.length || 0) >= 200;
                // Search pages MUST have job links in the DOM before we return —
                // otherwise the AI extractor downstream gets a card-less page.
                const searchReady = !isSearchPage || hasJobLinks;
                if (contentReady && searchReady) {
                    console.log(`[Copo] EXT_CRAWL: extracted ${result.text.length} chars from ${url}`);
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
                console.warn(`[Copo] EXT_CRAWL: executeScript error:`, e.message);
            }
            await new Promise(r => setTimeout(r, EXT_CRAWL_POLL_INTERVAL));
        }

        // Timed out. If we ever got content but it was a challenge, return blocked.
        const blocked = !!(last && last.looksLikeChallenge);
        console.log(`[Copo] EXT_CRAWL DEBUG timeout`, {
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
    console.log('[Copo] Extension installed!');
    // Clear any stale queue
    chrome.storage.local.remove([
        'applyQueue', 'isProcessing', 'currentJobIndex', 'currentTabId', 'jobStartedAt',
        'pendingAutoApply', 'autoApplyJobUrl', 'batchMode',
    ]);

    // MV3 content scripts only inject into pages that load AFTER install. A user
    // who already has a CV in the web app and installs the extension with the
    // app tab open would otherwise see "Extension chưa nhận data" (the relay
    // isn't present, so the app's profile push times out) and be forced to F5.
    // Inject the relay into those already-open app tabs now; once live it
    // re-announces JOBFIT_EXTENSION_READY, and the app retries its push → data
    // flows without a manual refresh. Restricted to origins we hold host
    // permission for (localhost isn't in host_permissions, so skip it).
    // Narrow the query to our own app origins (host_permissions) so we never
    // read URLs of unrelated tabs — keeps the injection least-privilege.
    chrome.tabs.query({
        url: ['https://copoai.net/*', 'https://cv-validation.vercel.app/*'],
    }, (tabs) => {
        for (const tab of tabs) {
            if (tab.id == null) continue;
            chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content-webapp.js'],
            }).then(() => {
                console.log(`[Copo] Injected relay into open app tab ${tab.id}`);
            }).catch((e) => {
                // Discarded tab, chrome:// interstitial, or a duplicate-injection
                // race — the in-page guard makes a double-inject a no-op anyway.
                console.warn(`[Copo] onInstalled inject skipped for tab ${tab.id}:`, e?.message);
            });
        }
    });
});
