// AUTO-SPLIT from content-agent.js (Phase 2). Part of the Copo apply agent.
import { checkClick, logDenial } from './policy.js';

// ─── Helpers ───
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function waitForElement(selector, timeout = 5000) {
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

/**
 * Find the active modal/dialog if one is open.
 */
export function findActiveModal() {
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
export function detectComponentType(el) {
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
export function getNearbyText(el, maxChars = 300) {
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

export function findLabelFor(el, root) {
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
 * Shadow-DOM-piercing query. A plain querySelector does NOT cross shadow
 * boundaries, so a component library that renders its real <input> inside a
 * custom element's shadow root (e.g. SmartRecruiters' spl-* web components) is
 * invisible to document.querySelector. deepQueryAll walks `root` plus every OPEN
 * shadow root beneath it and returns all matches; deepQuery returns the first.
 *
 * IMPORTANT: the selector is matched WITHIN a single tree at a time — it can't
 * span a shadow boundary (`a b` won't match when `a` is light DOM and `b` lives
 * in a's shadow root). To cross a boundary, resolve the host in light DOM first,
 * then deepQuery INSIDE that host.
 */
export function deepQueryAll(selector, root = document) {
    const out = [];
    const seen = new Set();
    const walk = (node) => {
        // Descend into the node's OWN shadow root first. When `root` (or a
        // descendant) IS a shadow host — e.g. <spl-dropzone> keeps its
        // <input type=file id="file-input"> in its OWN shadow — the
        // querySelectorAll('*') below only sees its LIGHT children and would miss
        // the shadow entirely (the bug that made the résumé upload fail).
        if (node.shadowRoot) walk(node.shadowRoot);
        let matches;
        try { matches = node.querySelectorAll(selector); } catch { return; }
        for (const m of matches) { if (!seen.has(m)) { seen.add(m); out.push(m); } }
        let all;
        try { all = node.querySelectorAll('*'); } catch { all = []; }
        for (const el of all) {
            if (el.shadowRoot) walk(el.shadowRoot);
        }
    };
    if (root) walk(root);
    return out;
}

export function deepQuery(selector, root = document) {
    return deepQueryAll(selector, root)[0] || null;
}

/**
 * First fillable control (input / textarea / select) under `host`, piercing
 * shadow roots. `controlSel` narrows the search (e.g. 'input[type="tel"]' for a
 * phone field whose first shadow input is actually the country-code picker);
 * falls back to the first generic text-ish control. `host` itself is returned if
 * it's already a control.
 */
export function deepFindControl(host, controlSel) {
    if (!host) return null;
    if (controlSel) {
        const c = deepQuery(controlSel, host);
        if (c) return c;
    }
    const tag = host.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return host;
    return deepQuery(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, select',
        host,
    );
}

/**
 * Build a unique CSS selector for an element without id/name.
 */
export function buildUniqueSelector(el) {
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
 * Set a value on an input using the native setter to trigger React/Vue reactivity.
 */
export function setNativeValue(el, value) {
    // Pick the setter for the ELEMENT's own type — calling HTMLInputElement's value
    // setter on a <textarea> (or vice-versa) throws "Illegal invocation" (this hit
    // SmartRecruiters' message <textarea> in a shadow root).
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
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
export async function simulateTyping(el, text) {
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
 * Overlay-aware click. Some ATS (Workday) cover a button with a transparent
 * "click_filter" <div> that OWNS the click handler — clicking the <button>
 * underneath is silently swallowed. So click the TOPMOST element at the button's
 * centre (elementFromPoint) with a full pointer/mouse sequence at real
 * coordinates. On a normal page this just clicks the button (or a harmless child
 * that bubbles to it), so it's safe to use for every click.
 *
 * This is also the agent's single click choke point, so the action policy is
 * enforced HERE rather than at each call site — a new call site cannot bypass it
 * by forgetting a check. `ctx` declares who is asking; omitting it means the
 * strictest caller ('planner'), so the failure mode of forgetting is a refused
 * click, not a silent submit. Returns false when `el` is missing OR the policy
 * refused the action (the refusal is logged with its code).
 */
export function safeActivate(el, ctx = {}, originSelector) {
    if (!el) return false;

    // The selector the caller USED to reach this element. It matters because the
    // exact-control rule (`ctx.submitSelector`) can only fire when the descriptor
    // carries a selector — and without it, a submit button that the planner
    // mis-typed as `custom-dropdown` reached the dropdown handler, arrived here
    // with no selector, read as harmless text ("Continue"), and was clicked.
    const selector = originSelector || ctx.originSelector || '';

    const intended = checkClick(el, ctx, selector);
    if (!intended.allowed) { logDenial(intended, el, ctx); return false; }

    const point = _viewportCentre(el);
    if (!point) return false;

    // What will ACTUALLY receive the click. Workday covers its footer buttons with
    // a transparent "click_filter" div that owns the handler, which is why we aim
    // at coordinates rather than calling el.click() — but it also means the element
    // the page acts on is not always the one the policy just approved. So approve
    // that one too, and require it to be on the intended element's own path: an
    // overlay that belongs to something else entirely is not a click we understand.
    const stack = _stackAt(point);
    let target = stack[0] || el;
    if (target !== el) {
        const actual = checkClick(target, ctx, selector);
        if (!actual.allowed) { logDenial(actual, target, ctx); return false; }
        if (!_sharesPath(stack, el)) {
            // The topmost element is not on the intended control's path — a modal
            // backdrop, a focus trap, a sibling overlay. Do NOT click it: it is
            // not what the caller asked for even though it passed the policy.
            //
            // Refusing outright was wrong too, and broke Workday's apply modal:
            // its overlay is a SIBLING of the button, so "Autofill with Resume"
            // stopped being clickable at all. Fall back to the element we were
            // asked about and have already judged — that is both the right target
            // and a judged one.
            console.warn('[Copo] overlay at the click point is unrelated to the intended control — '
                + 'activating the intended element directly instead');
            target = el;
        }
    }
    return _dispatchOne(target, point);
}

/** Kept for readability at call sites that are literally clicking a page button. */
export const overlayClick = safeActivate;

/** Centre of the element, scrolled into view first — elementFromPoint only sees
 *  what is in the viewport. Null when the element has no box to aim at. */
function _viewportCentre(el) {
    let r;
    try { r = el.getBoundingClientRect(); } catch { return null; }
    if (!r) return null;
    if (r.bottom < 0 || r.top > innerHeight || r.width === 0) {
        try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch { /* ignore */ }
        try { r = el.getBoundingClientRect(); } catch { return null; }
    }
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

/** Every element under the point, topmost first. */
function _stackAt({ x, y }) {
    try {
        if (typeof document.elementsFromPoint === 'function') return document.elementsFromPoint(x, y) || [];
        const one = document.elementFromPoint(x, y);
        return one ? [one] : [];
    } catch { return []; }
}

/**
 * Is `el` part of the stack under the click point?
 *
 * Plain `stack.includes(el)` is not enough: elementsFromPoint reports the shadow
 * HOST, not the control inside it, so every SmartRecruiters field would look
 * unrelated to its own overlay. Walk el's ancestry across shadow boundaries and
 * accept a stack entry that contains el, is contained by el, or hosts it.
 */
function _sharesPath(stack, el) {
    const chain = new Set();
    let node = el;
    for (let i = 0; node && i < 40; i++) {
        chain.add(node);
        node = node.parentNode || node.host || null;
        if (node && node.nodeType === 11 /* DocumentFragment: a shadow root */) node = node.host;
    }
    return stack.some(s => chain.has(s)
        || (s.contains && s.contains(el))
        || (el.contains && el.contains(s)));
}

/**
 * Deliver exactly ONE activation at real coordinates.
 *
 * The pointer/mouse preamble deliberately excludes `click`: dispatching a
 * synthetic click AND calling `.click()` ran the page's handler twice, which on a
 * login or create-account button is a duplicate submission and an extra
 * failed-attempt tick against a tenant we are trying not to get locked out of.
 */
function _dispatchOne(target, { x, y }) {
    const opts = {
        bubbles: true, cancelable: true, composed: true, view: window,
        clientX: x, clientY: y, button: 0, buttons: 1,
    };
    for (const type of ['pointerover', 'pointerenter', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
        try { target.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, opts) : new MouseEvent(type, opts)); } catch { /* ignore */ }
    }
    try { target.click(); } catch { /* element detached mid-sequence */ }
    return true;
}

/** Build a File from base64 (shared by the input + dropzone upload paths). */
function _fileFromBase64(base64Data, fileName, mimeType) {
    const byteString = atob(base64Data);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    return new File([ab], fileName, { type: mimeType });
}

/**
 * Fallback upload for a drag-and-drop zone that has no settable <input type=file>
 * in reach (its input may be created lazily / on click) — SmartRecruiters'
 * spl-dropzone says "Chọn một tệp hoặc thả ở đây", so it accepts a real drop.
 * Dispatches a synthetic file drop (dragenter → dragover → drop, with a populated
 * DataTransfer) on the zone and any inner drop target. Best effort: a synthetic
 * drop's file list isn't guaranteed to be honored by every framework.
 */
export function dropFileOnZone(zone, base64Data, fileName, mimeType = 'application/pdf') {
    try {
        const file = _fileFromBase64(base64Data, fileName, mimeType);
        const dt = new DataTransfer();
        dt.items.add(file);
        const opts = { bubbles: true, cancelable: true, composed: true, dataTransfer: dt };
        // Collect drop targets by piercing OPEN shadow roots — spl-dropzone's real
        // (drop) listener sits on an element inside its shadow, so dispatching only
        // on the light-DOM host misses it.
        const targets = new Set([zone]);
        for (const el of deepQueryAll('[class*="drop" i], [data-test*="drop" i], [ocappdrag], input[type="file"], label', zone)) {
            targets.add(el);
        }
        for (const tg of targets) {
            for (const type of ['dragenter', 'dragover', 'drop']) {
                try { tg.dispatchEvent(new DragEvent(type, opts)); } catch { /* ignore */ }
            }
        }
        return true;   // best effort — can't synchronously verify the SPA accepted it
    } catch (e) {
        console.warn('[Copo Agent] dropFileOnZone failed:', e);
        return false;
    }
}

/**
 * Set a file on an input[type=file] using DataTransfer.
 */
export function setFileOnInput(el, base64Data, fileName, mimeType = 'application/pdf') {
    try {
        const file = _fileFromBase64(base64Data, fileName, mimeType);
        const dt = new DataTransfer();
        dt.items.add(file);
        el.files = dt.files;
        // Fire a FULLER sequence that better mimics a real file pick. A bare
        // 'change' left SmartRecruiters' résumé parser in a partial state (companies
        // extracted but titles/institutions blank). `composed: true` lets the event
        // cross the shadow boundary the <input> sits behind. NOTE: these are still
        // `isTrusted:false` — a script can't forge a trusted upload — so a parser
        // that gates on trust won't be fully satisfied by this.
        try { el.focus(); } catch { /* ignore */ }
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        try { el.dispatchEvent(new Event('blur', { bubbles: true, composed: true })); } catch { /* ignore */ }
        return true;
    } catch (e) {
        console.warn('[Copo Agent] File upload failed:', e);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3 + 5 + 6: Execute Fill Instructions (enhanced)
// ═══════════════════════════════════════════════════════════════════
