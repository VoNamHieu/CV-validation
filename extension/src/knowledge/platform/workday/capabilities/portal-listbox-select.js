/**
 * portal-listbox-select — the "custom-dropdown" family (Country, Source, Phone
 * Device Type, Province, Prefix…). A button opens a PORTALED listbox; options
 * are not inline. The engine's searchSelect handles it.
 */

/** @type {import('../../../schema.js').Capability} */
export const portalListboxSelect = {
    id: 'portal-listbox-select',

    fingerprint: {
        trigger: 'button[aria-haspopup="listbox"]',
        options: 'portaled activeListContainer / role=listbox (NOT inline)',
        cardinality: 'one',
    },

    activate: ['click the trigger → portal opens', 'options read page-wide (they are not inside the trigger node)'],
    read: ['visible options page-wide', 'values API where present (e.g. /wday/cxs/{tenant}/values/…)'],
    decide: 'exact label, else the single distinct option that contains it (e.g. "Vietnam" → the only "Vietnam (+84)"); two containing it is ambiguous, not an answer',
    commit: ['click the option; a GUID lands in the hidden input, the label on the button'],
    verify: 'the trigger text (or the option GUID) equals the picked value',
    recovery: ['reopen', 'scroll-to-label'],

    invariants: [
        'the hidden input holds an option GUID, not the answer — rows with the same answer share a GUID and are indistinguishable by it',
        'the list is portaled: read/close page-wide, not lease-scoped',
    ],
    antiPatterns: ['keying a repeating row on the GUID (grows a row per pass)'],

    measuredOn: [
        { tenant: 'mdlz', date: '2026-08-03', traces: ['R-174102'], result: 'confirmed' },
        { tenant: 'maersk', date: '2026-08-14', traces: ['R173118'], result: 'dry-run' },
    ],
    confidence: 2,
    status: 'confirmed',   // ran on Maersk (Country/Source/Prefix/Province) with no change
};
