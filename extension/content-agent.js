/**
 * Copo — Universal Apply Agent (v2 — Autonomous Agent)
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
const AGENT_MAX_ITERATIONS = 25;
const SCROLL_STEP_PX = 600;
const SCROLL_PAUSE_MS = 300;
const POST_ACTION_WAIT_MS = 1000;
const LLM_TIMEOUT = 30000;
const JOB_PAGE_DETECT_TIMEOUT_MS = 8000;
const JOB_PAGE_DETECT_POLL_MS = 600;
const FILL_RETRY_THRESHOLD = 2; // After N failed fill attempts on same selector → mark persistently unfilled

// URL keywords that strongly hint at a job/apply page
const JOB_URL_KEYWORDS = [
    'apply', 'application', 'job', 'jobs', 'career', 'careers', 'hiring',
    'recruit', 'vacancy', 'position', 'opening',
    'viec-lam', 'tuyen-dung', 'ung-tuyen', 'tim-viec',
    'workday', 'greenhouse', 'lever.co', 'ashbyhq', 'smartrecruiters',
    'icims', 'taleo', 'jobvite', 'breezy', 'bamboohr',
];

// Apply-button text (en + vi)
const APPLY_BUTTON_TEXTS = [
    'apply now', 'apply', 'easy apply', 'quick apply', 'submit application',
    'ứng tuyển', 'nộp đơn', 'nộp hồ sơ', 'ứng tuyển ngay',
];

// Hosts where the agent must never appear. Social / search / media / mail
// sites routinely render multi-input login, signup, and search forms that
// falsely trip the job-page heuristics (this is why the button showed up on
// Instagram). Real job sites (LinkedIn, etc.) are deliberately NOT listed.
const DENY_HOST_SUFFIXES = [
    'instagram.com', 'facebook.com', 'fb.com', 'messenger.com', 'whatsapp.com',
    'twitter.com', 'x.com', 'threads.net', 'tiktok.com', 'reddit.com',
    'pinterest.com', 'snapchat.com', 'youtube.com', 'netflix.com', 'twitch.tv',
    'spotify.com', 'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com',
    'gmail.com', 'outlook.com', 'telegram.org', 'discord.com',
];

// Words that confirm a page is really about a job/application. Used to validate
// a form-only match — a bare login/contact/search form is not enough on its own.
const JOB_CONTEXT_KEYWORDS = [
    'job', 'career', 'vacancy', 'position', 'recruit', 'hiring', 'employment',
    'apply', 'application', 'resume', 'cover letter',
    'tuyển dụng', 'việc làm', 'ứng tuyển', 'vị trí', 'tuyển',
];

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
    // Radio / checkbox handled separately via radio-group / checkbox componentTypes
    if (el.type === 'checkbox') return 'checkbox';
    if (el.type === 'radio') return 'radio-group';
    // Custom dropdown (div-based)
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('role') === 'listbox') {
        return 'custom-dropdown';
    }
    return 'native';
}

/**
 * Find a label for an element by checking <label for=>, parent label, fieldset legend, and form-group containers.
 */
/**
 * Walk up ancestors and capture the surrounding text. Used as fallback context
 * when label/placeholder are empty — gives the LLM enough to infer field intent
 * (e.g., a `<div>` headline above a bare input). Strips other form controls so
 * the captured text doesn't include sibling field values.
 */
function getNearbyText(el, maxChars = 300) {
    let cur = el.parentElement;
    let depth = 0;
    while (cur && depth < 6) {
        const clone = cur.cloneNode(true);
        clone.querySelectorAll('input, select, textarea, button, script, style, svg').forEach(n => n.remove());
        const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 5) {
            return text.length > maxChars ? text.slice(0, maxChars) + '…' : text;
        }
        cur = cur.parentElement;
        depth++;
    }
    return '';
}

