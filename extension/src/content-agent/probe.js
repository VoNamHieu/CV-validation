// WIDGET SHAPE PROBE. Part of the Copo apply agent.
//
// "What is this field asking" and "how does this widget take an answer" are
// two different questions, and only the first lives in labels. The second is
// tenant-dependent — the SAME question renders as free text on one Workday
// tenant and as a pick-required prompt on another — so the fill strategy must
// come from TESTING the widget, not from what a recipe declared or a title
// suggested. (Measured costs of guessing: free text typed into the source
// prompt read as answered while committing nothing; "Negotiable" painted into
// a textarea Workday saw as empty.)
//
// Two layers, cheapest first:
//   1. STRUCTURAL — tag/type/aria/wrapper contents. Free, covers most shapes.
//   2. BEHAVIOURAL — only for a bare text input nothing structural explains:
//      type ONE character, watch what happens (a listbox opening → picker; the
//      value sticking → free text; neither → a picker input that refuses raw
//      text), then undo. Probing never runs on a field that already holds a
//      value, and the undo is verified by the caller's own idempotency guards.
//
// Results are cached per element for the page's lifetime — a widget's shape
// does not change between passes, and re-probing would type into real fields
// on every iteration.

import { setNativeValue, simulateTyping, sleep } from './dom.js';

// Keep in sync with recipe.js OPTION_SEL — how an open list's choices are
// marked up across tenants (promptOption on 3M, bare role=option on Mondelez).
const OPTION_SEL = '[data-automation-id="promptOption"], [data-automation-id="promptLeafNode"], [role="option"]';

const _shapeCache = new WeakMap();

/**
 * @returns {{shape: string, evidence: string}} shape ∈
 *   native-select | file-upload | checkbox | radio-group | date-split |
 *   search-multi | prompt-select | text-combobox | text-free | unknown
 */
export async function probeFieldShape(control) {
    if (!control) return { shape: 'unknown', evidence: 'no control' };
    if (_shapeCache.has(control)) return _shapeCache.get(control);
    const done = (shape, evidence) => {
        const r = { shape, evidence };
        _shapeCache.set(control, r);
        return r;
    };

    const wrap = control.closest?.('[data-automation-id^="formField-"]') || control.parentElement;
    const tag = control.tagName;

    // ── structural: free, unambiguous ──
    if (tag === 'SELECT') return done('native-select', 'tag');
    if (control.type === 'file') return done('file-upload', 'input type');
    if (control.type === 'checkbox') return done('checkbox', 'input type');
    if (control.type === 'radio') return done('radio-group', 'input type');
    const inWrap = (sel) => !!wrap?.querySelector?.(sel);
    if (inWrap('[data-automation-id*="dateSection"]')) return done('date-split', 'dateSection inputs in wrapper');
    const hasChips = inWrap('[data-automation-id="selectedItemList"]');
    if (control.getAttribute('aria-haspopup') === 'listbox' || tag === 'BUTTON') {
        return done(hasChips ? 'search-multi' : 'prompt-select', `haspopup/button${hasChips ? ' + chips' : ''}`);
    }
    if (hasChips) return done('search-multi', 'chips in wrapper');
    if (control.getAttribute('role') === 'combobox' || control.getAttribute('aria-autocomplete') === 'list') {
        return done('text-combobox', 'aria');
    }
    // Workday's SEARCH-to-select input (Field of Study, Skills): measured on
    // Mondelez — the input carries data-uxi-widget-type="selectinput" and sits
    // in a multiSelectContainer; selectedItemList only EXISTS once something
    // committed. This must be decided structurally, before the has-value bail
    // below: painted search text ("Marketing", no chip, "0 items selected")
    // made the bail read a picker as answered free text.
    if (control.getAttribute('data-uxi-widget-type') === 'selectinput'
        || control.getAttribute('data-uxi-multiselect-id')
        || wrap?.querySelector?.('[data-automation-id="multiSelectContainer"], [data-automation-id="multiselectInputContainer"]')) {
        return done('search-multi', 'workday selectinput markers');
    }
    if (tag === 'TEXTAREA') return done('text-free', 'textarea');
    if (tag !== 'INPUT') return done('unknown', `tag ${tag}`);

    // ── behavioural: a bare text input nothing structural explains ──
    // Never disturb an answered field; its shape can wait for a pass where it
    // is empty (and an answered field is not being filled anyway).
    if (String(control.value || '').trim()) return done('text-free', 'holds a value — not probed');

    // An option only counts if it belongs to THIS input. The page-global count
    // this used to be turned every stray popup into evidence: on Mondelez the
    // source prompt's 64-row list was still open, its virtualiser re-rendered
    // two rows during the probe's 400ms window, and the First-name TEXT INPUT
    // was ruled a combobox — then died in the dropdown machinery, three times,
    // on a field a keyboard fills. Ownership is established two ways:
    //   - the option sits in a container this input aria-controls/aria-owns, or
    //   - the option's listbox container APPEARED during the probe (a stray's
    //     container, by definition, existed before the first keystroke), or
    //   - the option is inside this field's own formField wrapper (inline lists).
    const listboxContainers = () =>
        new Set([...document.querySelectorAll('[data-automation-id="activeListContainer"], [role="listbox"]')]
            .filter(c => c.offsetParent !== null));
    const containersBefore = listboxContainers();
    const ownedOptions = () => {
        const ownedIds = [control.getAttribute('aria-controls'), control.getAttribute('aria-owns')]
            .filter(Boolean);
        return [...document.querySelectorAll(OPTION_SEL)].filter(o => {
            if (o.offsetParent === null) return false;
            if (wrap && wrap.contains(o)) return true;
            const container = o.closest('[data-automation-id="activeListContainer"], [role="listbox"]');
            if (!container) return false;
            if (ownedIds.includes(container.id)) return true;
            return !containersBefore.has(container);
        }).length;
    };
    try { control.focus(); } catch { /* noop */ }
    await simulateTyping(control, 'a');
    await sleep(400);
    const opened = ownedOptions();
    const stuck = String(control.value || '') === 'a';
    // Undo before reporting: clear the char, close anything the char opened.
    setNativeValue(control, '', { quiet: true });
    try {
        control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true }));
    } catch { /* noop */ }
    await sleep(150);

    if (opened > 0) {
        return done(stuck ? 'text-combobox' : 'prompt-select', `typing opened ${opened} OWNED option rows`);
    }
    if (stuck) return done('text-free', 'typing sticks, no list opened');
    return done('prompt-select', 'typing did not stick — the value lives in a picker');
}

/** The picker-family shapes: an answer only exists once an option is chosen. */
export function isPickerShape(shape) {
    return shape === 'prompt-select' || shape === 'text-combobox' || shape === 'search-multi';
}
