// AUTO-SPLIT from content-agent.js (Phase 2). Part of the Copo apply agent.
// ─── UI: Toast & Progress ───
export function showToast(msg, duration = 3000) {
    const old = document.getElementById('jobfit-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.id = 'jobfit-toast';
    Object.assign(t.style, {
        position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
        background: 'linear-gradient(135deg, #1e1b4b, #312e81)', color: 'white',
        padding: '12px 20px', borderRadius: '12px', fontSize: '14px',
        fontFamily: 'system-ui, sans-serif', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        border: '1px solid rgba(139,92,246,0.3)', maxWidth: '360px', lineHeight: '1.5',
    });
    t.textContent = msg;
    document.body.appendChild(t);
    if (duration > 0) setTimeout(() => t.remove(), duration);
    return t;
}

export function showProgress(step, total, detail) {
    let el = document.getElementById('jobfit-progress');
    if (!el) {
        el = document.createElement('div');
        el.id = 'jobfit-progress';
        Object.assign(el.style, {
            position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
            background: 'linear-gradient(135deg, #1e1b4b, #312e81)', color: 'white',
            padding: '16px 24px', borderRadius: '16px', fontSize: '14px',
            fontFamily: 'system-ui, sans-serif', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            border: '1px solid rgba(139,92,246,0.3)', maxWidth: '400px', lineHeight: '1.6',
        });
        document.body.appendChild(el);
    }
    el.textContent = '';

    const title = document.createElement('div');
    title.textContent = `⚡ Auto Apply Agent (${step}/${total})`;
    title.style.fontWeight = '700';
    title.style.marginBottom = '4px';
    el.appendChild(title);

    const desc = document.createElement('div');
    desc.textContent = detail;
    desc.style.fontSize = '12px';
    desc.style.opacity = '0.8';
    el.appendChild(desc);

    const bar = document.createElement('div');
    Object.assign(bar.style, {
        marginTop: '8px', height: '3px', background: 'rgba(255,255,255,0.15)',
        borderRadius: '2px', overflow: 'hidden',
    });
    const fill = document.createElement('div');
    Object.assign(fill.style, {
        height: '100%', width: `${(step / total) * 100}%`,
        background: 'linear-gradient(90deg, #8b5cf6, #06b6d4)',
        borderRadius: '2px', transition: 'width 0.3s ease',
    });
    bar.appendChild(fill);
    el.appendChild(bar);
    return el;
}

export function removeProgress() {
    document.getElementById('jobfit-progress')?.remove();
}

// ═══════════════════════════════════════════════════════════════════
// Phase 1: Enhanced DOM Extraction
// ═══════════════════════════════════════════════════════════════════

export function showConfirmation(filledCount, totalFields, isSuccess) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.id = 'jobfit-confirm-overlay';
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', zIndex: '1000000',
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
        });

        const card = document.createElement('div');
        Object.assign(card.style, {
            background: 'linear-gradient(135deg, #1e1b4b, #312e81)',
            borderRadius: '20px', padding: '32px', maxWidth: '420px', width: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: '1px solid rgba(139,92,246,0.3)',
            color: 'white', textAlign: 'center',
        });

        const title = document.createElement('div');
        title.textContent = '⚡ Copo — Auto Apply Agent';
        title.style.cssText = 'font-size: 18px; font-weight: 700; margin-bottom: 12px;';
        card.appendChild(title);

        const info = document.createElement('div');
        info.textContent = isSuccess
            ? 'Ứng tuyển thành công!'
            : `Đã tự động điền ${filledCount} fields.`;
        info.style.cssText = 'font-size: 14px; margin-bottom: 8px; opacity: 0.9;';
        card.appendChild(info);

        if (!isSuccess) {
            const warn = document.createElement('div');
            warn.textContent = '⚠️ Vui lòng kiểm tra lại thông tin trước khi nộp.';
            warn.style.cssText = 'font-size: 13px; color: #fbbf24; margin-bottom: 24px;';
            card.appendChild(warn);
        }

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 12px; justify-content: center; margin-top: 16px;';

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Đóng';
        cancelBtn.style.cssText = 'padding: 10px 24px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: white; cursor: pointer; font-size: 14px;';
        cancelBtn.onclick = () => { overlay.remove(); resolve('close'); };
        btnRow.appendChild(cancelBtn);

        card.appendChild(btnRow);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
    });
}
