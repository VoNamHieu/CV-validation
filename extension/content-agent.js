/**
 * JobFit AI — Universal Apply Agent (v2 — Autonomous Agent)
 *
 * Replaces the linear single-shot form filler with an agentic loop:
 *   Observe → Plan → Act → Verify → Repeat
 *
 * Capabilities:
 *   - Scroll to discover lazy-loaded fields
 *   - Scan iframes, modals, shadow DOM
 *   - Handle custom dropdowns (React Select, MUI, Ant, Select2)
 *   - Navigate multi-step wizard forms
 *   - Upload CV files
 *   - Detect and recover from validation errors
 *   - Simulate keyboard typing for stubborn frameworks
 */

// ─── Config ───
const AGENT_MAX_ITERATIONS = 15;
const SCROLL_STEP_PX = 600;
const SCROLL_PAUSE_MS = 300;
const POST_ACTION_WAIT_MS = 1000;
const LLM_TIMEOUT = 30000;

// ─── Helpers ───
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        const observer = new MutationObserver(() => {
            const found = document.querySelector(selector);
            if (found) { observer.disconnect(); resolve(found); }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
    });
}

// ─── UI: Toast & Progress ───
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

function removeProgress() {
    document.getElementById('jobfit-progress')?.remove();
}

// ═══════════════════════════════════════════════════════════════════
// Phase 1: Enhanced DOM Extraction
// ═══════════════════════════════════════════════════════════════════

/**
 * Scroll the page top-to-bottom to trigger lazy loading, then back to top.
 */
async function scrollAndCollect() {
    const originalY = window.scrollY;
    const docHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
    );

    for (let y = 0; y < docHeight; y += SCROLL_STEP_PX) {
        window.scrollTo(0, y);
        await sleep(SCROLL_PAUSE_MS);
    }

    // Scroll back to original position
    window.scrollTo(0, originalY);
    await sleep(200);
}

/**
 * Find the active modal/dialog if one is open.
 */
function findActiveModal() {
    const selectors = [
        '.modal.show', '.modal.in', '[role="dialog"]:not([aria-hidden="true"])',
        '.MuiDialog-root', '.ant-modal-wrap:not(.ant-modal-wrap-hidden)',
        '.ReactModal__Content', '[class*="modal"][class*="open"]',
        '[class*="modal"][class*="active"]', '.fancybox-content',
    ];
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return el;
    }
    return null;
}

/**
 * Detect the component type of a form element.
 */
function detectComponentType(el) {
    // React Select
    if (el.closest('[class*="react-select"]') || el.closest('[class*="-control"]')?.querySelector('[class*="-placeholder"]')) {
        return 'react-select';
    }
    // MUI Autocomplete
    if (el.closest('[class*="MuiAutocomplete"]') || el.closest('.MuiSelect-root')) {
        return 'mui-autocomplete';
    }
    // Ant Design Select
    if (el.closest('.ant-select') || el.closest('.ant-picker')) {
        return el.closest('.ant-picker') ? 'datepicker' : 'ant-select';
    }
    // Select2
    if (el.closest('.select2-container') || el.nextElementSibling?.classList?.contains('select2-container')) {
        return 'select2';
    }
    // Native select
    if (el.tagName === 'SELECT') return 'native-select';
    // Datepicker
    if (el.type === 'date' || el.getAttribute('data-datepicker') || el.closest('[class*="datepicker"]') || el.closest('[class*="date-picker"]')) {
        return 'datepicker';
    }
    // File upload
    if (el.type === 'file') return 'file-upload';
    // Custom dropdown (div-based)
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('role') === 'listbox') {
        return 'custom-dropdown';
    }
    return 'native';
}

/**
 * Extract form fields from a DOM root (document, modal, or iframe doc).
 */
