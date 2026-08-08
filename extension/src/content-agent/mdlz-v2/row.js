/**
 * The owner of a repeating section is the ROW, not the label.
 *
 * Three of the five sections on My Experience repeat. There is no "Work From" on
 * that step — there is only "Work From OF WHICH ROW", and every flat identity
 * (a label, a page-wide selector, an index into a page-wide list) is ambiguous
 * by design rather than by accident.
 *
 * Two measurements set everything below:
 *
 *  · INDEX PAIRING IS BROKEN THE MOMENT SOMEONE STILL WORKS SOMEWHERE. Ticking
 *    "I currently work here" removes To from the DOM, so checkbox[i] and
 *    endDate[i] stop describing the same row — measured as 3 boxes over 2 To's.
 *    A row is therefore a CONTAINER, and its fields are found inside it.
 *
 *  · A NODE DOES NOT SURVIVE RE-RENDER, SO IDENTITY MUST BE DATA. `title@company`
 *    for work, the language for a language row, the chip text for a skill: keys
 *    that are still true after Workday swaps every node under them. Hold the key,
 *    re-find the row.
 *
 * And the reason errors are counted per row: Workday says only "The field From
 * is required". WHICH From is answered by exactly one thing — the error node
 * living inside that row's container. Counting page-wide is how one bad row made
 * all three report as broken.
 */

import { SEL } from './config.js';
import { labelOf } from './fingerprint.js';

const vis = (el) => !!(el && el.offsetParent !== null);
const txt = (el) => (el?.textContent || '').trim();

/** The anchor field each repeating section of this step is recognised by. */
const SECTION_ANCHORS = [SEL.row.jobTitle, SEL.row.schoolName, SEL.row.language, SEL.skills];

const countIn = (node, sel) => (node?.querySelectorAll ? node.querySelectorAll(sel).length : 0);
const foreignAnchors = (node, anchorSel) =>
    SECTION_ANCHORS.filter((s) => s !== anchorSel).reduce((n, s) => n + countIn(node, s), 0);

/**
 * The container that holds this field and nothing from any sibling row.
 *
 * Structural, because the live form gives a row no id of its own. Climb while
 * the ancestor still holds exactly one of these anchors, and stop where it would
 * take in a second — that second anchor IS the next row.
 *
 * The other stop matters on a section with a single row, where every ancestor up
 * to <html> holds exactly one anchor and an unguarded climb would end up calling
 * the whole page a row: stop as soon as the ancestor also takes in another
 * SECTION. Landing on a one-row section rather than the row is harmless, since
 * the two hold the same fields and the same errors.
 */
export function rowContainer(anchor, anchorSel, root = null) {
    if (!anchor) return null;
    const top = root || (typeof document !== 'undefined' ? document.documentElement : null);
    let node = anchor;
    while (node && node.parentNode && node.parentNode !== top) {
        const parent = node.parentNode;
        if (countIn(parent, anchorSel) !== 1) break;
        if (foreignAnchors(parent, anchorSel) > foreignAnchors(node, anchorSel)) break;
        node = parent;
    }
    return node;
}

/**
 * Every row of a section, in page order, identified by the anchor field that
 * every row of that section must have (Job Title for work, Language for
 * languages, School for education).
 */
export function rowsOf(anchorSel, { root = null } = {}) {
    const scope = root || (typeof document !== 'undefined' ? document : null);
    if (!scope) return [];
    return [...scope.querySelectorAll(anchorSel)]
        .filter(vis)
        .map((a) => rowContainer(a, anchorSel, root))
        .filter(Boolean);
}

/** A field inside a row, by its automation id. Re-read every call. */
export function fieldIn(row, automationId) {
    if (!row) return null;
    return row.querySelector(`[data-automation-id="${automationId}"]`);
}

/**
 * A field inside a row, by the LABEL a human reads.
 *
 * The only way to reach Overall proficiency: its wrapper carries a per-tenant
 * GUID instead of an id, so there is nothing stable to select it by page-wide —
 * and a page-wide search for a button would find the Language prompt of the row
 * above just as happily.
 */
export function fieldByLabel(row, pattern) {
    if (!row) return null;
    const fields = [...row.querySelectorAll('[data-automation-id^="formField-"]')];
    const hit = fields.filter((f) => pattern.test(labelOf(f)));
    // Two fields answering to the same label is not something to pick between.
    return hit.length === 1 ? hit[0] : null;
}

/** What this row IS, as data — the key that outlives its nodes. */
export function keyOfWorkRow(row) {
    return `${valueIn(row, 'formField-jobTitle')}@${valueIn(row, 'formField-companyName')}`;
}

/** The text a row's field currently holds, whatever kind of control holds it. */
export function valueIn(row, automationId) {
    const wrap = fieldIn(row, automationId);
    if (!wrap) return '';
    const input = wrap.querySelector('input') || wrap.querySelector('textarea');
    if (input && typeof input.value === 'string' && input.value.trim()) return input.value.trim();
    const chips = [...wrap.querySelectorAll(SEL.selectedItem)];
    if (chips.length) return chips.map(txt).join(' | ');
    const button = wrap.querySelector('button');
    const label = txt(button);
    return /^select one$/i.test(label) ? '' : label;
}

/**
 * Find the row again from its key.
 *
 * This is the call that makes the whole file worth having: between deciding to
 * fill a row and filling it, Workday may have replaced every node in it. The key
 * is data, so it still points at the right row afterwards.
 */
export function findRow(anchorSel, key, { root = null, keyOf = keyOfWorkRow } = {}) {
    return rowsOf(anchorSel, { root }).find((r) => keyOf(r) === key) || null;
}

/** Rows with nothing in them — a blank waiting to be used, not a row to add to. */
export function isEmptyRow(row, fieldIds) {
    return fieldIds.every((id) => !valueIn(row, id));
}

/**
 * The errors THIS row is showing.
 *
 * Not a page count, and not a message parse: the container is the only thing
 * that says which row Workday is complaining about.
 */
export function errorsIn(row) {
    if (!row) return [];
    return [...row.querySelectorAll(SEL.fieldError)].filter(vis).map(txt);
}
