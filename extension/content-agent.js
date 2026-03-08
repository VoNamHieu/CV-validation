/**
 * JobFit AI — Universal Apply Agent
 * Runs on ALL job sites. Uses LLM to understand any form.
 * Replaces hardcoded content-topcv.js and content-vietnamworks.js.
 *
 * Flow:
 *   1. Check pendingAutoApply flag
 *   2. Find and click "Apply" button on job page
 *   3. Extract form fields from DOM
 *   4. Send to LLM API for intelligent field mapping
 *   5. Execute fill instructions
 *   6. Show confirmation overlay
 */

// ─── Config ───
const FORM_EXTRACT_DELAY = 2000;   // Wait for apply form to appear
const MAX_RETRIES = 3;
const LLM_TIMEOUT = 30000;

// ─── Helpers ───
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showToast(msg, duration = 3000) {
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

function showProgress(step, total, detail) {
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
    title.textContent = `⚡ Auto Apply (${step}/${total})`;
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

function removeProgress() {
    document.getElementById('jobfit-progress')?.remove();
}

// ─── DOM Analysis: Extract form fields ───
function extractFormFields() {
    const fields = [];
    const seen = new Set();

    // Find all inputs, selects, textareas
    const elements = document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), ' +
        'select, textarea, [contenteditable="true"]'
    );

    for (const el of elements) {
        // Skip invisible elements
        if (!el.offsetParent && el.type !== 'hidden') continue;

        const id = el.id || '';
        const name = el.name || '';
        const type = el.type || el.tagName.toLowerCase();
        const placeholder = el.placeholder || '';
        const ariaLabel = el.getAttribute('aria-label') || '';

        // Find associated label
        let label = '';
        if (id) {
            const labelEl = document.querySelector(`label[for="${id}"]`);
            if (labelEl) label = labelEl.textContent.trim();
        }
        if (!label) {
            const parent = el.closest('label, .form-group, .form-field, [class*="field"], [class*="input"]');
            if (parent) {
                const labelEl = parent.querySelector('label, .label, [class*="label"]');
                if (labelEl) label = labelEl.textContent.trim();
            }
        }

        // Build unique key
        const key = `${id}|${name}|${type}|${label}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Get current value
        const value = el.value || '';

        // Get options for select elements
        let options = [];
        if (el.tagName === 'SELECT') {
            options = [...el.options].map(o => ({ value: o.value, text: o.textContent.trim() }));
        }

        // Get class list (truncated)
        const classes = el.className?.toString().substring(0, 100) || '';

        fields.push({
            index: fields.length,
            tag: el.tagName.toLowerCase(),
            type,
            id,
            name,
            label,
            placeholder,
            ariaLabel,
            classes,
            value,
            options: options.length > 0 ? options.slice(0, 30) : undefined,
            required: el.required || el.getAttribute('aria-required') === 'true',
        });
    }

    return fields;
}

// ─── Build CSS selector for a field ───
function buildSelector(field) {
    if (field.id) return `#${CSS.escape(field.id)}`;
    if (field.name) return `${field.tag}[name="${CSS.escape(field.name)}"]`;
    return `${field.tag}.${field.classes.split(' ')[0]}`;
}

// ─── Find "Apply" button on page ───
function findApplyButton() {
    const applyTexts = [
        'ứng tuyển', 'apply', 'nộp đơn', 'apply now',
        'ứng tuyển ngay', 'nộp hồ sơ', 'apply for this job',
        'quick apply', 'easy apply',
    ];

    // Strategy 1: Buttons/links with apply-related classes
    const byClass = document.querySelector(
        '[class*="apply" i]:not(nav *), [class*="btn-apply" i], ' +
        'a[href*="apply"], button[data-action*="apply"]'
    );
    if (byClass && byClass.offsetParent) return byClass;

    // Strategy 2: Buttons/links with apply text
    const allClickables = document.querySelectorAll('button, a, [role="button"]');
    for (const el of allClickables) {
        const text = el.textContent?.trim().toLowerCase() || '';
        if (applyTexts.some(t => text.includes(t)) && el.offsetParent) {
            return el;
        }
    }

    return null;
}

// ─── Call LLM to map form fields to profile (via background proxy) ───
async function callLLMMapping(formFields, profileData) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('LLM proxy timeout (30s)'));
        }, LLM_TIMEOUT);

        chrome.runtime.sendMessage({
            type: 'PROXY_LLM_MAP_FORM',
            formFields,
            profileData,
        }, (response) => {
            clearTimeout(timeout);

            if (chrome.runtime.lastError) {
                reject(new Error(`Extension error: ${chrome.runtime.lastError.message}`));
                return;
            }

            if (!response) {
                reject(new Error('No response from background'));
                return;
            }

            if (response.success) {
                resolve(response.data);
            } else {
                reject(new Error(response.error || 'LLM proxy failed'));
            }
        });
    });
}

