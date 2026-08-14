/**
 * repeatable-rows — the section-level pattern behind Work Experience,
 * Education, Languages: an Add button spawns a row of fields; rows can be
 * deleted; the same widgets repeat per row. Not a single-control capability —
 * a SECTION protocol the planner drives.
 */

/** @type {import('../../../schema.js').Capability} */
export const repeatableRows = {
    id: 'repeatable-rows',

    fingerprint: { section: 'a section with an Add button that clones a row of formField-* controls', cardinality: 'many-rows' },

    activate: ['Add spawns a blank row; fill its controls with the per-control capabilities; one row per CV entry'],
    read: ['the rows present and which are blank'],
    decide: 'one row per CV entry (job/school/language)',
    commit: ['fill each row\'s fields; add the NEXT row only after the current is complete'],
    verify: 'the row count equals the intended entries and each row\'s fields verified individually',
    recovery: ['re-add a missing row', 'complete a partial row'],

    invariants: [
        'DO NOT add a row while a BLANK row already exists — that is the row-growth bug (a new empty row every pass)',
        'RE-PLAN after a row mutation: adding/removing a row re-renders the section and re-indexes everything',
        'identify a row by its data (school name, language), never by index',
    ],
    antiPatterns: ['adding a row unconditionally each pass', 'keying a row on a GUID or DOM index'],

    measuredOn: [
        { tenant: 'mdlz', date: '2026-08-09', traces: ['R-174102', 'R-173186'], result: 'confirmed' },
        { tenant: 'maersk', date: '2026-08-14', traces: ['R173118'], result: 'dry-run' },
    ],
    confidence: 2,
    status: 'confirmed',   // My Experience rows filled on both (Maersk filled=25)
};