function extractFieldsFromRoot(root) {
    const fields = [];
    const seen = new Set();

    const elements = root.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), ' +
        'input[type="file"], ' +
        'select, textarea, [contenteditable="true"], ' +
        '[role="combobox"], [role="listbox"]'
    );

    for (const el of elements) {
        // Skip truly hidden elements (display:none / visibility:hidden) but NOT off-screen elements
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        const id = el.id || '';
        const name = el.name || '';
        const type = el.type || el.tagName.toLowerCase();
        const placeholder = el.placeholder || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const componentType = detectComponentType(el);

        // Find associated label
        let label = '';
        if (id) {
            const labelEl = root.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (labelEl) label = labelEl.textContent.trim();
        }
        if (!label) {
            const parent = el.closest('label, .form-group, .form-field, [class*="field"], [class*="input"], [class*="form-item"]');
            if (parent) {
                const labelEl = parent.querySelector('label, .label, [class*="label"], .ant-form-item-label');
                if (labelEl && labelEl !== el) label = labelEl.textContent.trim();
            }
        }

        // Build unique key
        const key = `${id}|${name}|${type}|${label}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Get current value
        let value = el.value || '';
        if (componentType === 'react-select') {
            const singleValue = el.closest('[class*="react-select"]')?.querySelector('[class*="-singleValue"]');
            if (singleValue) value = singleValue.textContent.trim();
        }

        // Get options for select elements
        let options = [];
        if (el.tagName === 'SELECT') {
            options = [...el.options].map(o => ({ value: o.value, text: o.textContent.trim() }));
        }

        // Check shadow DOM children
        if (el.shadowRoot) {
            const shadowFields = extractFieldsFromRoot(el.shadowRoot);
            fields.push(...shadowFields);
        }

        const classes = el.className?.toString().substring(0, 100) || '';

        // Build CSS selector
        let selector = '';
        if (id) selector = `#${CSS.escape(id)}`;
        else if (name) selector = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
        else selector = buildUniqueSelector(el);

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
            componentType,
            selector,
        });
    }

    return fields;
}

/**
 * Build a unique CSS selector for an element without id/name.
 */
function buildUniqueSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;

    const tag = el.tagName.toLowerCase();
    const classes = el.className?.toString().trim();
    if (classes) {
        const firstClass = classes.split(/\s+/)[0];
        if (firstClass) {
            const selector = `${tag}.${CSS.escape(firstClass)}`;
            if (document.querySelectorAll(selector).length === 1) return selector;
        }
    }
    // nth-child fallback
    const parent = el.parentElement;
    if (parent) {
        const siblings = [...parent.children].filter(c => c.tagName === el.tagName);
        const idx = siblings.indexOf(el);
        const parentSel = parent.id ? `#${CSS.escape(parent.id)}` : parent.tagName.toLowerCase();
        return `${parentSel} > ${tag}:nth-of-type(${idx + 1})`;
    }
    return tag;
}

/**
 * Enhanced form field extraction: scans modals, iframes, shadow DOM.
 */
function extractFormFields() {
    const modal = findActiveModal();
    const root = modal || document;

    let fields = extractFieldsFromRoot(root);

    // Scan same-origin iframes
    if (!modal) {
        try {
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
                try {
                    const iframeDoc = iframe.contentDocument;
                    if (iframeDoc) {
                        const iframeFields = extractFieldsFromRoot(iframeDoc);
                        fields.push(...iframeFields.map(f => ({ ...f, iframe: true })));
                    }
                } catch (e) {
                    // Cross-origin iframe — cannot access
                    console.warn('[JobFit Agent] Cannot access cross-origin iframe:', e.message);
                }
            }
        } catch (e) { /* ignore */ }
    }

    return fields;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 2: Custom UI Component Interaction
// ═══════════════════════════════════════════════════════════════════

/**
 * Set a value on an input using the native setter to trigger React/Vue reactivity.
 */
function setNativeValue(el, value) {
    const nativeSetter =
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set ||
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) {
        nativeSetter.call(el, value);
    } else {
        el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
}

/**
 * Simulate typing character by character (nuclear option for stubborn frameworks).
 */
async function simulateTyping(el, text) {
    el.focus();
    el.value = '';
    el.dispatchEvent(new Event('focus', { bubbles: true }));

    for (const char of text) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        el.value += char;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        await sleep(30);
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
}

