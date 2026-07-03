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
