/**
 * JobFit AI — Content Script for Web App
 * Runs on the JobFit AI web app pages (localhost + vercel.app)
 * Announces the extension ID so the web app can communicate back.
 */

(function () {
    // Post extension ID to the web app page
    window.postMessage({
        type: 'JOBFIT_EXTENSION_READY',
        extensionId: chrome.runtime.id,
    }, '*');

    // Listen for messages FROM the web app
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;

        // Relay auto-apply commands to background
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
    });
})();