/**
 * Handle React Select: click to open, type to search, select matching option.
 */
async function handleReactSelect(el, value) {
    const container = el.closest('[class*="react-select"]') || el.parentElement;
    if (!container) return false;

    // Click the control to open
    const control = container.querySelector('[class*="-control"]') || container;
    control.click();
    await sleep(400);

    // Find the input inside
    const input = container.querySelector('input');
    if (input) {
        setNativeValue(input, value);
        await sleep(500);
    }

    // Click the first matching option
    const options = document.querySelectorAll('[class*="-option"]');
    for (const opt of options) {
        if (opt.textContent?.trim().toLowerCase().includes(value.toLowerCase())) {
            opt.click();
            await sleep(200);
            return true;
        }
    }
    return false;
}

/**
 * Handle MUI Autocomplete/Select.
 */
async function handleMuiAutocomplete(el, value) {
    const container = el.closest('[class*="MuiAutocomplete"]') || el.closest('.MuiSelect-root') || el.parentElement;
    if (!container) return false;

    const input = container.querySelector('input') || el;
    input.focus();
    input.click();
    await sleep(400);

    if (input.tagName === 'INPUT') {
        setNativeValue(input, value);
        await sleep(500);
    }

    // Look for MUI listbox options
    const listbox = document.querySelector('[role="listbox"]');
    if (listbox) {
        const options = listbox.querySelectorAll('[role="option"], li');
        for (const opt of options) {
            if (opt.textContent?.trim().toLowerCase().includes(value.toLowerCase())) {
                opt.click();
                await sleep(200);
                return true;
            }
        }
    }
    return false;
}

/**
 * Handle Ant Design Select.
 */
async function handleAntSelect(el, value) {
    const container = el.closest('.ant-select') || el.parentElement;
    if (!container) return false;

    const selector = container.querySelector('.ant-select-selector') || container;
    selector.click();
    await sleep(400);

    const searchInput = document.querySelector('.ant-select-dropdown input, .ant-select-search__field');
    if (searchInput) {
        setNativeValue(searchInput, value);
        await sleep(500);
    }

    const options = document.querySelectorAll('.ant-select-item-option');
    for (const opt of options) {
        if (opt.textContent?.trim().toLowerCase().includes(value.toLowerCase())) {
            opt.click();
            await sleep(200);
            return true;
        }
    }
    return false;
}

/**
 * Handle Select2 dropdown.
 */
async function handleSelect2(el, value) {
    const container = el.closest('.form-group') || el.parentElement;
    const select2Container = container?.querySelector('.select2-container') ||
        el.nextElementSibling?.classList?.contains('select2-container') ? el.nextElementSibling : null;

    if (select2Container) {
        select2Container.click();
        await sleep(400);
    } else {
        // Try opening via the hidden select
        const event = new Event('select2:open', { bubbles: true });
        el.dispatchEvent(event);
        await sleep(400);
    }

    const searchInput = document.querySelector('.select2-search__field, .select2-search input');
    if (searchInput) {
        setNativeValue(searchInput, value);
        await sleep(500);

        const results = document.querySelectorAll('.select2-results__option');
        for (const r of results) {
            if (r.textContent?.trim().toLowerCase().includes(value.toLowerCase())) {
                r.click();
                await sleep(200);
                return true;
            }
        }
    }
    return false;
}

/**
 * Handle custom dropdown (role=combobox, etc).
 */
