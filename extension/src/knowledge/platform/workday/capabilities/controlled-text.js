/**
 * controlled-text — a plain React-controlled text input / textarea (names,
 * address lines, phone, postal, role description). The stable, boring majority
 * of every page. The engine's text/textarea capabilities handle it.
 */

/** @type {import('../../../schema.js').Capability} */
export const controlledText = {
    id: 'controlled-text',

    fingerprint: { control: 'input[type=text] / textarea (no aria-haspopup, no checkbox/radio)', cardinality: 'one' },

    activate: ['focus the input'],
    read: ['.value'],
    decide: 'the CV value verbatim',
    commit: ['setNativeValue + dispatch input event — a plain assignment leaves React with a value it never saw arrive'],
    verify: 'the value STUCK: re-read after a beat, because a value painted into a controlled input survives in .value until the next render hands the old one back',
    recovery: ['re-type'],

    invariants: [
        'write via the native setter + input event, the way the page\'s own code would',
        'verify after a settle — an immediate read can catch a value about to be reverted',
    ],
    antiPatterns: ['assigning .value directly', 'verifying immediately without a settle'],

    measuredOn: [
        { tenant: 'mdlz', date: '2026-08-01', traces: ['R-174102'], result: 'confirmed' },
        { tenant: 'maersk', date: '2026-08-14', traces: ['R173118'], result: 'dry-run' },
    ],
    confidence: 2,
    status: 'confirmed',   // filled unchanged on Maersk (names, address, phone)
};
