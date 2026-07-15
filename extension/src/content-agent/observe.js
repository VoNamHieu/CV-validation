// AUTO-SPLIT from content-agent.js (Phase 2). Part of the Copo apply agent.
import { SCROLL_PAUSE_MS, SCROLL_STEP_PX } from './constants.js';
import { buildUniqueSelector, detectComponentType, findActiveModal, findLabelFor, getNearbyText, sleep } from './dom.js';
import { isThirdPartyApply } from './detect.js';

/**
 * Scroll the page top-to-bottom to trigger lazy loading, then back to top.
 */
export async function scrollAndCollect() {
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

    // Also scroll inside the active modal (if any) — many apply forms live in
    // a scrollable dialog whose body doesn't move when the window scrolls.
    const modal = findActiveModal();
    if (modal) {
        const scrollEls = [modal, ...modal.querySelectorAll('div, section, main')]
            .filter(el => {
                const s = window.getComputedStyle(el);
                return (s.overflowY === 'auto' || s.overflowY === 'scroll')
                    && el.scrollHeight > el.clientHeight + 40
                    && el.clientHeight > 150;
            })
            .slice(0, 3);
        for (const el of scrollEls) {
            const origTop = el.scrollTop;
            for (let y = 0; y < el.scrollHeight; y += SCROLL_STEP_PX) {
                el.scrollTop = y;
                await sleep(SCROLL_PAUSE_MS);
            }
            el.scrollTop = origTop;
        }
    }
}

/**
 * Extract form fields from a DOM root (document, modal, or iframe doc).
 */
export function extractFieldsFromRoot(root) {
    const fields = [];
    const seenEl = new WeakSet(); // dedupe by element identity (selectors can overlap)
    const radioGroups = new Map(); // name → group entry

    const elements = root.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), ' +
        'input[type="file"], ' +
        'select, textarea, [contenteditable="true"], ' +
        '[role="combobox"], [role="listbox"], [role="radiogroup"]'
    );

    for (const el of elements) {
        if (seenEl.has(el)) continue;
        seenEl.add(el);

        // Skip truly hidden elements (display:none / visibility:hidden) but NOT off-screen elements.
        // Exception: <input type="file"> is routinely hidden behind a styled button/label —
        // the file can still be set programmatically via DataTransfer, so keep it.
        const style = window.getComputedStyle(el);
        const isHidden = style.display === 'none' || style.visibility === 'hidden';
        if (isHidden && el.type !== 'file') continue;

        // ── Radio: group by `name`, emit one field per group with options ──
        if (el.type === 'radio' && el.name) {
            const groupName = el.name;
            if (!radioGroups.has(groupName)) {
                radioGroups.set(groupName, {
                    name: groupName,
                    options: [],
                    label: '',
                    required: false,
                    value: '',
                });
            }
            const group = radioGroups.get(groupName);
            const optLabel =
                (el.id && root.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim()) ||
                el.closest('label')?.textContent?.trim() ||
                el.value || '';
            group.options.push({ value: el.value, text: optLabel });
            if (el.checked) group.value = el.value;
            if (el.required || el.getAttribute('aria-required') === 'true') group.required = true;
            if (!group.label) group.label = findLabelFor(el, root);
            if (!group.nearbyText) group.nearbyText = getNearbyText(el);
            continue;
        }

        // ── Standalone checkbox ──
        if (el.type === 'checkbox') {
            const label = findLabelFor(el, root);
            const selector = el.id
                ? `#${CSS.escape(el.id)}`
                : (el.name ? `input[type="checkbox"][name="${CSS.escape(el.name)}"]` : buildUniqueSelector(el));
            fields.push({
                index: fields.length,
                tag: 'input',
                type: 'checkbox',
                id: el.id || '',
                name: el.name || '',
                label,
                nearbyText: getNearbyText(el),
                placeholder: '',
                ariaLabel: el.getAttribute('aria-label') || '',
                classes: el.className?.toString().substring(0, 100) || '',
                value: el.checked ? 'true' : 'false',
                required: el.required || el.getAttribute('aria-required') === 'true',
                componentType: 'checkbox',
                selector,
            });
            continue;
        }

        const id = el.id || '';
        const name = el.name || '';
        const type = el.type || el.tagName.toLowerCase();
        const placeholder = el.placeholder || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const componentType = detectComponentType(el);

        // Find associated label (via shared helper)
        const label = findLabelFor(el, root);

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
            nearbyText: getNearbyText(el),
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

    // Emit one entry per radio group
    for (const [name, group] of radioGroups) {
        fields.push({
            index: fields.length,
            tag: 'input',
            type: 'radio',
            id: '',
            name,
            label: group.label,
            nearbyText: group.nearbyText || '',
            placeholder: '',
            ariaLabel: '',
            classes: '',
            value: group.value,
            options: group.options.slice(0, 30),
            required: group.required,
            componentType: 'radio-group',
            selector: `input[type="radio"][name="${CSS.escape(name)}"]`,
        });
    }

    return fields;
}