async function handleCustomDropdown(el, value) {
    el.click();
    await sleep(400);

    const allOptions = document.querySelectorAll(
        '[role="option"], li, label, .option-item, [class*="option"]'
    );
    for (const opt of allOptions) {
        if (opt.offsetParent !== null && opt.textContent?.trim().toLowerCase().includes(value.toLowerCase())) {
            const radio = opt.querySelector('input[type="radio"], input[type="checkbox"]');
            if (radio) radio.click();
            else opt.click();
            await sleep(200);
            return true;
        }
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 4: File Upload
// ═══════════════════════════════════════════════════════════════════

/**
 * Set a file on an input[type=file] using DataTransfer.
 */
function setFileOnInput(el, base64Data, fileName, mimeType = 'application/pdf') {
    try {
        const byteString = atob(base64Data);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
        const file = new File([ab], fileName, { type: mimeType });

        const dt = new DataTransfer();
        dt.items.add(file);
        el.files = dt.files;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    } catch (e) {
        console.warn('[JobFit Agent] File upload failed:', e);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3 + 5 + 6: Execute Fill Instructions (enhanced)
// ═══════════════════════════════════════════════════════════════════

/**
 * Execute a single fill instruction, choosing the right strategy based on component type.
 */
async function executeSingleInstruction(inst, cvData) {
    const el = document.querySelector(inst.selector);
    if (!el) {
        console.warn(`[JobFit Agent] Selector not found: ${inst.selector}`);
        return false;
    }

    const action = inst.action;
    const value = inst.value;
    const componentType = inst.componentType || 'native';

    try {
        // File upload
        if (action === 'upload') {
            if (cvData?.base64 && cvData?.fileName) {
                return setFileOnInput(el, cvData.base64, cvData.fileName);
            }
            console.warn('[JobFit Agent] Upload requested but no CV data available');
            return false;
        }

        // Click (for buttons, navigation)
        if (action === 'click') {
            el.click();
            return true;
        }

        // Custom select based on componentType
        if (action === 'custom-select' || action === 'select') {
            switch (componentType) {
                case 'react-select': return await handleReactSelect(el, value);
                case 'mui-autocomplete': return await handleMuiAutocomplete(el, value);
                case 'ant-select': return await handleAntSelect(el, value);
                case 'select2': return await handleSelect2(el, value);
                case 'custom-dropdown': return await handleCustomDropdown(el, value);
                case 'native-select':
                default:
                    if (el.tagName === 'SELECT') {
                        el.value = value;
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                    // If it's action=select but not a native select, try custom
                    return await handleCustomDropdown(el, value);
            }
        }

        // Datepicker
        if (action === 'datepicker') {
            // Try native value set first
            setNativeValue(el, value);
            await sleep(200);
            // Verify
            if (el.value === value) return true;
            // Fallback: simulate typing
            await simulateTyping(el, value);
            return true;
        }

        // Fill / Type (text input, textarea)
        if (action === 'fill' || action === 'type') {
            setNativeValue(el, value);
            await sleep(100);

            // Verify the value stuck
            if (el.value === value) return true;

            // Fallback: simulate typing
            console.log('[JobFit Agent] Value did not stick, trying keyboard simulation');
            await simulateTyping(el, value);
            return true;
        }

        console.warn(`[JobFit Agent] Unknown action: ${action}`);
        return false;
    } catch (err) {
        console.warn(`[JobFit Agent] Failed to execute:`, inst, err);
        return false;
    }
}

/**
 * Execute a batch of fill instructions.
 */
async function executeFillInstructions(instructions, cvData) {
    let filled = 0;
    for (const inst of instructions) {
        const success = await executeSingleInstruction(inst, cvData);
        if (success) filled++;
        await sleep(150);
    }
    return filled;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3: Observe Page State
// ═══════════════════════════════════════════════════════════════════

/**
 * Scan for visible buttons and classify them.
 */
function scanButtons() {
    const buttons = [];
    const allClickables = document.querySelectorAll('button, a[role="button"], [role="button"], input[type="submit"]');

    const navTexts = [
        'next', 'tiếp', 'tiep theo', 'continue', 'tiếp tục', 'kế tiếp',
        'previous', 'back', 'quay lại', 'trở về', 'prev',
    ];
    const submitTexts = [
        'submit', 'nộp', 'nop don', 'ứng tuyển', 'apply', 'gửi', 'hoàn tất',
        'complete', 'finish', 'xác nhận', 'confirm',
    ];
    const applyTexts = [
        'ứng tuyển', 'apply', 'nộp đơn', 'apply now', 'ứng tuyển ngay',
        'nộp hồ sơ', 'apply for this job', 'quick apply', 'easy apply',
    ];

    for (const el of allClickables) {
        if (!el.offsetParent) continue;
        const text = el.textContent?.trim().toLowerCase() || '';
        if (!text || text.length > 50) continue;

        let btnType = 'other';
        if (submitTexts.some(t => text.includes(t))) btnType = 'submit';
        else if (navTexts.some(t => text.includes(t))) btnType = 'navigation';
        else if (applyTexts.some(t => text.includes(t))) btnType = 'apply';

        let selector = '';
        if (el.id) selector = `#${CSS.escape(el.id)}`;
        else if (el.name) selector = `[name="${CSS.escape(el.name)}"]`;
        else selector = buildUniqueSelector(el);

        buttons.push({ text: el.textContent.trim(), selector, type: btnType });
    }

    return buttons;
}

/**
 * Detect validation errors on the page.
 */
function detectErrors() {
    const errors = [];
    const errorSelectors = [
        '.error', '.invalid-feedback', '.field-error', '[class*="error-msg"]',
        '[role="alert"]', '.text-danger', '.has-error', '.ant-form-item-explain-error',
        '.MuiFormHelperText-root.Mui-error', '[class*="validation-error"]',
    ];

    for (const sel of errorSelectors) {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
            if (!el.offsetParent) continue;
            const msg = el.textContent?.trim();
            if (!msg || msg.length > 200) continue;

            // Try to find the associated field
            let nearFieldSelector = '';
            const formGroup = el.closest('.form-group, .form-field, [class*="field"], .ant-form-item, .MuiFormControl-root');
            if (formGroup) {
                const input = formGroup.querySelector('input, select, textarea');
                if (input?.id) nearFieldSelector = `#${CSS.escape(input.id)}`;
                else if (input?.name) nearFieldSelector = `${input.tagName.toLowerCase()}[name="${CSS.escape(input.name)}"]`;
            }

            errors.push({ message: msg, nearFieldSelector });
        }
    }

    return errors;
}

/**
 * Detect step indicators for multi-step forms.
 */
function detectStepIndicator() {
    // Look for text patterns like "Step 2 of 4", "2/4", "Bước 2/4"
    const bodyText = document.body.innerText;
    const stepPatterns = [
        /(?:step|bước)\s*(\d+)\s*(?:of|\/|trên)\s*(\d+)/i,
        /(\d+)\s*\/\s*(\d+)\s*(?:steps?|bước)/i,
    ];
    for (const pat of stepPatterns) {
        const match = bodyText.match(pat);
        if (match) return { current: parseInt(match[1]), total: parseInt(match[2]) };
    }

    // Look for step/wizard DOM elements
    const stepEls = document.querySelectorAll('.step.active, .wizard-step.active, [class*="stepper"] [class*="active"], .ant-steps-item-process');
    if (stepEls.length > 0) {
        const allSteps = document.querySelectorAll('.step, .wizard-step, [class*="stepper"] [class*="step"], .ant-steps-item');
        if (allSteps.length > 1) {
            const activeIdx = [...allSteps].findIndex(s => s.classList.contains('active') || s.classList.contains('ant-steps-item-process'));
            return { current: activeIdx + 1, total: allSteps.length };
        }
    }

    return null;
}

/**
 * Detect success/completion signals.
 */
function detectCompletionSignals() {
    const signals = [];
    const successPatterns = [
        /(?:thank|cảm ơn|thành công|successfully|submitted|ứng tuyển thành công)/i,
        /(?:application.*(?:received|sent|submitted))/i,
        /(?:đã gửi|đã nộp|hoàn tất)/i,
    ];

    const bodyText = document.body.innerText.substring(0, 3000);
    for (const pat of successPatterns) {
        const match = bodyText.match(pat);
        if (match) signals.push(match[0]);
    }

    return signals;
}

/**
 * Full page state observation.
 */
async function observePageState() {
    const formFields = extractFormFields();
    const buttons = scanButtons();
    const errors = detectErrors();
    const stepIndicator = detectStepIndicator();
    const completionSignals = detectCompletionSignals();

    const unfilledRequired = formFields
        .filter(f => f.required && !f.value)
        .map(f => f.label || f.name || f.placeholder || f.id);

    return {
        url: window.location.href,
        formFields,
        buttons,
        errors,
        stepIndicator,
        completionSignals,
        unfilledRequired,
        totalFields: formFields.length,
    };
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3: LLM Communication
// ═══════════════════════════════════════════════════════════════════

/**
 * Call the original map-form endpoint (for simple single-step fills).
 */
async function callLLMMapping(formFields, profileData) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('LLM proxy timeout (30s)')), LLM_TIMEOUT);
        chrome.runtime.sendMessage({
            type: 'PROXY_LLM_MAP_FORM',
            formFields,
            profileData,
        }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) return reject(new Error(`Extension error: ${chrome.runtime.lastError.message}`));
            if (!response) return reject(new Error('No response from background'));
            if (response.success) resolve(response.data);
            else reject(new Error(response.error || 'LLM proxy failed'));
        });
    });
}