function findLabelFor(el, root) {
    if (el.id) {
        const labelEl = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (labelEl) return labelEl.textContent.trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel) {
        // Exclude the input's own value text from the label
        const clone = parentLabel.cloneNode(true);
        clone.querySelectorAll('input, select, textarea').forEach(n => n.remove());
        const text = clone.textContent.trim();
        if (text) return text;
    }
    const fieldset = el.closest('fieldset');
    const legend = fieldset?.querySelector('legend');
    if (legend) return legend.textContent.trim();
    const parent = el.closest('.form-group, .form-field, [class*="field"], [class*="input"], [class*="form-item"]');
    if (parent) {
        const labelEl = parent.querySelector('label, .label, [class*="label"], .ant-form-item-label');
        if (labelEl && labelEl !== el) return labelEl.textContent.trim();
    }
    return '';
}

/**
 * Extract form fields from a DOM root (document, modal, or iframe doc).
 */
function extractFieldsFromRoot(root) {
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
    // Operator precedence: `||` binds tighter than `?:`, so this needs explicit grouping
    // to avoid select2Container always being el.nextElementSibling.
    const fromContainer = container?.querySelector('.select2-container') || null;
    const fromSibling = el.nextElementSibling?.classList?.contains('select2-container')
        ? el.nextElementSibling
        : null;
    const select2Container = fromContainer || fromSibling;

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

/**
 * Handle a radio group: click the radio whose label/value matches `value`.
 * Accepts either the group name (when called with a name string selector)
 * or any radio element in the group.
 */
async function handleRadioGroup(elOrName, value) {
    const name = typeof elOrName === 'string'
        ? elOrName
        : (elOrName.name || '');
    const radios = name
        ? document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)
        : (elOrName instanceof Element ? [elOrName] : []);
    if (!radios.length) return false;

    const lower = String(value ?? '').toLowerCase().trim();
    if (!lower) return false;

    let match = null;
    let fallback = null;
    for (const r of radios) {
        const lblEl = r.id ? document.querySelector(`label[for="${CSS.escape(r.id)}"]`) : null;
        const lblText = (lblEl?.textContent?.trim() ||
            r.closest('label')?.textContent?.trim() ||
            r.value || '').toLowerCase();
        if (String(r.value).toLowerCase() === lower) { match = r; break; }
        if (lblText === lower) { match = r; break; }
        if (!fallback && (lblText.includes(lower) || lower.includes(lblText))) fallback = r;
    }
    const target = match || fallback;
    if (!target) return false;

    target.click();
    if (!target.checked) {
        target.checked = true;
        target.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
}

/**
 * Handle a checkbox: toggle to match `value` (truthy → checked).
 */
async function handleCheckbox(el, value) {
    const want = value === true || value === 1 ||
        ['true', 'yes', '1', 'on', 'checked', 'có', 'đồng ý'].includes(
            String(value ?? '').toLowerCase().trim()
        );
    if (el.checked !== want) {
        el.click();
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
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
        console.warn('[Copo Agent] File upload failed:', e);
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
        console.warn(`[Copo Agent] Selector not found: ${inst.selector}`);
        return false;
    }

    const action = inst.action;
    const value = inst.value;
    const componentType = inst.componentType || 'native';

    // Never fill credential inputs — profile data must not end up in a
    // password box, and page text can't talk the planner into it (the server
    // also filters these, this is the last line of defense).
    if (el.type === 'password') {
        console.warn(`[Copo Agent] Refusing to fill password field: ${inst.selector}`);
        return false;
    }

    try {
        // File upload
        if (action === 'upload') {
            if (cvData?.base64 && cvData?.fileName) {
                return setFileOnInput(el, cvData.base64, cvData.fileName);
            }
            console.warn('[Copo Agent] Upload requested but no CV data available');
            return false;
        }

        // Click (for buttons, navigation)
        if (action === 'click') {
            el.click();
            return true;
        }

        // Radio group
        if (action === 'radio' || componentType === 'radio-group') {
            return await handleRadioGroup(inst.name || el, value);
        }

        // Checkbox
        if (action === 'checkbox' || componentType === 'checkbox') {
            return await handleCheckbox(el, value);
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
                        // Match by option value first, then by visible text — the LLM
                        // often returns the label rather than the underlying value.
                        const wanted = String(value).trim().toLowerCase();
                        const opt = [...el.options].find(o =>
                            o.value.trim().toLowerCase() === wanted ||
                            o.textContent.trim().toLowerCase() === wanted
                        ) || [...el.options].find(o =>
                            o.textContent.trim().toLowerCase().includes(wanted)
                        );
                        if (!opt) return false;  // no match — report failure so retry logic kicks in
                        el.value = opt.value;
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
            // Fallback: simulate typing. Datepickers routinely reformat what we
            // type (2024-01-02 → 02/01/2024), so "non-empty" is the honest check.
            await simulateTyping(el, value);
            return String(el.value || '').trim() !== '';
        }

        // Fill / Type (text input, textarea)
        if (action === 'fill' || action === 'type') {
            setNativeValue(el, value);
            await sleep(100);

            // Verify the value stuck
            if (el.value === value) return true;

            // Fallback: simulate typing
            console.log('[Copo Agent] Value did not stick, trying keyboard simulation');
            await simulateTyping(el, value);
            // Verify again — claiming success here without checking inflates the
            // `filled` count the planner sees and hides persistently-broken fields.
            // Input masks may reformat (phone → "(+84) ..."), so accept any
            // non-empty value as "stuck".
            if (el.value === value) return true;
            return String(el.value || '').trim() !== '';
        }

        console.warn(`[Copo Agent] Unknown action: ${action}`);
        return false;
    } catch (err) {
        console.warn(`[Copo Agent] Failed to execute:`, inst, err);
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
 * Detect things that block automation: captchas, login walls, Cloudflare challenges.
 * Returns an array — empty means the page is interactable.
 */
function detectBlockers() {
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
 * Capture the visible text of the active form area as a single block.
 * Lets the LLM see headings / instructions / required-field hints that aren't
 * attached to any specific input via a label.
 */
function getFormContext(maxChars = 3000) {
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
async function observePageState() {
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
        blockers: (state.blockers || []).map(b => b.type),
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
    let prevStepCurrent = null;
    let prevUrl = window.location.href;
    const fillAttempts = new Map(); // selector → { count, lastValue }
    const persistentlyUnfilled = new Set();
    // Completion signals present BEFORE we act. Job pages often contain static
    // marketing copy that matches the success regexes ("ứng tuyển thành công
    // trong 1 phút", "Cảm ơn bạn đã quan tâm..."), so only signals that APPEAR
    // after we actually did something count as a submitted application.
    let baselineSignals = null;
    let actionsTaken = 0;

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
    console.log('[Copo Apply] ▶ runAgentLoop start', {
        url: location.href, host: location.hostname, hasCV,
        profileFields: Object.keys(profile || {}).length,
    });

    try {
        // Step 0: Find and click Apply button
        showProgress(0, AGENT_MAX_ITERATIONS, 'Tìm nút Ứng tuyển...');
        await sleep(1000);

        const applyBtn = findApplyButton();
        if (applyBtn) {
            console.log('[Copo Apply] step0: clicked Apply button:', (applyBtn.innerText || applyBtn.value || '').trim().slice(0, 40));
            applyBtn.click();
            showProgress(0, AGENT_MAX_ITERATIONS, 'Đã click nút Ứng tuyển, chờ form...');
            await sleep(2000);
        } else {
            console.log('[Copo Apply] step0: no Apply button found — scanning current form');
            showProgress(0, AGENT_MAX_ITERATIONS, 'Không tìm thấy nút Apply, scan form hiện tại...');
            await sleep(500);
        }

        // Scroll to discover all fields
        await scrollAndCollect();

        let sameStateCount = 0;

        for (let i = 0; i < AGENT_MAX_ITERATIONS; i++) {
            // Keep the background watchdog alive — an iteration can legitimately
            // take minutes (LLM call + waits), the timer should only fire when
            // this page goes silent.
            sendHeartbeat();

            // ── 1. OBSERVE ──
            showProgress(i + 1, AGENT_MAX_ITERATIONS, 'Đang phân tích trang...');
            const state = await observePageState();

            // ── 2. CHECK TERMINATION ──
            if (baselineSignals === null) baselineSignals = new Set(state.completionSignals);
            const newSignals = state.completionSignals.filter(s => !baselineSignals.has(s));
            // Success = a NEW signal appeared after at least one real action.
            if (newSignals.length > 0 && actionsTaken > 0) {
                showProgress(i + 1, AGENT_MAX_ITERATIONS, 'Phát hiện ứng tuyển thành công!');
                removeProgress();
                reportResult(true, `Success detected: ${newSignals[0]}`, 'submitted');
                showConfirmation(state.totalFields, state.totalFields, true);
                return;
            }

            // Blockers (captcha, login wall) are reported to the LLM via state.blockers
            // (see line 1138). Don't bail here — let the LLM keep filling non-blocker
            // fields and decide NEED_HUMAN itself only when there's nothing left to fill.

            // Step changed (multi-step wizard advanced) or URL changed → reset
            // stuck-detection state so a fresh page doesn't trip false positives.
            const curStep = state.stepIndicator?.current ?? null;
            if (curStep !== prevStepCurrent || state.url !== prevUrl) {
                prevStateHash = '';
                fillAttempts.clear();
                persistentlyUnfilled.clear();
                prevStepCurrent = curStep;
                prevUrl = state.url;
            }

            // Detect fields the LLM previously tried to fill but stayed empty.
            // Pass these back so the LLM can try a different strategy or escalate.
            for (const [selector, attempt] of fillAttempts) {
                const field = state.formFields.find(f => f.selector === selector);
                if (!field) continue;
                const stillEmpty = !field.value || String(field.value).trim() === '';
                if (stillEmpty && attempt.count >= FILL_RETRY_THRESHOLD) {
                    persistentlyUnfilled.add(selector);
                }
            }
            state.persistentlyUnfilled = [...persistentlyUnfilled];

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
                    console.warn('[Copo Agent] Agent plan failed, falling back to map-form:', err.message);
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

            console.log(`[Copo Apply] iter ${i + 1}/${AGENT_MAX_ITERATIONS}: fields=${state.formFields.length} → action=${plan.action}` +
                (plan.reason ? ` (${String(plan.reason).slice(0, 50)})` : '') +
                (Array.isArray(plan.instructions) ? ` [${plan.instructions.length} instr]` : ''));

            // ── 4. CHECK ACTION ──
            if (plan.action === 'DONE') {
                removeProgress();
                const filledCount = history.filter(h => h.plan?.action === 'FILL').reduce(
                    (sum, h) => sum + (h.result?.filled || 0), 0
                );
                // DONE means "form is filled, awaiting human review & submit" —
                // the agent never clicks Submit itself. Report 'filled' (not
                // 'submitted') so the batch UI doesn't claim applications were
                // sent. Report BEFORE the confirmation overlay: awaiting the
                // user's click here would stall the whole batch queue.
                reportResult(true, `Filled ~${filledCount} fields in ${i + 1} iterations — awaiting user submit`, 'filled');
                showConfirmation(filledCount, state.totalFields, false);
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
                // Track each fill attempt by selector so we can detect
                // persistently-unfilled fields on the next observation.
                for (const inst of plan.instructions) {
                    if (!inst.selector) continue;
                    const prior = fillAttempts.get(inst.selector) || { count: 0, lastValue: '' };
                    fillAttempts.set(inst.selector, {
                        count: prior.count + 1,
                        lastValue: inst.value,
                    });
                }
                const filled = await executeFillInstructions(plan.instructions, cvData);
                actionResult = { filled, total: plan.instructions.length };
                if (filled > 0) actionsTaken++;
            } else if (plan.action === 'CLICK' && plan.clickTarget) {
                const target = document.querySelector(plan.clickTarget);
                if (target) {
                    target.click();
                    actionResult = { clicked: plan.clickTarget };
                    actionsTaken++;
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

// ─── Report result back to background ───
// outcome: 'submitted' (new success signal seen after our actions)
//        | 'filled'    (form filled, awaiting the user's review + submit)
//        | 'failed'
function reportResult(success, detail, outcome) {
    const o = outcome || (success ? 'filled' : 'failed');
    console.log(`[Copo Apply] ■ result: ${success ? '✅' : '✖'} outcome=${o} | ${detail} | ${window.location.hostname}`);
    chrome.runtime.sendMessage({
        type: 'AUTO_APPLY_RESULT',
        result: {
            success,
            outcome: outcome || (success ? 'filled' : 'failed'),
            site: window.location.hostname,
            url: window.location.href,
            detail,
        },
    }).catch(() => { });
}

// ─── Heartbeat: tell background this job is still actively working ───
function sendHeartbeat() {
    chrome.runtime.sendMessage({ type: 'AUTO_APPLY_HEARTBEAT' }).catch(() => { });
}

// ═══════════════════════════════════════════════════════════════════
// Job-page detection — only show the button on actual job/apply pages
// ═══════════════════════════════════════════════════════════════════

/**
 * Quick URL heuristic. Cheap, runs first.
 */
function urlLooksLikeJobPage() {
    const haystack = (window.location.hostname + window.location.pathname + window.location.search).toLowerCase();
    return JOB_URL_KEYWORDS.some(kw => haystack.includes(kw));
}

/**
 * Check the current DOM for an apply-style button (visible).
 */
function hasVisibleApplyButton() {
    const clickables = document.querySelectorAll('button, a[role="button"], [role="button"], a, input[type="submit"]');
    for (const el of clickables) {
        if (!el.offsetParent) continue;
        const text = (el.textContent || el.value || '').trim().toLowerCase();
        if (!text || text.length > 60) continue;
        if (APPLY_BUTTON_TEXTS.some(t => text.includes(t))) return true;
    }
    return false;
}

/**
 * Check whether the page exposes a real form likely to be an application.
 * Looks for a container with multiple text/select inputs OR a file input
 * (CV upload) — single search bars on news sites don't qualify.
 */
function hasApplicationForm() {
    if (document.querySelector('input[type="file"]')) return true;

    const forms = document.querySelectorAll('form');
    for (const f of forms) {
        const inputs = f.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]), select, textarea'
        );
        if (inputs.length >= 3) return true;
    }
    // Also count formless inputs (modern frameworks often skip <form>)
    const looseInputs = document.querySelectorAll(
        'input[type="text"], input[type="email"], input[type="tel"], textarea, select'
    );
    return looseInputs.length >= 4;
}

/**
 * True if the current host is a known non-job site (social, search, media).
 */
function isDeniedHost() {
    const host = window.location.hostname.toLowerCase();
    return DENY_HOST_SUFFIXES.some(s => host === s || host.endsWith('.' + s));
}

/**
 * Cheap check that the page's own copy (title + top headings) talks about a
 * job/application — used to qualify a form-only match. Scanning just the title
 * and h1/h2 keeps false positives low versus reading the whole body.
 */
function pageMentionsJobContext() {
    const parts = [document.title || ''];
    document.querySelectorAll('h1, h2').forEach(h => parts.push(h.textContent || ''));
    const text = parts.join(' ').toLowerCase();
    return JOB_CONTEXT_KEYWORDS.some(k => text.includes(k));
}

/**
 * Decide whether to surface the agent on this page.
 *
 * A form alone is a weak signal — login, signup, search, and contact forms are
 * everywhere — so it only counts when the page text also reads like a job/apply
 * page. URL keywords and a real "Apply" button stay strong enough on their own.
 * Known non-job hosts are rejected outright.
 */
function isLikelyJobPage() {
    if (isDeniedHost()) return false;
    if (urlLooksLikeJobPage()) return true;
    if (hasVisibleApplyButton()) return true;
    if (hasApplicationForm() && pageMentionsJobContext()) return true;
    return false;
}

/**
 * Wait up to `timeoutMs` for the page to look like a job page (handles SPAs
 * that render forms after initial paint). Resolves with boolean.
 */
function waitForJobPageSignal(timeoutMs = JOB_PAGE_DETECT_TIMEOUT_MS) {
    return new Promise((resolve) => {
        if (isLikelyJobPage()) return resolve(true);

        let settled = false;
        const finish = (val) => {
            if (settled) return;
            settled = true;
            observer.disconnect();
            clearInterval(poll);
            clearTimeout(timer);
            resolve(val);
        };

        const observer = new MutationObserver(() => {
            if (isLikelyJobPage()) finish(true);
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // Fallback poll for cases where mutations fire too fast / too rarely
        const poll = setInterval(() => {
            if (isLikelyJobPage()) finish(true);
        }, JOB_PAGE_DETECT_POLL_MS);

        const timer = setTimeout(() => finish(false), timeoutMs);
    });
}

// ═══════════════════════════════════════════════════════════════════
// Floating button
// ═══════════════════════════════════════════════════════════════════

function injectFloatingButton(profile) {
    if (document.getElementById('jobfit-auto-apply-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'jobfit-auto-apply-btn';
    btn.textContent = '⚡ Auto Apply';
    btn.title = 'Copo — Auto Apply Agent';
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

// ═══════════════════════════════════════════════════════════════════
// Initialize
// ═══════════════════════════════════════════════════════════════════

async function init() {
    // Small grace period so we don't race with the very first paint.
    await sleep(800);

    try {
        const data = await new Promise(r => {
            chrome.storage.local.get(['pendingAutoApply', 'jobfitProfile', 'batchMode'], r);
        });

        // Auto-apply was triggered from the web app / batch flow → run immediately,
        // do NOT gate on heuristics (the user already chose this URL).
        if (data.pendingAutoApply && data.jobfitProfile) {
            const isBatch = data.batchMode === true;

            await new Promise(r => {
                chrome.storage.local.remove(['pendingAutoApply', 'autoApplyJobUrl', 'batchMode'], r);
            });

            console.log(`[Copo Agent] Auto-apply triggered (batch: ${isBatch})`);

            showToast(isBatch
                ? '🚀 Batch Apply — Đang xử lý job này...'
                : '🚀 Copo Agent đang xử lý...', 0);
            await sleep(500);
            document.getElementById('jobfit-toast')?.remove();

            await runAgentLoop(data.jobfitProfile);
            return;
        }
    } catch (e) {
        console.warn('[Copo Agent] Auto-apply check failed:', e);
        reportResult(false, `Init error: ${e.message}`);
    }

    // Manual mode: only inject the floating button on pages that look like
    // job/apply pages. Re-evaluate on SPA navigation.
    const profile = await new Promise(r => {
        chrome.storage.local.get('jobfitProfile', d => r(d.jobfitProfile || null));
    });
    if (!profile) return;

    const evaluateAndInject = async () => {
        const isJobPage = await waitForJobPageSignal();
        if (isJobPage) {
            injectFloatingButton(profile);
        } else {
            console.log('[Copo Agent] Page does not look like a job/apply page, skipping button.');
        }
    };

    await evaluateAndInject();

    // Handle SPA route changes (history.pushState / popstate) — re-check once
    // the URL changes so the button can appear/disappear correctly.
    let lastUrl = location.href;
    const onRouteChange = () => {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        document.getElementById('jobfit-auto-apply-btn')?.remove();
        evaluateAndInject();
    };
    window.addEventListener('popstate', onRouteChange);
    const _push = history.pushState;
    history.pushState = function (...args) {
        const ret = _push.apply(this, args);
        setTimeout(onRouteChange, 100);
        return ret;
    };
}

// ═══════════════════════════════════════════════════════════════════
// ── MODE 1 — Tailor CV for THIS job page ──
//    Triggered from the popup ("Tailor CV for this job"). Reads the JD
//    text off the page + the synced rich CV, mints an opaque source_ref,
//    and asks the background to run the no-store /api/ai/tailor pipeline.
//    The JD text only ever leaves via that endpoint; the job URL never
//    leaves the browser (stored under source_ref by the background).
// ═══════════════════════════════════════════════════════════════════
function _newSourceRef() {
    try {
        if (crypto?.randomUUID) return crypto.randomUUID();
    } catch { /* not a secure context */ }
    return 'sr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

// Debug logging for the tailor-on-job-board flow. Page-side logs show in the
// JOB BOARD tab's DevTools console (filter: "Mode1"). Background-side logs show
// in the extension's service-worker console (chrome://extensions → Copo →
// "service worker"). Both share the [Copo Mode1] prefix.
const M1 = '[Copo Mode1]';

async function runMode1() {
    const t0 = Date.now();
    console.log(`${M1} ▶ start`, { url: location.href, host: location.hostname });

    const cv = await new Promise(r => {
        chrome.storage.local.get(['jobfitCv', 'jobfitCvSyncedAt'], d =>
            r({ cv: d.jobfitCv || null, syncedAt: d.jobfitCvSyncedAt }));
    });
    if (!cv.cv) {
        console.warn(`${M1} ✖ no CV synced — open Copo and sync first`);
        return { success: false, error: 'Chưa có CV. Hãy mở Copo và đồng bộ CV trước.' };
    }
    console.log(`${M1} ✓ CV synced`, {
        name: cv.cv.name || cv.cv.full_name || '(unnamed)',
        skills: Array.isArray(cv.cv.skills) ? cv.cv.skills.length : 0,
        syncedAt: cv.syncedAt ? new Date(cv.syncedAt).toISOString() : 'unknown',
    });

    const jdText = (document.body?.innerText || '').replace(/\s+\n/g, '\n').trim().slice(0, 15000);
    console.log(`${M1} JD extracted from page`, {
        chars: jdText.length,
        head: jdText.slice(0, 140).replace(/\n/g, ' '),
    });
    if (jdText.length < 80) {
        console.warn(`${M1} ✖ JD too short (${jdText.length} chars) — page may be an SPA shell or wrong tab`);
        return { success: false, error: 'Không đọc được JD trên trang này.' };
    }

    const sourceRef = _newSourceRef();
    // No in-page toast here — the popup's Apply tab owns all progress UI for
    // Mode 1 (the old fixed toast doubled up with the popup stepper).
    console.log(`${M1} → sending MODE1_TAILOR to background`, { sourceRef, jdChars: jdText.length });
    try {
        const resp = await chrome.runtime.sendMessage({
            type: 'MODE1_TAILOR',
            cv: cv.cv,
            jdText,
            sourceRef,
            jobUrl: location.href,
            jobTitle: (document.title || '').trim().slice(0, 200),
            options: { length: 'concise' },
        });
        const ms = Date.now() - t0;
        if (resp?.success) {
            const v0 = resp.data?.variants?.[0];
            console.log(`${M1} ✅ tailored in ${ms}ms`, {
                variants: resp.data?.variants?.length ?? 0,
                improvements: v0?.improvements?.length ?? 0,
                score: resp.data?.match?.overall_score,
            });
        } else {
            console.warn(`${M1} ✖ tailor failed in ${ms}ms:`, resp?.error, resp);
        }
        return resp || { success: false, error: 'no response' };
    } catch (e) {
        console.error(`${M1} ✖ exception after ${Date.now() - t0}ms:`, e);
        return { success: false, error: e.message };
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'RUN_MODE1') {
        runMode1().then(sendResponse);
        return true; // async
    }
});

init();