/**
 * Enhanced form field extraction: scans modals, iframes, shadow DOM.
 */
export function extractFormFields() {
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
                    console.warn('[Copo Agent] Cannot access cross-origin iframe:', e.message);
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
 * Scan for visible buttons and classify them.
 */
export function scanButtons() {
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
        // Never offer a third-party "Apply with Indeed/LinkedIn" shortcut to the
        // LLM — clicking it hands the flow to a foreign login and loops.
        if (isThirdPartyApply(el)) continue;
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
export function detectErrors() {
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
export function detectStepIndicator() {
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
 * Detect things that block automation: captchas, login walls, Cloudflare challenges.
 * Returns an array — empty means the page is interactable.
 */
export function detectBlockers() {
    const blockers = [];

    // reCAPTCHA (v2 / v3 invisible — anything that needs user solve)
    if (document.querySelector(
        'iframe[src*="recaptcha/api2"], iframe[src*="google.com/recaptcha"], .g-recaptcha, [data-sitekey][class*="recaptcha"]'
    )) {
        // v3 is invisible — only flag v2 (checkbox) or visible challenge frames
        const visibleChallenge = [...document.querySelectorAll('iframe[src*="recaptcha"]')].some(
            f => f.offsetParent !== null && f.getBoundingClientRect().width > 100
        );
        if (visibleChallenge || document.querySelector('.g-recaptcha')) {
            blockers.push({ type: 'recaptcha', message: 'Google reCAPTCHA cần người dùng giải' });
        }
    }

    // hCaptcha
    if (document.querySelector('iframe[src*="hcaptcha.com"], .h-captcha')) {
        blockers.push({ type: 'hcaptcha', message: 'hCaptcha cần người dùng giải' });
    }

    // Cloudflare interactive challenge
    if (document.querySelector(
        'iframe[src*="challenges.cloudflare.com"], #cf-challenge-stage, #challenge-form, [class*="cf-turnstile"]'
    )) {
        blockers.push({ type: 'cloudflare', message: 'Cloudflare challenge' });
    }

    // Login wall: visible password input + "sign in / log in / đăng nhập" wording
    const pw = document.querySelector('input[type="password"]');
    if (pw && pw.offsetParent !== null) {
        const scope = pw.closest('form')?.textContent?.toLowerCase() ||
            document.body.innerText.toLowerCase().substring(0, 3000);
        if (/\b(sign in|log in|login|đăng nhập)\b/.test(scope)) {
            blockers.push({ type: 'login', message: 'Trang yêu cầu đăng nhập' });
        }
    }

    return blockers;
}

/**
 * Detect success/completion signals.
 */
export function detectCompletionSignals() {
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
 * Capture the visible text of the active form area as a single block.
 * Lets the LLM see headings / instructions / required-field hints that aren't
 * attached to any specific input via a label.
 */
export function getFormContext(maxChars = 3000) {
    const root = findActiveModal()
        || document.querySelector('form')
        || document.querySelector('main')
        || document.body;
    if (!root) return '';
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script, style, nav, header, footer, svg').forEach(n => n.remove());
    const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > maxChars ? text.slice(0, maxChars) + '…' : text;
}

/**
 * Full page state observation.
 */
export async function observePageState() {
    const formFields = extractFormFields();
    const buttons = scanButtons();
    const errors = detectErrors();
    const stepIndicator = detectStepIndicator();
    const completionSignals = detectCompletionSignals();
    const blockers = detectBlockers();
    const formContext = getFormContext();

    const unfilledRequired = formFields
        .filter(f => f.required && !f.value)
        .map(f => f.label || f.name || f.placeholder || f.id);

    return {
        url: window.location.href,
        formFields,
        formContext,
        buttons,
        errors,
        stepIndicator,
        completionSignals,
        blockers,
        unfilledRequired,
        totalFields: formFields.length,
    };
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3: LLM Communication
// ═══════════════════════════════════════════════════════════════════
