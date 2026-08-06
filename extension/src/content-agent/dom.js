// AUTO-SPLIT from content-agent.js (Phase 2). Part of the Copo apply agent.
import { checkClick, logDenial } from './policy.js';

// ─── Helpers ───
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Every automation-id Workday uses for "a live validation error attached to
 * THIS field". One list, imported everywhere, because a missing idiom is not a
 * cosmetic gap: an error the agent cannot see turns the painted-value guard
 * into a permanent false-done. Measured on mdlz 2026-08-03: the per-field
 * error is `inputAlert` — errorMessage/formFieldError never appeared — so
 * every verify that read only those two saw "0 errors" beside a red
 * "The field From is required and must have a value."
 */
export const FIELD_ERROR_SEL =
    '[data-automation-id="errorMessage"], [data-automation-id="formFieldError"], [data-automation-id="inputAlert"]';

/**
 * Diacritics stripped, đ→d — "Võ Nam Hiếu" → "Vo Nam Hieu". For the WESTERN
 * half of a dual-script pair: the "- Vietnamese" twin keeps its marks, the
 * "- Western Script" twin is the same fact romanized.
 */
export function foldDiacritics(s) {
    return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

/**
 * The ~20 Vietnamese family names that cover most of the country, with and
 * without diacritics. Mirrors VN_FAMILY_NAMES in
 * frontend/src/lib/extension-profile.ts — deliberately duplicated: the whole
 * point of the repair below is that it must NOT depend on the web app being
 * up to date.
 */
const VN_FAMILY_NAMES = new Set([
    'nguyen', 'nguyễn', 'tran', 'trần', 'le', 'lê', 'pham', 'phạm',
    'hoang', 'hoàng', 'huynh', 'huỳnh', 'phan', 'vu', 'vũ', 'vo', 'võ',
    'dang', 'đặng', 'bui', 'bùi', 'do', 'đỗ', 'ho', 'hồ', 'ngo', 'ngô',
    'duong', 'dương', 'truong', 'trương', 'dinh', 'đinh',
]);

/**
 * Split a full name into the given/family pair, HERE, from the name itself.
 *
 * The web app already does this — but a profile is only ever as correct as the
 * web app build that produced it, and a production still running the old rule
 * ("the last token is the given name") re-poisons the profile on every CV
 * edit: measured three times on 2026-08-06, each sync putting the family name
 * in the given box and the nickname in the legal name. The agent is the last
 * layer before a real employer sees this, so it re-derives instead of
 * trusting, and a deploy stops being a prerequisite for correct applications.
 *
 * Returns null when the name cannot settle the question — one token, or an
 * order neither convention makes obvious — so the stored values stand.
 */
export function splitLegalName(raw) {
    const cleaned = String(raw ?? '')
        .replace(/[（(\[][^）)\]]*[）)\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const parts = cleaned.split(' ').filter(Boolean);
    if (parts.length < 2) return null;
    const norm = (x) => x.toLowerCase().replace(/[^\p{L}]/gu, '');
    const lastIsFamily = VN_FAMILY_NAMES.has(norm(parts[parts.length - 1]));
    const firstIsFamily = VN_FAMILY_NAMES.has(norm(parts[0]));
    // Western order only when the END looks like a family name and the START
    // does not — "Nguyen Van Le" (both ends plausible) keeps the VN reading.
    if (lastIsFamily && !firstIsFamily) {
        return {
            firstName: normalizeNameCase(parts.slice(0, -1).join(' ')),
            lastName: normalizeNameCase(parts[parts.length - 1]),
        };
    }
    if (!firstIsFamily) return null;   // neither end is a known family name
    return {
        firstName: normalizeNameCase(parts[parts.length - 1]),
        lastName: normalizeNameCase(parts.slice(0, -1).join(' ')),
    };
}

/**
 * A profile whose name fields disagree with its own fullName, repaired.
 *
 * Pure and idempotent: same input, same output, and a profile already correct
 * comes back unchanged (=== the input), so callers can compare by identity to
 * know whether anything was wrong.
 */
export function repairProfileNames(profile) {
    const full = String(profile?.fullName || '').trim();
    if (!full) return profile;
    const split = splitLegalName(full);
    if (!split) return profile;
    const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    if (same(profile.firstName, split.firstName) && same(profile.lastName, split.lastName)) return profile;
    return { ...profile, ...split };
}

/**
 * ALL-CAPS words → Title Case, everything else untouched. CVs write names in
 * caps ("HIEU VO") and Workday raises a capitalization advisory on every one;
 * but a mixed-case word is already someone's deliberate spelling, and a
 * legal-name field is the wrong place to be clever (McDonald → Mcdonald).
 * Single letters are left alone so a middle initial survives. Mirrors
 * normalizeNameCase in frontend/src/lib/extension-profile.ts.
 */
export function normalizeNameCase(raw) {
    // A parenthesised NICKNAME never belongs in a legal-name box — and a
    // profile synced through a stale web-app build can arrive carrying one
    // ("Hieu (Charles)", measured 2026-08-06 after a production re-sync
    // clobbered the repaired split). Stripping here defends every fill layer
    // at once, whatever upstream did.
    return String(raw ?? '')
        .replace(/\s*[（(\[][^）)\]]*[）)\]]\s*/g, ' ')
        .replace(/\s+/g, ' ').trim()
        .split(/(\s+)/)
        .map((word) => {
            const letters = word.replace(/[^\p{L}]/gu, '');
            if (letters.length < 2 || word !== word.toUpperCase()) return word;
            return word.toLowerCase()
                .replace(/(^|[^\p{L}])(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase());
        })
        .join('');
}

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
    // Anything that OPENS a listbox is a select whatever its tag — Workday's
    // single-selects are buttons with aria-haspopup and no role, and they fell
    // through to 'native' (a text setter aimed at a button).
    if (el.getAttribute('aria-haspopup') === 'listbox') return 'custom-dropdown';
    // Workday's search-to-select input (measured: data-uxi-widget-type=
    // "selectinput" on Field of Study) — free text never commits on it.
    if (el.getAttribute?.('data-uxi-widget-type') === 'selectinput'
        || el.getAttribute?.('data-uxi-multiselect-id')) {
        return 'custom-dropdown';
    }
    // A Workday searchable prompt renders as a text INPUT, but free text never
    // commits — the value only exists once a search result is clicked. Typing
    // into it as 'native' leaves the field invalid while LOOKING answered
    // (measured: "How Did You Hear About Us?" — the gap-filler's text pinned
    // the step on a validation error for ten straight iterations).
    if (el.tagName === 'INPUT'
        && (el.getAttribute('aria-haspopup') === 'listbox'
            || el.getAttribute('aria-autocomplete') === 'list'
            || !!el.closest('[data-automation-id^="formField-"]')?.querySelector('[data-automation-id="selectedItemList"]'))) {
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
export function setNativeValue(el, value, { quiet = false } = {}) {
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
    // `quiet` fires input ONLY. change and blur both close a prompt's result
    // list, so a search box must never be written with them — I rewrote
    // simulateTyping to route each character through here and it began blurring
    // after every keystroke, which shut the list before the search could answer
    // and turned three working fields into "0 shown".
    if (!quiet) {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
    }
}

/**
 * Simulate typing character by character (nuclear option for stubborn frameworks).
 */
export async function simulateTyping(el, text, { commit = false } = {}) {
    el.focus();
    // Through the NATIVE setter, not `el.value =`. React keeps a value-tracker on
    // the input and dedupes against it, so a direct assignment leaves the
    // component's state disagreeing with the DOM — the box shows one string and
    // the search runs on another. Every other fill in this file already goes
    // through setNativeValue; this one did not, which is why typed terms came out
    // wrong.
    setNativeValue(el, '', { quiet: true });
    el.dispatchEvent(new Event('focus', { bubbles: true }));

    let typed = '';
    for (const char of text) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        typed += char;
        setNativeValue(el, typed, { quiet: true });
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        await sleep(30);
    }

    // NO blur by default. Blurring a search box closes its result list, so the
    // old unconditional blur cleared the options a beat after asking for them —
    // the caller then searched an empty popup it had just dismissed itself.
    // `commit` is for the fields that genuinely want the value settled.
    if (commit) {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
    }
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
        if (!_sharesPath(stack, el)) {
            // The topmost element is not on the intended control's path — a modal
            // backdrop, a focus trap, a sibling overlay. Do NOT click it: it is
            // not what the caller asked for. Judged BEFORE its policy verdict:
            // an unrelated cover is never clicked, so its verdict must not veto
            // the element we were actually asked about — measured on Mondelez
            // skills, where a selected-skill pill ("Remove …" = destructive)
            // overlapped a legit result row and denied every attempt on it.
            //
            // Refusing outright was wrong too, and broke Workday's apply modal:
            // its overlay is a SIBLING of the button, so "Autofill with Resume"
            // stopped being clickable at all. Fall back to the element we were
            // asked about and have already judged — that is both the right target
            // and a judged one.
            console.warn('[Copo] overlay at the click point is unrelated to the intended control — '
                + 'activating the intended element directly instead');
            target = el;
        } else {
            const actual = checkClick(target, ctx, selector);
            if (!actual.allowed) { logDenial(actual, target, ctx); return false; }
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

/** The extension's OWN floating UI (toast, progress panel, confirm overlay).
 *  It hovers bottom-right and, on a short window, sits exactly over Workday's
 *  footer buttons — measured: the progress panel's copy contains "trước khi
 *  nộp", SUBMIT_RE matched «nộp», and the policy denied our own Next click as
 *  submit_application. Our chrome is never the click target and never policy
 *  evidence: hit-testing looks straight through it. */
function _isOwnUi(el) {
    return !!el?.closest?.('#jobfit-toast, #jobfit-progress, #jobfit-confirm-overlay, #jobfit-auto-apply-btn, [id^="jobfit-agent"]');
}

/** Every element under the point, topmost first — the agent's own UI excluded. */
function _stackAt({ x, y }) {
    try {
        const all = typeof document.elementsFromPoint === 'function'
            ? (document.elementsFromPoint(x, y) || [])
            : (document.elementFromPoint(x, y) ? [document.elementFromPoint(x, y)] : []);
        return all.filter(e => !_isOwnUi(e));
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

/**
 * ONE definition of "the ATS has the file" — shared by the recipe (should I
 * upload?), the observer (is this required field filled?) and any audit.
 *
 * Two modules answering that question differently is how a run froze: the
 * recipe read uploadedRows=2 and skipped the upload, while the observer read
 * input.value (which Workday clears after ingesting) and reported the SAME
 * upload as an unfilled required field — advance withheld, planner consulted.
 * `input.files` is the native signal; the row markers are Workday's own
 * (file-upload-item / file-upload-successful — the ids the recipe's
 * advanceWhen already trusts; broader wildcards stay out until measured).
 * Rows are looked for in the input's own formField/section first, then
 * page-wide as fallback (`scoped` says which matched).
 */
export function readFileCommitState(input, root = document) {
    const ROWS = '[data-automation-id="file-upload-item"], [data-automation-id="file-upload-successful"]';
    const scope = input?.closest?.('[data-automation-id^="formField-"], form, fieldset, section') || root;
    const nativeFiles = input?.files?.length || 0;
    const scopedRows = scope.querySelectorAll(ROWS).length;
    const uploadedRows = scopedRows || root.querySelectorAll(ROWS).length;
    return { committed: nativeFiles > 0 || uploadedRows > 0, nativeFiles, uploadedRows, scoped: scopedRows > 0 };
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

/**
 * A prompt listbox that is genuinely OPEN — not a committed chip, not a leftover.
 *
 * The test used to be `querySelector('[data-automation-id="promptOption"]')`,
 * which is true on almost every filled Workday page: a COMMITTED chip contains a
 * promptOption too (measured — the chip for "Company Website" holds
 * `<p data-automation-id="promptOption">`). So the Escape meant to close a
 * leftover dropdown fired constantly, and on Workday Escape closes the ACTIVE
 * MODAL. The agent opened the "Start Your Application" modal, dismissed it on the
 * next pass, and then reported a modal it could no longer see.
 *
 * A real open list has an activeListContainer, or at minimum an option that is
 * not part of a selected-item chip.
 */
export function openPromptListbox() {
    const vis = (e) => !!(e && e.offsetParent !== null);
    try {
        const live = [...document.querySelectorAll('[data-automation-id="activeListContainer"]')].filter(vis);
        if (live.length) return live[0];
        const opt = [...document.querySelectorAll('[data-automation-id="promptOption"], [role="option"]')]
            .filter(vis)
            .filter(o => o.getAttribute('data-automation-id') !== 'selectedItem')
            .filter(o => !o.closest('[data-automation-id="selectedItemList"]'));
        return opt[0] || null;
    } catch { return null; }
}

/**
 * Escape ONLY a dropdown, never a modal.
 *
 * Escape is a blunt key: it closes whatever is topmost. When the thing on screen
 * is the apply-flow modal rather than a listbox, pressing it throws away the step
 * the agent was about to act on.
 */
export function closeOpenDropdown() {
    const list = openPromptListbox();
    if (!list) return false;
    const modal = findActiveModal();
    // A listbox rendered INSIDE the modal is safe to close; one that is not means
    // the modal is the topmost layer and Escape would take that instead.
    if (modal && !modal.contains(list)) return false;
    (document.activeElement || document.body)?.dispatchEvent?.(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return true;
}
