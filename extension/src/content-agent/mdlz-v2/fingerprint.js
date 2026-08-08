/**
 * What IS this control — asked of the page, never of the field's name.
 *
 * The rule this file exists to enforce: two fields that mean the same thing are
 * not the same widget. "Skills" is a chip search here and a plain listbox on the
 * next tenant; "Overall" carries a per-tenant GUID instead of an id; a date is
 * two spinbuttons behind something that looks like a text box. Every handler v1
 * grew that was keyed on a LABEL eventually met a page where that label meant a
 * different control, and the handler wrote into it anyway.
 *
 * So: a capability is resolved from the shape found at runtime, and a field's
 * name is used for one thing only — saying which field we are talking about in a
 * trace.
 *
 * Nothing here holds a node. Workday replaces nodes on re-render, and a
 * fingerprint that cached one would hand the executor a corpse to verify against
 * (measured: a verifier reading a stale month input reported "not committed" for
 * a date that was committed). Everything is a thunk, re-read at the moment of
 * use.
 */

import { SEL } from './config.js';

export const WIDGET = {
    TEXT: 'text',
    TEXTAREA: 'textarea',
    CHECKBOX: 'checkbox',
    LISTBOX: 'listbox',
    SEARCH_MULTI: 'searchMulti',
    DATE: 'date',
    RADIO: 'radio',
    SEARCH_SINGLE: 'searchSingle',
    FILE: 'file',
    UNKNOWN: 'unknown',
};

const vis = (el) => !!(el && el.offsetParent !== null);
const first = (root, sel) => (root ? root.querySelector(sel) : null);

/** The controls a wrapper holds right now. Re-read on every call, by design. */
export function controlsOf(wrap) {
    if (!wrap) return {};
    const all = (sel) => [...wrap.querySelectorAll(sel)];
    const inputs = all('input');
    return {
        wrap,
        spins: all(SEL.spinbutton),
        month: first(wrap, SEL.dateMonth),
        year: first(wrap, SEL.dateYear),
        icon: first(wrap, SEL.dateIcon),
        chipList: first(wrap, SEL.selectedItemList),
        chips: all(SEL.selectedItem),
        button: first(wrap, 'button'),
        textarea: first(wrap, 'textarea'),
        checkbox: inputs.find((i) => (i.getAttribute('type') || '').toLowerCase() === 'checkbox') || null,
        // NOT filtered by visibility. Workday styles its radios with a custom
        // control and the real input can be invisible — a finder that only sees
        // visible ones finds a group of none and reports the field absent.
        radios: inputs.filter((i) => (i.getAttribute('type') || '').toLowerCase() === 'radio'),
        file: inputs.find((i) => (i.getAttribute('type') || '').toLowerCase() === 'file') || null,
        text: inputs.find((i) => {
            const t = (i.getAttribute('type') || 'text').toLowerCase();
            return t === 'text' || t === 'search' || t === 'tel' || t === 'email';
        }) || null,
    };
}

/**
 * The order of these questions is the measurement, not a preference.
 *
 * A date is asked about FIRST because its sections are `input` elements and
 * every later rule would happily claim them — which is how a date came to be
 * "typed into", the one thing that has never once worked. Chips come before the
 * plain listbox because a multi-select answers the button question too, and
 * treating it as a single select is how a second skill replaces the first.
 */
export function kindOf(wrap) {
    const c = controlsOf(wrap);
    if (!wrap) return WIDGET.UNKNOWN;
    if (c.spins.length >= 2 || (c.month && c.year)) return WIDGET.DATE;
    if (c.file) return WIDGET.FILE;
    if (c.radios.length) return WIDGET.RADIO;
    if (c.checkbox) return WIDGET.CHECKBOX;
    if (c.chipList) return WIDGET.SEARCH_MULTI;
    if (c.textarea) return WIDGET.TEXTAREA;
    if (c.button && (c.button.getAttribute('aria-haspopup') || '').includes('listbox')) return WIDGET.LISTBOX;
    // Mondelez renders some prompts as a search box with no button at all — an
    // input that says it owns a popup is a listbox, whatever it looks like.
    if (c.text && (c.text.getAttribute('aria-haspopup') || '').includes('listbox')) return WIDGET.LISTBOX;
    // A SEARCHABLE single-select looks exactly like a text box until you type.
    // What tells them apart is measured: Province or City renders a button
    // listbox on 3M and a searchable input placeholdered "Search" on Mondelez —
    // two widgets behind one automation id, so the NAME cannot decide and the
    // placeholder can.
    if (c.text && /search/i.test(c.text.getAttribute('placeholder') || '')) return WIDGET.SEARCH_SINGLE;
    if (c.text) return WIDGET.TEXT;
    if (c.button) return WIDGET.LISTBOX;
    return WIDGET.UNKNOWN;
}

/** The visible label a human would read for this field, for traces and for rows. */
export function labelOf(wrap) {
    if (!wrap) return '';
    const lab = first(wrap, 'label');
    const text = (lab?.textContent || '').trim();
    if (text) return text;
    // No label element: fall back to the wrapper's own text, minus anything a
    // control is showing. Good enough to name a field in a trace; never good
    // enough to decide what the field IS.
    return (wrap.textContent || '').trim().slice(0, 60);
}

/**
 * Describe a field.
 *
 * `find` is a THUNK that resolves the wrapper — from a row for a repeating
 * section, from the document for a page-level field. Keep it; the fingerprint is
 * only a description, and the node it described may already be gone.
 */
export function fingerprintOf(find, { name = '' } = {}) {
    const finder = typeof find === 'function' ? find : () => find;
    const wrap = finder();
    const kind = kindOf(wrap);
    return {
        kind,
        name: name || wrap?.getAttribute?.('data-automation-id') || '(unnamed)',
        label: labelOf(wrap),
        find: finder,
        controls: () => controlsOf(finder()),
        present: () => vis(finder()),
    };
}

/**
 * The trigger that opens this widget's list.
 *
 * A search prompt IS its own trigger; a button prompt has one. Both are re-read
 * from the live wrapper, never remembered.
 */
export function triggerOf(f) {
    const c = f.controls();
    if (f.kind === WIDGET.SEARCH_MULTI) return c.text || c.button || null;
    return c.button || c.text || null;
}