// ─── Execute fill instructions ───
async function executeFillInstructions(instructions) {
    let filled = 0;

    for (const inst of instructions) {
        try {
            const el = document.querySelector(inst.selector);
            if (!el) {
                console.warn(`[JobFit Agent] Selector not found: ${inst.selector}`);
                continue;
            }

            if (inst.action === 'fill' || inst.action === 'type') {
                // Use native setter to trigger React/Vue reactivity
                const nativeSetter =
                    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set ||
                    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
                if (nativeSetter) {
                    nativeSetter.call(el, inst.value);
                } else {
                    el.value = inst.value;
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
                filled++;
            } else if (inst.action === 'select') {
                el.value = inst.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                filled++;
            } else if (inst.action === 'click') {
                el.click();
                filled++;
            }

            await sleep(150); // Small delay between fills for stability
        } catch (err) {
            console.warn(`[JobFit Agent] Failed to fill:`, inst, err);
        }
    }

    return filled;
}

// ─── Show confirmation overlay ───
function showConfirmation(filledCount, totalFields) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.id = 'jobfit-confirm-overlay';
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', zIndex: '1000000',
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
        });
        overlay.innerHTML = ''; // Clear

        const card = document.createElement('div');
        Object.assign(card.style, {
            background: 'linear-gradient(135deg, #1e1b4b, #312e81)',
            borderRadius: '20px', padding: '32px', maxWidth: '420px', width: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)', border: '1px solid rgba(139,92,246,0.3)',
            color: 'white', textAlign: 'center',
        });

        const title = document.createElement('div');
        title.textContent = '⚡ JobFit AI — Auto Apply';
        title.style.cssText = 'font-size: 18px; font-weight: 700; margin-bottom: 12px;';
        card.appendChild(title);

        const info = document.createElement('div');
        info.textContent = `Đã tự động điền ${filledCount}/${totalFields} fields.`;
        info.style.cssText = 'font-size: 14px; margin-bottom: 8px; opacity: 0.9;';
        card.appendChild(info);

        const warn = document.createElement('div');
        warn.textContent = '⚠️ Vui lòng kiểm tra lại thông tin trước khi nộp.';
        warn.style.cssText = 'font-size: 13px; color: #fbbf24; margin-bottom: 24px;';
        card.appendChild(warn);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 12px; justify-content: center;';

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

