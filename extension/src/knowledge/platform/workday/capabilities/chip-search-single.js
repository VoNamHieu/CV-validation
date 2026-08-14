/**
 * chip-search-single — a chip-search that holds ONE value and replaces it on a
 * new pick (Field of Study is the measured case). DOM-identical to
 * chip-search-multi, so it is routed by the plan's CONTRACT, not the shape.
 */

/** @type {import('../../../schema.js').Capability} */
export const chipSearchSingle = {
    id: 'chip-search-single',

    fingerprint: {
        container: '[data-automation-id="multiSelectContainer"]',
        cardinality: 'one',
        routedByContract: true,   // identical container to the multi — the contract decides
    },

    activate: ['click to open', 'type the term', 'pressEnter (submits query; a one-result query may commit on Enter alone)'],
    read: ['skillsearch/values API primary', 'DOM rows fallback'],
    decide: 'EXACT catalog row only. A closed taxonomy has no create row, so a non-exact term is a semantic gap, not a free-text commit — normalize the value upstream (see slots/field-of-study).',
    commit: ['exact-row checkbox/leaf click; the new chip replaces the old'],
    verify: 'the single chip reads as the expected canonical value; the list closing is NOT the signal (read the chip)',
    recovery: ['reopen', 'exact-row-click'],

    invariants: [
        'exactly one value; a new pick REPLACES, never accumulates',
        'no create row → a miss is a gap, never a mint',
    ],
    antiPatterns: ['near-match select', 'reading commit from list-closed instead of the chip'],

    measuredOn: [
        { tenant: 'mdlz', date: '2026-08-05', traces: ['R-172558', 'R-173186'], result: 'confirmed' },
    ],
    confidence: 1,
    status: 'unverified',
};
