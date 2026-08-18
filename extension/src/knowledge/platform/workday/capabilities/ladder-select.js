/**
 * ladder-select — a portal-listbox whose answer is chosen by a SEMANTIC LADDER,
 * not an exact string: Degree ("Bachelor" → the tenant's own "B.A. - Bachelor
 * of Arts or equivalent"), proficiency levels. The value must be normalised to
 * the tenant's ladder BEFORE the click; the widget mechanics are the same as
 * portal-listbox-select.
 */

/** @type {import('../../../schema.js').Capability} */
export const ladderSelect = {
    id: 'ladder-select',

    fingerprint: {
        trigger: 'button[aria-haspopup="listbox"]',
        cardinality: 'one',
        valueSpace: 'tenant-ladder',   // routed by the slot's vocabulary, not the DOM
        routedByContract: true,
    },

    activate: ['open the listbox', 'read the tenant\'s OWN rungs'],
    read: ['the option labels present on THIS tenant (the ladder is tenant-specific)'],
    decide: 'map the CV value to the closest rung the tenant offers (LLM/normalizer upstream), then require an EXACT rung — a bare "Bachelor" that matches three rungs is ambiguous, commits nothing',
    commit: ['click the resolved rung'],
    verify: 'trigger text equals the resolved rung',
    recovery: ['reopen', 'scroll-to-rung'],

    invariants: [
        '"Bachelor" is several degrees on some catalogues — picking one puts a qualification on the application its owner never claimed; ambiguity ⇒ commit nothing',
        'the ladder is per-tenant; normalize to what THIS tenant offers, not a canonical list',
    ],
    antiPatterns: ['committing the first rung that contains the word'],

    measuredOn: [
        { tenant: 'mdlz', date: '2026-08-13', traces: ['R-173186'], result: 'confirmed' },
    ],
    confidence: 1,
    status: 'unverified',
};
