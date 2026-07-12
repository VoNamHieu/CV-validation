// ═══════════════════════════════════════════════════════════════════════════
// background.js — orchestrates a capture and uploads it to the backend.
// popup → {CAPTURE} → ask the active tab's collector for a payload → POST it to
// <backendUrl>/debug/capture with the X-Debug-Token → report back to the popup.
// The token + backend URL live in chrome.storage.local (set in the popup).
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULTS = {
    // Point at wherever your FastAPI backend runs. Local dev is the common case;
    // change to the deployed backend URL if you capture against prod.
    backendUrl: 'http://localhost:8000',
    debugToken: '',
};

async function getConfig() {
    const c = await chrome.storage.local.get(['backendUrl', 'debugToken']);
    return {
        backendUrl: (c.backendUrl || DEFAULTS.backendUrl).replace(/\/+$/, ''),
        debugToken: c.debugToken || DEFAULTS.debugToken,
    };
}

function askCollector(tabId, note) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { type: 'COLLECT', note }, (resp) => {
            // lastError = no receiver (collector not injected on this tab yet).
            resolve(chrome.runtime.lastError ? null : (resp || null));
        });
    });
}

async function collectFromTab(tabId, note) {
    // Happy path: the content script is already there.
    let resp = await askCollector(tabId, note);
    if (resp) return resp;

    // The tab was open before the extension loaded/reloaded, so the manifest
    // content scripts never injected. Inject the collector on demand and retry
    // — no more "reload the page first". (Network sniffing of the page's own
    // fetch/XHR still needs a reload, since netsniff must patch from
    // document_start; the DOM/anchors/state capture works immediately.)
    try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['collector.js'] });
    } catch (e) {
        return { ok: false, error: 'Không inject được collector vào trang này (trang bị chặn?): ' + e.message };
    }
    resp = await askCollector(tabId, note);
    return resp || { ok: false, error: 'Collector vẫn không phản hồi sau khi inject — thử F5 trang.' };
}

async function upload(payload) {
    const { backendUrl, debugToken } = await getConfig();
    if (!debugToken) return { ok: false, error: 'Chưa nhập Debug token (Settings trong popup). Phải khớp DEBUG_CAPTURE_TOKEN ở backend.' };
    const res = await fetch(`${backendUrl}/debug/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Token': debugToken },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
    if (!res.ok) return { ok: false, error: `Backend ${res.status}: ${body.detail || body.raw || text.slice(0, 200)}` };
    return { ok: true, result: body };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait until the tab finished loading (status 'complete'), bounded by timeout.
function waitTabComplete(tabId, timeoutMs) {
    return new Promise((resolve) => {
        const started = Date.now();
        const tick = async () => {
            try {
                const t = await chrome.tabs.get(tabId);
                if (t.status === 'complete') return resolve(true);
            } catch { return resolve(false); }
            if (Date.now() - started > timeoutMs) return resolve(true); // give up waiting, try anyway
            setTimeout(tick, 500);
        };
        tick();
    });
}

// Walk the backend's capture-target list, opening each in a background tab, letting
// the real browser solve any Cloudflare/anti-bot challenge, then collect + upload.
// Progress is streamed to the popup via BATCH_PROGRESS messages.
async function batchCapture() {
    const { backendUrl, debugToken } = await getConfig();
    if (!debugToken) return { ok: false, error: 'Chưa nhập Debug token.' };
    let targets;
    try {
        const r = await fetch(`${backendUrl}/debug/capture/targets`, {
            headers: { 'X-Debug-Token': debugToken },
        });
        if (!r.ok) return { ok: false, error: `targets ${r.status}` };
        targets = (await r.json()).targets || [];
    } catch (e) {
        return { ok: false, error: 'Không lấy được targets: ' + String(e) };
    }
    const results = [];
    for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        const emit = (status, extra) => chrome.runtime.sendMessage({
            type: 'BATCH_PROGRESS', i, total: targets.length, name: t.name, status, ...extra,
        }).catch(() => {});
        emit('opening');
        let tab = null;
        try {
            tab = await chrome.tabs.create({ url: t.url, active: false });
            await waitTabComplete(tab.id, 25000);
            await sleep(6000);                       // let JS + Cloudflare challenge settle
            const collected = await collectFromTab(tab.id, `batch: ${t.name}`);
            if (!collected.ok) {
                results.push({ name: t.name, ok: false, error: collected.error });
                emit('fail', { error: collected.error });
            } else {
                const up = await upload(collected.payload);
                const rec = { name: t.name, ok: up.ok, anchors: collected.payload.anchors.length, error: up.error };
                results.push(rec);
                emit(up.ok ? 'ok' : 'fail', rec);
            }
        } catch (e) {
            results.push({ name: t.name, ok: false, error: String(e) });
            emit('fail', { error: String(e) });
        } finally {
            if (tab) { try { await chrome.tabs.remove(tab.id); } catch { /* already closed */ } }
        }
    }
    return { ok: true, results };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'BATCH_CAPTURE') {
        batchCapture().then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e) }));
        return true; // async
    }
    if (msg && msg.type === 'CAPTURE') {
        (async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab || !/^https?:/.test(tab.url || '')) {
                    sendResponse({ ok: false, error: 'Mở một trang http(s) trước.' });
                    return;
                }
                const collected = await collectFromTab(tab.id, msg.note || '');
                if (!collected.ok) { sendResponse(collected); return; }
                const up = await upload(collected.payload);
                // Attach a few client-side stats so the popup can show what was sent.
                if (up.ok) {
                    const p = collected.payload;
                    up.stats = {
                        htmlKB: Math.round(p.html.length / 1024),
                        anchors: p.anchors.length,
                        apis: p.apis.length,
                        tables: p.tables.length,
                        hasState: !!p.state,
                        framework: p.extras.framework,
                    };
                }
                sendResponse(up);
            } catch (e) {
                sendResponse({ ok: false, error: String(e) });
            }
        })();
        return true; // async
    }
});
