// ═══════════════════════════════════════════════════════════════════════════
// collector.js — isolated world, document_idle, top frame.
// Buffers the API records netsniff posts from the MAIN world, and on a COLLECT
// message (from the background, triggered by the popup) builds a rich research
// payload of the fully-rendered page and returns it for upload.
// ═══════════════════════════════════════════════════════════════════════════

const __apis = [];
window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (d && d.__copoNet && d.rec) {
        __apis.push(d.rec);
        if (__apis.length > 300) __apis.shift();
    }
});

const cap = (s, n) => (s == null ? '' : String(s)).slice(0, n);

// All anchors (deduped by href) — the raw material for finding job-detail links.
function collectAnchors() {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll('a[href]')) {
        const href = a.href;
        if (!href || seen.has(href)) continue;
        seen.add(href);
        out.push({ href, text: cap(a.textContent.trim().replace(/\s+/g, ' '), 160) });
        if (out.length >= 1500) break;
    }
    return out;
}

// Every table as a matrix of cell text — some ATS list jobs in a plain table.
function collectTables() {
    const out = [];
    for (const t of document.querySelectorAll('table')) {
        const rows = [];
        for (const tr of t.querySelectorAll('tr')) {
            rows.push([...tr.querySelectorAll('th,td')].map((c) => cap(c.textContent.trim(), 200)));
        }
        if (rows.length) out.push(rows);
        if (out.length >= 30) break;
    }
    return out;
}

function textOf(sel) {
    const el = document.querySelector(sel);
    return el ? el.textContent : '';
}

// Embedded hydration state — where SPA job data usually lives pre-render.
function embeddedState() {
    const globals = ['__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__', '__PRELOADED_STATE__', '__remixContext', '__sveltekit'];
    for (const g of globals) {
        try {
            if (window.wrappedJSObject && window.wrappedJSObject[g]) return `/*${g}*/` + JSON.stringify(window.wrappedJSObject[g]).slice(0, 600000);
        } catch { /* ignore */ }
    }
    // MAIN-world globals aren't visible from the isolated world; fall back to
    // scraping the serialized copies scripts leave in the DOM.
    for (const s of document.querySelectorAll('script')) {
        const t = s.textContent || '';
        const m = t.match(/(?:window\.__(?:NUXT|INITIAL_STATE|APOLLO_STATE|PRELOADED_STATE)__|self\.__next_f)\s*=\s*/);
        if (m) return cap(t, 600000);
    }
    return '';
}

function jsonLd() {
    const out = [];
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        out.push(cap(s.textContent, 40000));
        if (out.length >= 20) break;
    }
    return out;
}

// Concatenated text of every OPEN shadow root — SPA frameworks (LWC, Stencil,
// some Workday/Oracle widgets) render job lists inside shadow DOM that plain
// innerText / outerHTML miss.
function shadowText() {
    const parts = [];
    const walk = (root) => {
        for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) {
                parts.push(cap(el.shadowRoot.textContent.replace(/\s+/g, ' ').trim(), 4000));
                if (parts.length < 60) walk(el.shadowRoot);
            }
        }
    };
    try { walk(document); } catch { /* ignore */ }
    return parts.join('\n---\n').slice(0, 120000);
}

function extras() {
    const metas = {};
    for (const m of document.querySelectorAll('meta[name],meta[property]')) {
        const k = m.getAttribute('name') || m.getAttribute('property');
        if (k) metas[k] = cap(m.getAttribute('content') || '', 300);
    }
    const iframes = [...document.querySelectorAll('iframe[src]')].map((f) => f.src).slice(0, 40);
    // Cheap framework fingerprint from the DOM/globals visible to us.
    const html = document.documentElement.outerHTML;
    const fw = [];
    if (document.querySelector('#__next') || /__next_f/.test(html)) fw.push('next');
    if (document.querySelector('#__nuxt,#__layout') || /__NUXT__/.test(html)) fw.push('nuxt');
    if (document.querySelector('[data-reactroot],#root') && /react/i.test(html)) fw.push('react');
    if (document.querySelector('[ng-version]')) fw.push('angular');
    if (/workday|myworkdayjobs/i.test(location.host)) fw.push('workday');
    if (/mokahr/i.test(location.host)) fw.push('mokahr');
    return {
        framework: fw,
        metas,
        iframes,
        forms: document.querySelectorAll('form').length,
        shadowHosts: [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).length,
        scripts: [...document.querySelectorAll('script[src]')].map((s) => s.src).slice(0, 60),
        capturedApiCount: __apis.length,
        cookiesPresent: !!document.cookie,
    };
}

function buildPayload(note) {
    // Merge netsniff's postMessage buffer with a direct pull of its MAIN-world
    // buffer (in case some records predate the collector loading).
    let apis = __apis.slice();
    try {
        if (typeof window.__copoNetRecords === 'function') {
            const direct = window.__copoNetRecords();
            if (Array.isArray(direct) && direct.length > apis.length) apis = direct;
        }
    } catch { /* MAIN-world fn not reachable from isolated world; buffer stands */ }

    return {
        url: location.href,
        title: cap(document.title, 500),
        html: cap(document.documentElement.outerHTML, 3_000_000),
        anchors: collectAnchors(),
        tables: collectTables(),
        nextData: cap(textOf('script#__NEXT_DATA__'), 600000),
        jsonld: jsonLd(),
        apis: apis.slice(0, 200),
        state: embeddedState(),
        extras: { ...extras(), shadowText: shadowText() },
        note: cap(note || '', 1000),
    };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'COLLECT') {
        try {
            sendResponse({ ok: true, payload: buildPayload(msg.note) });
        } catch (e) {
            sendResponse({ ok: false, error: String(e) });
        }
    }
    // synchronous response — no need to return true
});
