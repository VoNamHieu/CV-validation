/**
 * Copo — Content Script for Web App
 * Runs on the Copo web app pages (localhost + vercel.app)
 *
 * Responsibilities:
 * 1. Announce extension presence to web app
 * 2. Relay auto-apply commands (single + batch) to background
 * 3. Forward progress updates from background back to web app
 */

(function () {
    // ── Idempotency guard ──
    // This file can be injected twice: once by the manifest (normal page load)
    // and once programmatically by background.js onInstalled (into tabs that
    // were already open when the extension was installed). Running the IIFE
    // twice would register duplicate message listeners → double relay + double
    // ACK. Bail if we've already set up in this document.
    if (window.__copoWebappRelayLoaded) return;
    window.__copoWebappRelayLoaded = true;

    // ── Announce extension to web app ──
    // Re-announce a few times: the React app registers its listener only
    // after hydration, which can happen AFTER document_idle — a single
    // announce at load is often missed and the app then thinks the
    // extension isn't installed.
    function announce() {
        try {
            window.postMessage({
                type: 'JOBFIT_EXTENSION_READY',
                extensionId: chrome.runtime.id,
            }, '*');
        } catch { /* context invalidated — nothing to announce */ }
    }
    announce();
    [1000, 3000, 8000].forEach(ms => setTimeout(announce, ms));

    console.log('[Copo] Extension content script loaded on web app');

    /**
     * Relay a message to the background worker and always answer the page,
     * even when the extension context is gone (extension was reloaded while
     * this tab stayed open) or the background errored. Without this, a dead
     * relay fails silently and the web app shows a fake "synced" state.
     */
    // Actionable wording for the one failure the user can actually fix. Reloading
    // the extension tears `chrome.runtime` out from under content scripts already
    // running in open tabs, so the very next relay throws — and it threw the raw
    // "Cannot read properties of undefined (reading 'sendMessage')" straight into
    // the UI, which names the symptom and hides the one-key fix.
    const RELOAD_HINT = 'Extension vừa được tải lại — hãy nhấn F5 để làm mới trang này rồi thử lại.';

    /** True when this content script has been orphaned by an extension reload. */
    function contextGone() {
        try { return !(chrome && chrome.runtime && chrome.runtime.id); } catch { return true; }
    }

    function relay(message, responseType, extra = {}) {
        const reply = (payload) => {
            window.postMessage({ type: responseType, ...extra, ...payload }, '*');
        };
        if (contextGone()) { reply({ success: false, error: RELOAD_HINT, needsReload: true }); return; }
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    const msg = chrome.runtime.lastError.message || '';
                    reply({
                        success: false,
                        error: /context invalidated|receiving end does not exist/i.test(msg) ? RELOAD_HINT : msg,
                        needsReload: /context invalidated/i.test(msg) || undefined,
                    });
                    return;
                }
                reply(response || { success: false, error: 'no response from background' });
            });
        } catch (e) {
            // Thrown synchronously when the context died between the check above
            // and the call — same fix, same wording.
            reply({ success: false, error: RELOAD_HINT, needsReload: true });
        }
    }

    // ── Listen for messages FROM the web app ──
    // Only trust messages posted BY this same document. The content script is
    // already scoped by the manifest to the app's own origins, but validating
    // event.origin too keeps a stray same-window frame or reflected content
    // from driving privileged background actions (crawl / auto-apply / spend).
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.origin !== window.location.origin) return;

        // ─── Single Auto Apply (legacy) ───
        if (event.data?.type === 'JOBFIT_AUTO_APPLY') {
            relay({
                type: 'AUTO_APPLY_START',
                jobUrl: event.data.jobUrl,
                profile: event.data.profile,
                cvFileBase64: event.data.cvFileBase64,
                cvFileName: event.data.cvFileName,
            }, 'JOBFIT_AUTO_APPLY_RESPONSE');
        }

        // ─── Batch Auto Apply All ───
        if (event.data?.type === 'JOBFIT_AUTO_APPLY_ALL') {
            console.log('[Copo] Received AUTO_APPLY_ALL with', event.data.jobs?.length, 'jobs');
            relay({
                type: 'AUTO_APPLY_ALL_START',
                jobs: event.data.jobs,
            }, 'JOBFIT_AUTO_APPLY_ALL_RESPONSE');
        }

        // ─── Cancel Batch ───
        if (event.data?.type === 'JOBFIT_AUTO_APPLY_CANCEL') {
            relay({ type: 'AUTO_APPLY_ALL_CANCEL' }, 'JOBFIT_AUTO_APPLY_CANCEL_RESPONSE');
        }

        // ─── Sync CV file (PDF base64) into extension storage ───
        if (event.data?.type === 'JOBFIT_SYNC_CV_FILE') {
            relay({
                type: 'SYNC_CV_FILE',
                cvFileBase64: event.data.cvFileBase64,
                cvFileName: event.data.cvFileName,
            }, 'JOBFIT_SYNC_CV_FILE_RESPONSE');
        }

        // ─── Refresh the auth token on its own ───
        // ATS candidate-account credentials are fetched from the backend just in
        // time, so the token has to be live for the whole batch — not just as
        // fresh as the last profile sync (Supabase tokens expire ~hourly).
        if (event.data?.type === 'JOBFIT_SYNC_TOKEN') {
            relay({
                type: 'SAVE_TOKEN',
                token: event.data.token,
            }, 'JOBFIT_SYNC_TOKEN_RESPONSE');
        }

        // ─── Sync profile JSON into extension storage ───
        if (event.data?.type === 'JOBFIT_EXPORT_PROFILE'
            || event.data?.type === 'JOBFIT_SYNC_PROFILE') {
            relay({
                type: 'SAVE_PROFILE',
                profile: event.data.profile,
                token: event.data.token,
            }, 'JOBFIT_SYNC_PROFILE_RESPONSE');
        }

        // ─── Crawl a URL via background tab (Cloudflare bypass) ───
        if (event.data?.type === 'JOBFIT_EXT_CRAWL') {
            relay({
                type: 'EXT_CRAWL',
                url: event.data.url,
            }, 'JOBFIT_EXT_CRAWL_RESPONSE', { requestId: event.data.requestId });
        }

        // ─── Get Progress ───
        if (event.data?.type === 'JOBFIT_GET_PROGRESS') {
            relay({ type: 'GET_APPLY_PROGRESS' }, 'JOBFIT_APPLY_PROGRESS');
        }

        // ─── Strip test artifacts (local-creds blob, dummy GPA) ───
        if (event.data?.type === 'JOBFIT_CLEAR_TEST_DATA') {
            relay({ type: 'CLEAR_TEST_DATA' }, 'JOBFIT_CLEAR_TEST_DATA_RESPONSE');
        }

        // ─── Mode 1: sync rich CV JSON (needed for tailoring) ───
        if (event.data?.type === 'JOBFIT_SYNC_CV_DATA') {
            relay({
                type: 'SAVE_CV_DATA',
                cv: event.data.cv,
            }, 'JOBFIT_SYNC_CV_DATA_RESPONSE');
        }

        // ─── Mode 1: web app is ready → deliver any tailored CV the background
        // stashed while no app tab was open (cold-open after tailoring on a job
        // board). Posted by the page once its onMode1Result listener is live, so
        // delivery can't race ahead of the consumer. ───
        if (event.data?.type === 'JOBFIT_WEBAPP_READY') {
            try {
                chrome.storage.local.get('pendingMode1Results', (d) => {
                    const list = d.pendingMode1Results || [];
                    if (!list.length) return;
                    // Clear first (single delivery), then forward each that's still
                    // fresh — stale leftovers from a crashed session are dropped.
                    chrome.storage.local.remove('pendingMode1Results');
                    const now = Date.now();
                    for (const p of list) {
                        if (p && p.message && p.at && now - p.at < 5 * 60 * 1000) {
                            window.postMessage(p.message, '*');
                        }
                    }
                });
            } catch { /* extension context invalidated — nothing to deliver */ }
        }

        // ─── Mode 1: apply by source_ref (extension resolves → job URL locally) ───
        if (event.data?.type === 'JOBFIT_MODE1_APPLY') {
            relay({
                type: 'MODE1_APPLY',
                sourceRef: event.data.sourceRef,
                profile: event.data.profile,
                cvFileBase64: event.data.cvFileBase64,
                cvFileName: event.data.cvFileName,
            }, 'JOBFIT_MODE1_APPLY_RESPONSE');
        }
    });

    // ── Listen for pushed messages FROM background ──
    chrome.runtime.onMessage.addListener((message) => {
        // Field gaps discovered while applying — forwarded to the page so the app
        // can offer to collect them once. Data only; the page decides what to do.
        if (message?.type === 'JOBFIT_FIELD_GAPS') {
            window.postMessage({ type: 'JOBFIT_FIELD_GAPS', gaps: message.gaps || [] }, '*');
            return;
        }
        // Progress updates + Mode-1 tailored-CV results both forward to the page.
        if (message.type === 'JOBFIT_APPLY_PROGRESS' || message.type === 'JOBFIT_MODE1_RESULT') {
            window.postMessage(message, '*');
        }
    });
})();
