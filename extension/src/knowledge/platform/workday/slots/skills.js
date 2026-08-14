/**
 * skills[] — the slot WHAT, not the widget HOW. This is why Skills and Field of
 * Study never mix despite identical DOM: their SLOTS differ (cardinality +
 * vocabulary), and the plan routes on the slot, not the fingerprint.
 */

/** @type {import('../../../schema.js').Slot} */
export const skillsSlot = {
    id: 'skills[]',
    source: 'cv.skills[]',
    cardinality: 'many',
    vocabulary: 'exact-or-custom',      // a catalog exists but free text is allowed (the create row)
    taxonomyPolicy: 'verbatim',         // exact catalog → pick it; else the candidate's OWN words. NEVER semantic-map.
    capability: 'chip-search-multi',
    whenPresent: true,                  // a posting that omits Skills is not a gap
    notes: 'skillsearch is the oracle for existence/spelling; "unit economics" is not an MDLZ skill and goes on VERBATIM as a custom chip — the engine no longer rewrites it to "Customer Lifetime Value".',
};
