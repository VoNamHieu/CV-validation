/**
 * JobFit AI — Content Script for Web App
 * Runs on the JobFit AI web app pages (localhost + vercel.app)
 *
 * Responsibilities:
 * 1. Announce extension presence to web app
 * 2. Relay auto-apply commands (single + batch) to background
 * 3. Forward progress updates from background back to web app
 */

(function () {
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

    console.log('[JobFit AI] Extension content script loaded on web app');

    /**
     * Relay a message to the background worker and always answer the page,
     * even when the extension context is gone (extension was reloaded while
     * this tab stayed open) or the background errored. Without this, a dead
     * relay fails silently and the web app shows a fake "synced" state.
     */
    function relay(message, responseType, extra = {}) {
        const reply = (payload) => {
            window.postMessage({ type: responseType, ...extra, ...payload }, '*');
        };
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    reply({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }
                reply(response || { success: false, error: 'no response from background' });
            });
        } catch (e) {
            // "Extension context invalidated" — extension reloaded, tab not refreshed.
            reply({
                success: false,
                error: (e && e.message) || 'Extension context invalidated — hãy tải lại (F5) trang web app.',
            });
        }
    }

    // ── Listen for messages FROM the web app ──
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;

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
            console.log('[JobFit AI] Received AUTO_APPLY_ALL with', event.data.jobs?.length, 'jobs');
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

        // ─── Sync profile JSON into extension storage ───
        if (event.data?.type === 'JOBFIT_EXPORT_PROFILE'
            || event.data?.type === 'JOBFIT_SYNC_PROFILE') {
            relay({
                type: 'SAVE_PROFILE',
                profile: event.data.profile,
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

        // ─── Mode 1: sync rich CV JSON (needed for tailoring) ───
        if (event.data?.type === 'JOBFIT_SYNC_CV_DATA') {
            relay({
                type: 'SAVE_CV_DATA',
                cv: event.data.cv,
            }, 'JOBFIT_SYNC_CV_DATA_RESPONSE');
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
        // Progress updates + Mode-1 tailored-CV results both forward to the page.
        if (message.type === 'JOBFIT_APPLY_PROGRESS' || message.type === 'JOBFIT_MODE1_RESULT') {
            window.postMessage(message, '*');
        }
    });
})();