// ─── Main Agent Loop ───
async function runApplyAgent(profile) {
    const STEPS = 4;

    try {
        // Step 1: Find and click Apply button
        showProgress(1, STEPS, 'Tìm nút Ứng tuyển...');
        await sleep(1000);

        const applyBtn = findApplyButton();
        if (applyBtn) {
            applyBtn.click();
            showProgress(1, STEPS, 'Đã click nút Ứng tuyển, chờ form mở...');
            await sleep(FORM_EXTRACT_DELAY);
        } else {
            showProgress(1, STEPS, 'Không tìm thấy nút Apply, thử scan form hiện tại...');
            await sleep(500);
        }

        // Step 2: Extract form fields
        showProgress(2, STEPS, 'Đang phân tích form...');
        let formFields = extractFormFields();

        // Retry if no fields found (form might still be loading)
        for (let retry = 0; retry < MAX_RETRIES && formFields.length === 0; retry++) {
            await sleep(2000);
            formFields = extractFormFields();
        }

        if (formFields.length === 0) {
            removeProgress();
            showToast('❌ Không tìm thấy form ứng tuyển trên trang này.', 5000);
            reportResult(false, 'No form found');
            return;
        }

        showProgress(2, STEPS, `Tìm thấy ${formFields.length} fields, gửi AI phân tích...`);

        // Step 3: Call LLM for mapping
        showProgress(3, STEPS, 'AI đang phân tích cách điền form...');

        let instructions;
        try {
            const result = await callLLMMapping(formFields, profile);
            instructions = result.instructions || [];
        } catch (err) {
            removeProgress();
            showToast(`❌ Lỗi AI: ${err.message}`, 5000);
            reportResult(false, `LLM error: ${err.message}`);
            return;
        }

        if (instructions.length === 0) {
            removeProgress();
            showToast('⚠️ AI không tìm được field nào phù hợp để điền.', 5000);
            reportResult(false, 'No mappings found');
            return;
        }

        showProgress(3, STEPS, `AI đã map ${instructions.length} fields, đang điền...`);

        // Step 4: Execute fills
        showProgress(4, STEPS, 'Đang tự động điền form...');
        const filled = await executeFillInstructions(instructions);

        removeProgress();

        // Show confirmation
        await showConfirmation(filled, formFields.length);

        reportResult(true, `Filled ${filled}/${formFields.length} fields`);

    } catch (err) {
        removeProgress();
        showToast(`❌ Lỗi: ${err.message}`, 5000);
        reportResult(false, err.message);
    }
}

// ─── Report result back to background ───
function reportResult(success, detail) {
    chrome.runtime.sendMessage({
        type: 'AUTO_APPLY_RESULT',
        result: { success, site: window.location.hostname, url: window.location.href, detail },
    }).catch(() => { });
}

// ─── Initialize ───
async function init() {
    await sleep(1500); // Wait for page render

    // Check for pending auto-apply (single or batch)
    try {
        const data = await new Promise(r => {
            chrome.storage.local.get(['pendingAutoApply', 'jobfitProfile', 'batchMode'], r);
        });

        if (data.pendingAutoApply && data.jobfitProfile) {
            const isBatch = data.batchMode === true;

            // Clear flags immediately to prevent re-triggering
            await new Promise(r => {
                chrome.storage.local.remove(['pendingAutoApply', 'autoApplyJobUrl', 'batchMode'], r);
            });

            console.log(`[JobFit Agent] Auto-apply triggered (batch: ${isBatch})`);

            showToast(isBatch
                ? '🚀 Batch Apply — Đang xử lý job này...'
                : '🚀 JobFit AI Agent đang xử lý...', 0);
            await sleep(500);
            document.getElementById('jobfit-toast')?.remove();

            await runApplyAgent(data.jobfitProfile);

            // If batch mode, the reportResult in runApplyAgent already
            // sends AUTO_APPLY_RESULT back to background, which triggers
            // the next job in queue. Nothing extra needed here.
            return;
        }
    } catch (e) {
        console.warn('[JobFit Agent] Auto-apply check failed:', e);
        // Report failure so batch can continue
        reportResult(false, `Init error: ${e.message}`);
    }

    // Normal mode: show floating button if there's a profile
    const profile = await new Promise(r => {
        chrome.storage.local.get('jobfitProfile', d => r(d.jobfitProfile || null));
    });

    if (profile) {
        const existingBtn = document.getElementById('jobfit-auto-apply-btn');
        if (existingBtn) return;

        const btn = document.createElement('button');
        btn.id = 'jobfit-auto-apply-btn';
        btn.textContent = '⚡ Auto Apply';
        btn.title = 'JobFit AI — Auto Apply';
        Object.assign(btn.style, {
            position: 'fixed', bottom: '80px', right: '20px', zIndex: '99999',
            background: 'linear-gradient(135deg, #7c3aed, #6366f1)',
            color: 'white', border: 'none', borderRadius: '14px',
            padding: '12px 20px', fontSize: '14px', fontWeight: '700',
            cursor: 'pointer', fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
            transition: 'transform 0.2s, box-shadow 0.2s',
        });
        btn.onmouseenter = () => { btn.style.transform = 'scale(1.05)'; };
        btn.onmouseleave = () => { btn.style.transform = 'scale(1)'; };

        btn.addEventListener('click', () => runApplyAgent(profile));
        document.body.appendChild(btn);
    }
}

init();
