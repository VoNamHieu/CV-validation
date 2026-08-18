/**
 * MDLZ deviations from the Workday platform baseline. Where a platform quirk is
 * split by tenant (e.g. skillsearch padding), the MDLZ half lives here.
 */
export const mdlzQuirks = [
    {
        id: 'skillsearch.pads-16-with-twins',
        statement: 'skillsearch pads every query to ~16 rows, so an EXACT catalog term always has a create-row twin of the same text.',
        impact: 'exact terms cannot be committed by DOM label alone (ambiguous twin) → the engine data-writes by id; this is the tenant that MADE the twin case the norm, not a corner.',
        evidence: '2026-08-13',
    },
    {
        id: 'skillsearch.rich-catalog',
        statement: 'A large real catalog: "unit economics"→16 economics rows, "Agentic AI" exists, etc.',
        impact: 'most CV skills resolve to a real catalog row; only genuinely-novel terms fall to the create row.',
        evidence: '2026-08-13',
    },
    {
        id: 'language.three-rows-share-guid',
        statement: 'Three Language rows displayed "Vietnamese" while all three hidden inputs held the same option GUID.',
        impact: 'a planner keyed on the GUID grew a row per pass; rows are identified by data, not GUID.',
        evidence: 'R-174102 2026-08-09',
    },
];
