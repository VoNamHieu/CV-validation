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
    window.postMessage({
        type: 'JOBFIT_EXTENSION_READY',
        extensionId: chrome.runtime.id,
    }, '*');

    console.log('[JobFit AI] Extension content script loaded on web app');

    // ── Listen for messages FROM the web app ──
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;

        // ─── Single Auto Apply (legacy) ───
        if (event.data?.type === 'JOBFIT_AUTO_APPLY') {
            chrome.runtime.sendMessage({
                type: 'AUTO_APPLY_START',
                jobUrl: event.data.jobUrl,
                profile: event.data.profile,
            }, (response) => {
                window.postMessage({
                    type: 'JOBFIT_AUTO_APPLY_RESPONSE',
                    ...response,
                }, '*');
            });
        }

        // ─── Batch Auto Apply All ───
        if (event.data?.type === 'JOBFIT_AUTO_APPLY_ALL') {
            console.log('[JobFit AI] Received AUTO_APPLY_ALL with', event.data.jobs?.length, 'jobs');

            chrome.runtime.sendMessage({
                type: 'AUTO_APPLY_ALL_START',
                jobs: event.data.jobs,
            }, (response) => {
                window.postMessage({
                    type: 'JOBFIT_AUTO_APPLY_ALL_RESPONSE',
                    ...response,
                }, '*');
            });
        }

        // ─── Cancel Batch ───
        if (event.data?.type === 'JOBFIT_AUTO_APPLY_CANCEL') {
            chrome.runtime.sendMessage({
                type: 'AUTO_APPLY_ALL_CANCEL',
            }, (response) => {
                window.postMessage({
                    type: 'JOBFIT_AUTO_APPLY_CANCEL_RESPONSE',
                    ...response,
                }, '*');
            });
        }

        // ─── Sync CV file (PDF base64) into extension storage ───
        if (event.data?.type === 'JOBFIT_SYNC_CV_FILE') {
            chrome.runtime.sendMessage({
                type: 'SYNC_CV_FILE',
                cvFileBase64: event.data.cvFileBase64,
                cvFileName: event.data.cvFileName,
            }, (response) => {
                window.postMessage({
                    type: 'JOBFIT_SYNC_CV_FILE_RESPONSE',
                    ...response,
                }, '*');
            });
        }

        // ─── Sync profile JSON into extension storage ───
        if (event.data?.type === 'JOBFIT_EXPORT_PROFILE'
            || event.data?.type === 'JOBFIT_SYNC_PROFILE') {
            chrome.runtime.sendMessage({
                type: 'SAVE_PROFILE',
                profile: event.data.profile,
            }, (response) => {
                window.postMessage({
                    type: 'JOBFIT_SYNC_PROFILE_RESPONSE',
                    ...response,
                }, '*');
            });
        }

        // ─── Crawl a URL via background tab (Cloudflare bypass) ───
        if (event.data?.type === 'JOBFIT_EXT_CRAWL') {
            const requestId = event.data.requestId;
            chrome.runtime.sendMessage({
                type: 'EXT_CRAWL',
                url: event.data.url,
            }, (response) => {
                window.postMessage({
                    type: 'JOBFIT_EXT_CRAWL_RESPONSE',
                    requestId,
                    ...(response || { success: false, error: 'no response from background' }),
                }, '*');
            });
        }

        // ─── Get Progress ───
        if (event.data?.type === 'JOBFIT_GET_PROGRESS') {
            chrome.runtime.sendMessage({
                type: 'GET_APPLY_PROGRESS',
            }, (response) => {
                window.postMessage({
                    type: 'JOBFIT_APPLY_PROGRESS',
                    ...response,
                }, '*');
            });
        }
    });

    // ── Listen for progress updates FROM background (pushed) ──
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'JOBFIT_APPLY_PROGRESS') {
            // Forward to web app
            window.postMessage(message, '*');
        }
    });
})();
