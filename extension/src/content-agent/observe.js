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
 * Is this control REQUIRED? Read from the DOM, never from a recipe.
 *
 * Requiredness is per-tenant, not per-ATS: the same automation id is optional at
 * one company and mandatory at the next, so a list baked into shared config is
 * wrong somewhere by construction. The page is the only authority.
 *
 * Four signals because no single one is reliable. Measured on Mondelez: the
 * REQUIRED Degree and Language dropdowns carry `required=false` AND
 * `aria-required=null` — their asterisk lives in an <abbr> inside the field
 * wrapper. Reading only the input's own attributes made every required custom
 * select invisible, so `unfilledRequired` was empty on a step that could not
 * advance, and the planner was told there was nothing left to do.
 */
export function isRequiredField(el) {
    try {
        if (el.required || el.getAttribute('aria-required') === 'true') return true;
        const wrap = el.closest(
            '[data-automation-id^="formField-"], .form-group, .form-field, .ant-form-item, .MuiFormControl-root');
        if (!wrap) return false;
        if (wrap.querySelector('abbr')) return true;               // Workday's marker
        if (wrap.querySelector('[aria-required="true"]')) return true;
        const label = wrap.querySelector('label, legend');
        return !!label && /\*/.test(label.textContent || '');      // the universal one
    } catch { return false; }
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
            if (isRequiredField(el)) group.required = true;
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
                required: isRequiredField(el),
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
        // Workday multi-select: the input is a search box (always empty), but the
        // field IS filled when its selectedItemList holds a chip ("× Vietnam (+84)").
        // Read the chip so the agent doesn't count it as unfilled-required and keep
        // re-opening the dropdown to "fill" it instead of clicking Next.
        if (!value) {
            const sil = el.closest('[data-automation-id^="formField-"]')
                ?.querySelector('[data-automation-id="selectedItemList"]');
            const chip = sil ? (sil.textContent || '').replace(/\s+/g, ' ').trim() : '';
            if (chip) value = chip.slice(0, 60);
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
            required: isRequiredField(el),
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
    // Scope to the open dialog, exactly as extractFormFields does. Measured on
    // Workday's "Start Your Application" modal: scanning the whole document
    // offered the planner "Sign In", "Search for Jobs", the page's video control
    // bar and the "Apply" button behind the backdrop, alongside the three options
    // that were actually clickable. Every one of those is inert while the modal
    // is up, and each is a way for the planner to spend an iteration on nothing.
    const modal = findActiveModal();
    const root = modal || document;
    const allClickables = root.querySelectorAll('button, a[role="button"], [role="button"], input[type="submit"]');

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

/** Wording that states something is wrong with what was entered. */
const ERROR_TEXT_RE =
    /\berror\b|\binvalid\b|\brequired\b|must be|must contain|cannot be|can't be|is not valid|please (enter|select|provide|choose|correct|fix)|missing|too (short|long)|lỗi|bắt buộc|không hợp lệ|không được để trống|vui lòng (nhập|chọn|điền)|chưa (nhập|chọn|điền)/i;

/** Wording that is a page STATUS announcement — the thing live regions exist for. */
const STATUS_TEXT_RE =
    /\bis loaded\b|\bloaded\b|\bloading\b|\bpage\b.*\b(loaded|ready)\b|results? (found|updated|loaded)|\bsaved\b|\bsuccess/i;

/**
 * An ADVISORY, not a validation failure.
 *
 * Workday distinguishes the two and the agent did not. Measured on a real My
 * Information step: a legal name in capitals raises
 *
 *   "Alert - Family Name … Verify that the field Family Name is correctly
 *    capitalized because it contains more than 2 capital letters."
 *
 * in an "Alerts Found" panel. Nothing is wrong and Next works — but the
 * deterministic advance requires `errors.length === 0`, so counting an advisory
 * as an error withholds the click for as long as the advisory is on screen, i.e.
 * forever. That is a step that fills perfectly and then never moves, with no
 * failure anywhere to point at.
 *
 * Checked BEFORE the error vocabulary, because these sentences legitimately
 * contain error-ish words ("must", "cannot") while asking the user to confirm
 * something rather than fix it.
 */
const ADVISORY_TEXT_RE =
    /^alert\b|\balert -|verify that|please (verify|confirm|review)|we recommend|for your information|xác nhận lại|kiểm tra lại/i;

/**
 * Does this live-region text actually report a validation problem?
 *
 * Split out as a pure function because it is a judgement about language, and the
 * cost of getting it wrong is not obvious from the DOM: a false error is fed to
 * the planner every iteration as evidence the form is failing, which is exactly
 * how "Sales Specialist page is loaded" ended up in an agent's error list.
 *
 * A live region INSIDE a form-field wrapper is trusted without a text match —
 * that is where frameworks put a field's own error, and its wording is
 * unpredictable. Everywhere else needs the text to say something went wrong,
 * and a status announcement is rejected outright even if it happens to contain
 * an error-ish word.
 */
export function isLikelyValidationError(text, { inFieldWrapper = false } = {}) {
    const t = String(text || '').trim();
    if (!t) return false;
    // An advisory is not a failure, wherever it is rendered — including inside a
    // field wrapper, where the old rule treated anything non-status as an error.
    if (ADVISORY_TEXT_RE.test(t)) return false;
    if (inFieldWrapper) return !STATUS_TEXT_RE.test(t);
    if (STATUS_TEXT_RE.test(t)) return false;
    return ERROR_TEXT_RE.test(t);
}

/**
 * Detect validation errors on the page.
 */
export function detectErrors() {
    const errors = [];
    const seen = new Set();
    // Selectors that NAME an error. Whatever they contain is one.
    const errorSelectors = [
        '.error', '.invalid-feedback', '.field-error', '[class*="error-msg"]',
        '.text-danger', '.has-error', '.ant-form-item-explain-error',
        '.MuiFormHelperText-root.Mui-error', '[class*="validation-error"]',
        // Workday: a failed field renders an errorMessage node inside its formField
        // wrapper; page-level issues use errorSummary. Without these the agent was
        // blind to why "Next" wouldn't advance and looped until it stalled.
        '[data-automation-id="errorMessage"]', '[data-automation-id="formFieldError"]',
        '[data-automation-id="errorSummary"]',
    ];
    // Selectors that are a DELIVERY MECHANISM, not a verdict — see
    // isLikelyValidationError. `role="alert"` is how a page announces anything
    // urgent to a screen reader; on a Workday job page it carries "Sales
    // Specialist page is loaded", which was reported as a validation error on
    // every single iteration and shipped to the planner as evidence the form was
    // failing. A banner is the same shape: it can just as easily say a draft was
    // saved.
    const ambiguousSelectors = ['[role="alert"]', '[data-automation-id="alertBanner"]'];

    for (const sel of [...errorSelectors, ...ambiguousSelectors]) {
        const ambiguous = ambiguousSelectors.includes(sel);
        for (const el of document.querySelectorAll(sel)) {
            if (!el.offsetParent) continue;
            const msg = el.textContent?.trim();
            if (!msg || msg.length > 200 || seen.has(msg)) continue;

            // Associate with the nearest field — Workday formField wrapper first (so
            // we can name the field), then a generic form-group.
            let nearFieldSelector = '';
            let field = '';
            const wd = el.closest('[data-automation-id^="formField-"]');
            if (ambiguous && !isLikelyValidationError(msg, { inFieldWrapper: !!wd })) continue;
            // An advisory is skipped even from a selector NAMED for errors.
            // Workday renders its "Alerts Found" summary in the same furniture as
            // its error summary, so trusting the selector name here would let a
            // capitalization advisory withhold the step advance indefinitely —
            // `errors.length === 0` is a precondition for it. Wording decides,
            // not the container.
            if (!ambiguous && ADVISORY_TEXT_RE.test(msg)) continue;
            seen.add(msg);
            if (wd) {
                nearFieldSelector = `[data-automation-id="${wd.getAttribute('data-automation-id')}"]`;
                field = findLabelFor(wd.querySelector('input, textarea, button') || wd, document);
            } else {
                const formGroup = el.closest('.form-group, .form-field, [class*="field"], .ant-form-item, .MuiFormControl-root');
                const input = formGroup?.querySelector('input, select, textarea');
                if (input?.id) nearFieldSelector = `#${CSS.escape(input.id)}`;
                else if (input?.name) nearFieldSelector = `${input.tagName.toLowerCase()}[name="${CSS.escape(input.name)}"]`;
            }
            errors.push({ message: msg, field: field || undefined, nearFieldSelector });
        }
    }

    // aria-invalid controls whose message node may not match the selectors above —
    // Workday flips this on the input itself, so surface the field even bare.
    for (const inv of document.querySelectorAll('[aria-invalid="true"]')) {
        if (!inv.offsetParent) continue;
        const wrap = inv.closest('[data-automation-id^="formField-"]');
        const label = findLabelFor(inv, document) || wrap?.getAttribute('data-automation-id') || 'field';
        const key = `invalid:${label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        errors.push({
            message: `${label}: invalid or required`,
            field: label,
            nearFieldSelector: wrap ? `[data-automation-id="${wrap.getAttribute('data-automation-id')}"]` : '',
        });
    }

    return errors;
}

/**
 * Audit which REQUIRED fields are still empty/invalid — i.e. WHY "Next"/"Submit"
 * won't advance. The generic scanners miss custom widgets (Workday's degree
 * dropdown, its MM/YYYY date groups) that aren't <input>s, so a step blocked by
 * one of those reads as "stuck" with no explanation. Returns [{label, kind}] so the
 * agent can say what's missing and (recipe) try to fill it instead of looping.
 */
export function auditRequiredBlockers() {
    const out = [];
    const seen = new Set();
    const push = (label, kind) => { const k = `${kind}:${label}`; if (label && !seen.has(k)) { seen.add(k); out.push({ label, kind }); } };
    const labelOf = (el) => {
        const wrap = el.closest?.('[data-automation-id^="formField-"]');
        const l = (wrap?.querySelector('label, legend')?.textContent) || el.getAttribute?.('aria-label') || '';
        return l.replace(/\*/g, ' ').replace(/\brequired\b/i, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    };
    const isRequired = (el) => {
        const wrap = el.closest?.('[data-automation-id^="formField-"]');
        return el.getAttribute?.('aria-required') === 'true' || el.required
            || !!wrap?.querySelector('abbr') || /required/i.test(el.getAttribute?.('aria-label') || '');
    };
    // 1) text / tel / email / textarea inputs
    for (const inp of document.querySelectorAll('input[type="text"], input[type="tel"], input[type="email"], input:not([type]), textarea')) {
        if (inp.offsetParent === null) continue;
        if (isRequired(inp) && !String(inp.value || '').trim()) push(labelOf(inp), 'text');
    }
    // 2) custom-select buttons (Workday: button[aria-haspopup=listbox] showing "Select One")
    for (const btn of document.querySelectorAll('button[aria-haspopup="listbox"], [data-automation-id^="formField-"] button[aria-haspopup]')) {
        if (btn.offsetParent === null) continue;
        const unset = !String(btn.getAttribute('value') || '').trim() && /select one|choose|^\s*$/i.test((btn.textContent || '').trim());
        if (isRequired(btn) && unset) push(labelOf(btn), 'dropdown');
    }
    // 3) date groups (Workday dateInputWrapper) — empty when no digits are present
    for (const dg of document.querySelectorAll('[data-automation-id="dateInputWrapper"]')) {
        if (dg.offsetParent === null) continue;
        const wrap = dg.closest('[data-automation-id^="formField-"]');
        if (!wrap?.querySelector('abbr')) continue;   // required only
        const help = wrap.querySelector('[id^="helpText"]')?.textContent || '';
        if (!/\d/.test(help) && !/\d/.test(dg.textContent || '')) push(labelOf(dg), 'date');
    }
    // 4) visible validation errors already on screen. `role="alert"` is filtered
    //    the same way detectErrors filters it — otherwise the "blockers" report
    //    the agent shows the user when it gives up would name a page-load
    //    announcement as the reason the step won't advance.
    for (const e of document.querySelectorAll('[data-automation-id="errorMessage"], [data-automation-id="errorSummary"], [role="alert"]')) {
        if (e.offsetParent === null) continue;
        const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t) continue;
        const isLiveRegion = e.getAttribute?.('role') === 'alert';
        if (isLiveRegion && !isLikelyValidationError(t, {
            inFieldWrapper: !!e.closest?.('[data-automation-id^="formField-"]'),
        })) continue;
        push(t.slice(0, 60), 'error');
    }
    return out;
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
