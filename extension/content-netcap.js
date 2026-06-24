// JobFit AI — network capture (MAIN world, document_start).
//
// Records the page's OWN fetch/XHR calls into window.__jfApis so a debug
// DOM-capture can reveal the backend job API behind SPA career sites (the data
// source that the rendered HTML hides). This is how we crack "JS-shell" sites:
// instead of guessing endpoints, we see exactly what the page called.
//
// Must run in the MAIN world at document_start to wrap the page's real fetch/
// XHR before it makes any calls. Lightweight: URL+method+status only, with
// asset/analytics noise filtered and a hard cap. Never blocks or alters the
// page's own requests (hooks are pass-through, errors swallowed).
(function () {
    if (window.__jfApis) return;            // already installed (SPA re-inject)
    const apis = [];
    const MAX = 200;
    // Skip static assets and analytics/telemetry — keep only data-ish calls.
    const SKIP_EXT = /\.(?:js|mjs|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|mp4|webm|map)(?:\?|#|$)/i;
    const SKIP_HOST = /google-analytics|googletagmanager|gtag|doubleclick|facebook|fbcdn|sentry|hotjar|clarity|segment|mixpanel|amplitude|datadog|newrelic|cdn\.|fonts\.g|gstatic/i;
    const seen = new Set();

    function record(url, method, status) {
        try {
            if (!url || apis.length >= MAX) return;
            const u = String(url);
            if (SKIP_EXT.test(u) || SKIP_HOST.test(u)) return;
            const key = (method || 'GET') + ' ' + u.split('?')[0];
            if (seen.has(key)) return;
            seen.add(key);
            apis.push({ method: (method || 'GET').toUpperCase(), url: u.slice(0, 400), status: status || 0 });
        } catch (e) { /* never break the page */ }
    }

    const origFetch = window.fetch;
    if (origFetch) {
        window.fetch = function (input, init) {
            let url, method;
            try {
                url = (input && input.url) || input;
                method = (init && init.method) || (input && input.method) || 'GET';
            } catch (e) { /* noop */ }
            const p = origFetch.apply(this, arguments);
            try { p.then((r) => record(url, method, r && r.status), () => record(url, method, 0)); } catch (e) { /* noop */ }
            return p;
        };
    }

    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        try { this.addEventListener('loadend', () => record(url, method, this.status)); } catch (e) { /* noop */ }
        return origOpen.apply(this, arguments);
    };

    window.__jfApis = apis;
})();
