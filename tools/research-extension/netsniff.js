// ═══════════════════════════════════════════════════════════════════════════
// netsniff.js — MAIN-world, document_start, all frames.
// Patches window.fetch + XMLHttpRequest to record the page's OWN API calls
// (method, url, status, request body, a snippet of the JSON response). This is
// the single most useful signal for reverse-engineering a career site's hidden
// job API — e.g. it's how mokahr's POST /api/outer/ats-apply/website/jobs/v2
// was found. Records are posted to the isolated-world collector via postMessage.
// ═══════════════════════════════════════════════════════════════════════════
(() => {
    if (window.__copoNetInstalled) return;
    window.__copoNetInstalled = true;

    const MAX_RECORDS = 200;
    const RESP_SNIP = 6000;     // response body snippet cap (per call)
    const REQ_CAP = 3000;       // request body cap
    const recs = [];

    // Skip static assets + analytics/telemetry noise — keep the signal (JSON
    // APIs, GraphQL, search endpoints) that reveals how jobs are loaded.
    const NOISE = /\.(js|mjs|css|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|eot|ico|mp4|webm|map)(\?|$)/i;
    const TRACKERS = /google-analytics|googletagmanager|analytics\.google|doubleclick|gstatic|hotjar|segment\.io|sentry|facebook|fbcdn|clarity\.ms|cookiebot|onetrust|newrelic|datadog|amplitude|mixpanel|intercom/i;
    const interesting = (u) => u && !NOISE.test(u) && !TRACKERS.test(u);

    const push = (rec) => {
        try {
            recs.push(rec);
            if (recs.length > MAX_RECORDS) recs.shift();
            window.postMessage({ __copoNet: true, rec }, window.location.origin || '*');
        } catch { /* ignore */ }
    };

    // ── fetch ──
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
        window.fetch = function (...args) {
            const input = args[0];
            const url = (typeof input === 'string' ? input : (input && input.url)) || '';
            const init = args[1] || {};
            const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
            const reqBody = init.body ? String(init.body).slice(0, REQ_CAP) : '';
            const p = origFetch.apply(this, args);
            if (interesting(url)) {
                p.then(async (res) => {
                    let snip = '';
                    try {
                        const ct = res.headers.get('content-type') || '';
                        if (/json|text|javascript|graphql/i.test(ct)) {
                            snip = (await res.clone().text()).slice(0, RESP_SNIP);
                        }
                    } catch { /* opaque/streamed */ }
                    push({ type: 'fetch', method, url, status: res.status, reqBody, respSnippet: snip });
                }).catch((e) => push({ type: 'fetch', method, url, status: 'ERR', reqBody, respSnippet: String(e).slice(0, 200) }));
            }
            return p;
        };
    }

    // ── XMLHttpRequest ──
    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR && OrigXHR.prototype) {
        const open = OrigXHR.prototype.open;
        const send = OrigXHR.prototype.send;
        OrigXHR.prototype.open = function (method, url, ...rest) {
            this.__copo = { method: String(method || 'GET').toUpperCase(), url: url || '' };
            return open.call(this, method, url, ...rest);
        };
        OrigXHR.prototype.send = function (body) {
            const info = this.__copo;
            if (info && interesting(info.url)) {
                this.addEventListener('loadend', () => {
                    let snip = '';
                    try {
                        const rt = this.responseType;
                        if (!rt || rt === 'text' || rt === 'json') snip = String(this.responseText || '').slice(0, RESP_SNIP);
                    } catch { /* ignore */ }
                    push({
                        type: 'xhr', method: info.method, url: info.url, status: this.status,
                        reqBody: body ? String(body).slice(0, REQ_CAP) : '', respSnippet: snip,
                    });
                });
            }
            return send.call(this, body);
        };
    }

    // Belt-and-suspenders: let the collector pull the full buffer directly too.
    window.__copoNetRecords = () => recs.slice();
})();
