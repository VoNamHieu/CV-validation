const $ = (id) => document.getElementById(id);

function hostOf(url) {
    try { return new URL(url).host.replace(/^www\./, ''); } catch { return '?'; }
}

// ── Load saved config ──
chrome.storage.local.get(['backendUrl', 'debugToken'], (c) => {
    $('backendUrl').value = c.backendUrl || 'http://localhost:8000';
    $('debugToken').value = c.debugToken || '';
    // Nudge the user to configure on first run.
    if (!c.debugToken) $('cfg').open = true;
});

$('saveCfg').addEventListener('click', () => {
    const backendUrl = $('backendUrl').value.trim();
    const debugToken = $('debugToken').value.trim();
    chrome.storage.local.set({ backendUrl, debugToken }, () => {
        $('cfgStatus').textContent = '✓ Đã lưu';
        setTimeout(() => { $('cfgStatus').textContent = ''; }, 1500);
    });
});

// ── Batch capture: walk the backend's target list, capture each ──
const _batchLog = [];
chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'BATCH_PROGRESS') return;
    const icon = { opening: '⏳', ok: '✓', fail: '✕' }[msg.status] || '·';
    const line = `${icon} [${msg.i + 1}/${msg.total}] ${msg.name}` +
        (msg.status === 'ok' ? ` — ${msg.anchors ?? 0} links` : '') +
        (msg.status === 'fail' ? ` — ${(msg.error || '').slice(0, 40)}` : '');
    // replace the "opening" line for this item, else append
    const key = `[${msg.i + 1}/${msg.total}]`;
    const idx = _batchLog.findIndex((l) => l.includes(key));
    if (idx >= 0 && msg.status !== 'opening') _batchLog[idx] = line;
    else if (idx < 0) _batchLog.push(line);
    $('result').className = 'result';
    $('result').textContent = _batchLog.join('\n');
});

$('batchBtn').addEventListener('click', async () => {
    const btn = $('batchBtn');
    btn.disabled = true; btn.textContent = '⏳ Đang batch capture…';
    _batchLog.length = 0;
    $('result').className = 'result'; $('result').textContent = 'Đang lấy danh sách target…';
    try {
        const resp = await chrome.runtime.sendMessage({ type: 'BATCH_CAPTURE' });
        if (resp?.ok) {
            const ok = resp.results.filter((r) => r.ok).length;
            _batchLog.push(`\n✓ Xong: ${ok}/${resp.results.length} công ty đã capture.`);
            $('result').className = 'result ok';
            $('result').textContent = _batchLog.join('\n');
        } else {
            $('result').className = 'result err';
            $('result').textContent = '✕ ' + (resp?.error || 'Batch thất bại');
        }
    } catch (e) {
        $('result').className = 'result err'; $('result').textContent = '✕ ' + String(e);
    } finally {
        btn.disabled = false; btn.textContent = '🗂️ Batch capture (danh sách target)';
    }
});

$('captureBtn').addEventListener('click', async () => {
    const btn = $('captureBtn');
    const out = $('result');
    btn.disabled = true; btn.textContent = '⏳ Đang capture…';
    out.className = 'result'; out.textContent = '';
    try {
        const resp = await chrome.runtime.sendMessage({ type: 'CAPTURE', note: $('note').value.trim() });
        if (resp && resp.ok) {
            const s = resp.stats || {};
            const host = resp.result?.host || '?';
            out.className = 'result ok';
            out.textContent =
                `✓ Đã gửi capture: ${host}\n` +
                `HTML ${s.htmlKB ?? '?'}KB · ${s.anchors ?? 0} links · ${s.apis ?? 0} API calls · ${s.tables ?? 0} bảng\n` +
                `state: ${s.hasState ? 'có' : 'không'} · framework: ${(s.framework || []).join(',') || '?'}\n\n` +
                `→ Bảo Claude: "đọc capture host ${host}"`;
        } else {
            out.className = 'result err';
            out.textContent = '✕ ' + (resp?.error || 'Capture thất bại');
        }
    } catch (e) {
        out.className = 'result err';
        out.textContent = '✕ ' + String(e);
    } finally {
        btn.disabled = false; btn.textContent = '📸 Capture trang đang mở';
    }
});
