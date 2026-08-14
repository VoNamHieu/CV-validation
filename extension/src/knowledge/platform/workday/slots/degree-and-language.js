/**
 * The two remaining measured education/language slots. Degree is a semantic
 * ladder; Language is a repeatable row with its own sub-slots. Kept together
 * as the "education & languages" pair; split when either grows.
 */

/** @type {import('../../../schema.js').Slot} */
export const degreeSlot = {
    id: 'education[].degree.level',
    source: 'cv.education[].degree',
    cardinality: 'one',
    vocabulary: 'tenant-ladder',
    taxonomyPolicy: 'normalize-before-execution',   // "Bachelor" → the tenant's exact rung
    capability: 'ladder-select',
    whenPresent: true,
    notes: '"Bachelor" can match several rungs on a catalogue — resolve to the ONE the tenant offers, exact, or it is ambiguous and commits nothing.',
};

/** @type {import('../../../schema.js').Slot & {rowIdentity:string[], fields:object}} */
export const languageSlot = {
    id: 'languages[]',
    source: 'cv.languages[]',
    cardinality: 'many',
    vocabulary: 'tenant-ladder',
    taxonomyPolicy: 'normalize-before-execution',
    capability: 'repeatable-rows',
    whenPresent: true,
    rowIdentity: ['language'],
    fields: {
        language: 'chip-search-single / portal-listbox-select (taxonomy)',
        fluent: 'checkbox-controlled',
        proficiency: 'ladder-select',   // "Overall" — the rungs are tenant-specific
    },
    notes: 'proficiency ladders differ by tenant: Maersk offered "Advanced" where the CV said "Native" → the engine FLAGGED it for review rather than guessing (correct). Measured maersk 2026-08-14.',
};