/**
 * Call the new agent-plan endpoint for the agentic loop.
 */
async function callAgentPlan(pageState, profileData, history, hasCV) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Agent plan timeout (30s)')), LLM_TIMEOUT);
        chrome.runtime.sendMessage({
            type: 'PROXY_LLM_AGENT_PLAN',
            pageState,
            profileData,
            history,
            hasCV,
        }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) return reject(new Error(`Extension error: ${chrome.runtime.lastError.message}`));
            if (!response) return reject(new Error('No response from background'));
            if (response.success) resolve(response.data);
            else reject(new Error(response.error || 'Agent plan failed'));
        });
    });
}

// ═══════════════════════════════════════════════════════════════════
// Find "Apply" button on page
// ═══════════════════════════════════════════════════════════════════

function findApplyButton() {
    const applyTexts = [
        'ứng tuyển', 'apply', 'nộp đơn', 'apply now',
        'ứng tuyển ngay', 'nộp hồ sơ', 'apply for this job',
        'quick apply', 'easy apply',
    ];

    const byClass = document.querySelector(
        '[class*="apply" i]:not(nav *), [class*="btn-apply" i], ' +
        'a[href*="apply"], button[data-action*="apply"]'
    );
    if (byClass && byClass.offsetParent) return byClass;

    const allClickables = document.querySelectorAll('button, a, [role="button"]');
    for (const el of allClickables) {
        const text = el.textContent?.trim().toLowerCase() || '';
        if (applyTexts.some(t => text.includes(t)) && el.offsetParent) {
            return el;
        }
    }

    return null;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3: Agentic Loop
// ═══════════════════════════════════════════════════════════════════

/**
 * Create a compact summary of page state for history tracking.
 */
function summarizeState(state) {
    return {
        url: state.url,
        fieldCount: state.formFields.length,
        unfilled: state.unfilledRequired.length,
        errors: state.errors.length,
        step: state.stepIndicator,
        buttons: state.buttons.map(b => b.text).slice(0, 5),
    };
}

/**
 * Main agentic loop: Observe → Plan → Act → Verify.
 */
async function runAgentLoop(profile) {
    const history = [];
    let prevStateHash = '';

    // Load CV data if available
    const cvData = await new Promise(r => {
        chrome.storage.local.get(['cvFileBase64', 'cvFileName'], d => {
            if (d.cvFileBase64 && d.cvFileName) {
                r({ base64: d.cvFileBase64, fileName: d.cvFileName });
            } else {
                r(null);
            }
        });
    });
    const hasCV = !!cvData;

    try {
        // Step 0: Find and click Apply button
        showProgress(0, AGENT_MAX_ITERATIONS, 'Tìm nút Ứng tuyển...');
        await sleep(1000);

        const applyBtn = findApplyButton();
        if (applyBtn) {
            applyBtn.click();
            showProgress(0, AGENT_MAX_ITERATIONS, 'Đã click nút Ứng tuyển, chờ form...');
            await sleep(2000);
        } else {
            showProgress(0, AGENT_MAX_ITERATIONS, 'Không tìm thấy nút Apply, scan form hiện tại...');
            await sleep(500);
        }

        // Scroll to discover all fields
        await scrollAndCollect();

        let sameStateCount = 0;

        for (let i = 0; i < AGENT_MAX_ITERATIONS; i++) {
            // ── 1. OBSERVE ──
            showProgress(i + 1, AGENT_MAX_ITERATIONS, 'Đang phân tích trang...');
            const state = await observePageState();

            // ── 2. CHECK TERMINATION ──
            // Success detected
            if (state.completionSignals.length > 0) {
                showProgress(i + 1, AGENT_MAX_ITERATIONS, 'Phát hiện ứng tuyển thành công!');
                removeProgress();
                await showConfirmation(state.totalFields, state.totalFields, true);
                reportResult(true, `Success detected: ${state.completionSignals[0]}`);
                return;
            }

            // No fields and no actionable buttons
            if (state.formFields.length === 0 && state.buttons.length === 0) {
                // Retry once — form might still be loading
                await sleep(2000);
                const retry = await observePageState();
                if (retry.formFields.length === 0) {
                    removeProgress();
                    showToast('❌ Không tìm thấy form ứng tuyển trên trang này.', 5000);
                    reportResult(false, 'No form found');
                    return;
                }
            }

            // Stuck detection: same state 3 times
            const stateHash = JSON.stringify(summarizeState(state));
            if (stateHash === prevStateHash) {
                sameStateCount++;
                if (sameStateCount >= 3) {
                    removeProgress();
                    showToast('⚠️ Agent bị stuck — dừng lại. Vui lòng điền thủ công.', 5000);
                    reportResult(false, 'Agent stuck — same state 3 iterations');
                    return;
                }
            } else {
                sameStateCount = 0;
                prevStateHash = stateHash;
            }

            // ── 3. PLAN: Ask LLM what to do next ──
            showProgress(i + 1, AGENT_MAX_ITERATIONS, `AI đang lên kế hoạch (iteration ${i + 1})...`);

            let plan;
            try {
                plan = await callAgentPlan(state, profile, history.slice(-8), hasCV);
            } catch (err) {
                // Fallback: use simple map-form for the first iteration
                if (i === 0 && state.formFields.length > 0) {
                    console.warn('[JobFit Agent] Agent plan failed, falling back to map-form:', err.message);
                    try {
                        const result = await callLLMMapping(state.formFields, profile);
                        plan = {
                            action: 'FILL',
                            instructions: result.instructions || [],
                            reason: 'Fallback to map-form',
                            waitMs: POST_ACTION_WAIT_MS,
                        };
                    } catch (fallbackErr) {
                        removeProgress();
                        showToast(`❌ Lỗi AI: ${fallbackErr.message}`, 5000);
                        reportResult(false, `LLM error: ${fallbackErr.message}`);
                        return;
                    }
                } else {
                    removeProgress();
                    showToast(`❌ Lỗi AI: ${err.message}`, 5000);
                    reportResult(false, `Agent plan error: ${err.message}`);
                    return;
                }
            }

            // ── 4. CHECK ACTION ──
            if (plan.action === 'DONE') {
                removeProgress();
                const filledCount = history.filter(h => h.plan?.action === 'FILL').reduce(
                    (sum, h) => sum + (h.result?.filled || 0), 0
                );
                await showConfirmation(filledCount, state.totalFields, false);
                reportResult(true, `Completed in ${i + 1} iterations, filled ~${filledCount} fields`);
                return;
            }

            if (plan.action === 'NEED_HUMAN') {
                removeProgress();
                showToast(`⚠️ Cần người dùng: ${plan.reason}`, 8000);
                reportResult(false, `Need human: ${plan.reason}`);
                return;
            }

            // ── 5. ACT ──
            let actionResult = {};
            showProgress(i + 1, AGENT_MAX_ITERATIONS, plan.reason || 'Đang thực hiện...');

            if (plan.action === 'FILL' && plan.instructions?.length > 0) {
                const filled = await executeFillInstructions(plan.instructions, cvData);
                actionResult = { filled, total: plan.instructions.length };
            } else if (plan.action === 'CLICK' && plan.clickTarget) {
                const target = document.querySelector(plan.clickTarget);
                if (target) {
                    target.click();
                    actionResult = { clicked: plan.clickTarget };
                } else {
                    actionResult = { error: `Click target not found: ${plan.clickTarget}` };
                }
            } else if (plan.action === 'SCROLL') {
                await scrollAndCollect();
                actionResult = { scrolled: true };
            } else if (plan.action === 'WAIT') {
                // Just wait
                actionResult = { waited: true };
            }

            // ── 6. RECORD HISTORY ──
            history.push({
                iteration: i,
                state: summarizeState(state),
                plan: { action: plan.action, reason: plan.reason },
                result: actionResult,
            });

            // ── 7. WAIT for page to react ──
            await sleep(plan.waitMs || POST_ACTION_WAIT_MS);
        }

        // Max iterations reached
        removeProgress();
        showToast('⚠️ Đã chạy tối đa iterations. Kiểm tra lại form.', 5000);
        reportResult(false, `Max iterations (${AGENT_MAX_ITERATIONS}) reached`);

    } catch (err) {
        removeProgress();
        showToast(`❌ Lỗi: ${err.message}`, 5000);
        reportResult(false, err.message);
    }
}

// ═══════════════════════════════════════════════════════════════════
// Confirmation Overlay
// ═══════════════════════════════════════════════════════════════════

function showConfirmation(filledCount, totalFields, isSuccess) {
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
        title.textContent = '⚡ JobFit AI — Auto Apply Agent';
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

// ─── Report result back to background ───
function reportResult(success, detail) {
    chrome.runtime.sendMessage({
        type: 'AUTO_APPLY_RESULT',
        result: { success, site: window.location.hostname, url: window.location.href, detail },
    }).catch(() => { });
}

// ═══════════════════════════════════════════════════════════════════
// Initialize
// ═══════════════════════════════════════════════════════════════════

async function init() {
    await sleep(1500);

    try {
        const data = await new Promise(r => {
            chrome.storage.local.get(['pendingAutoApply', 'jobfitProfile', 'batchMode'], r);
        });

        if (data.pendingAutoApply && data.jobfitProfile) {
            const isBatch = data.batchMode === true;

            await new Promise(r => {
                chrome.storage.local.remove(['pendingAutoApply', 'autoApplyJobUrl', 'batchMode'], r);
            });

            console.log(`[JobFit Agent] Auto-apply triggered (batch: ${isBatch})`);

            showToast(isBatch
                ? '🚀 Batch Apply — Đang xử lý job này...'
                : '🚀 JobFit AI Agent đang xử lý...', 0);
            await sleep(500);
            document.getElementById('jobfit-toast')?.remove();

            await runAgentLoop(data.jobfitProfile);
            return;
        }
    } catch (e) {
        console.warn('[JobFit Agent] Auto-apply check failed:', e);
        reportResult(false, `Init error: ${e.message}`);
    }

    // Normal mode: show floating button
    const profile = await new Promise(r => {
        chrome.storage.local.get('jobfitProfile', d => r(d.jobfitProfile || null));
    });

    if (profile) {
        const existingBtn = document.getElementById('jobfit-auto-apply-btn');
        if (existingBtn) return;

        const btn = document.createElement('button');
        btn.id = 'jobfit-auto-apply-btn';
        btn.textContent = '⚡ Auto Apply';
        btn.title = 'JobFit AI — Auto Apply Agent';
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

        btn.addEventListener('click', () => runAgentLoop(profile));
        document.body.appendChild(btn);
    }
}

init();
