/**
 * education[].fieldOfStudy — a CLOSED taxonomy chip-search. No create row, so an
 * off-catalogue value cannot be minted; it must be normalised to a value the
 * catalogue holds BEFORE execution. Same DOM as skills[], opposite policy.
 */

/** @type {import('../../../schema.js').Slot} */
export const fieldOfStudySlot = {
    id: 'education[].fieldOfStudy',
    source: 'cv.education[].fieldOfStudy',
    cardinality: 'one',
    vocabulary: 'closed-taxonomy',
    taxonomyPolicy: 'normalize-before-execution',   // "Marketing Management" → "Marketing", by an upstream normaliser
    capability: 'chip-search-single',
    whenPresent: true,
    notes: 'the FE field-of-study adapter (resolveFieldOfStudy) normalises on a COPY so the editor keeps the candidate\'s own words; the executor is NEVER asked to translate. If no exact catalogue value exists, this is a semantic gap, not a free-text commit.',
};
