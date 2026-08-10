/**
 * Closed-enum catalogs, READ OFF THE LIVE FORM — the registry's seed.
 *
 * The user verified the premise by hand (2026-08-10): a closed listbox on this
 * tenant renders the SAME fixed option set on every posting — finite, not
 * search-backed. We scanned Degree twice on two different drafts (R-174102,
 * R-170139, 2026-08-09/10): identical 18 rows, identical order, both times.
 *
 * What this is for: "nối trước" — pre-resolving a CV value to the EXACT label
 * ahead of fill time (FE-side, rules first, LLM once for unusual VN wording),
 * so the runtime does an exact pick instead of fuzzy matching. The runtime's
 * job then shrinks to a DRIFT GUARD: before picking, compare the live options
 * against this snapshot; a mismatch means the tenant changed the catalog — do
 * NOT trust the pre-map, fall back to the runtime ladder, and flag this file
 * stale.
 *
 * VERBATIM matters. "A.A. - Associate of Arts  or equivalent" carries a DOUBLE
 * space before "or" — that is what the form renders, and an exact-pick that
 * "fixes" it stops matching. Do not tidy these strings.
 *
 * Search-backed catalogs (Skills, Field of Study) deliberately do NOT belong
 * here: probing them with a nonsense term still returns fuzzy matches, so they
 * have no enumerable bottom. They are handled by term ladders + the gap
 * resolver instead.
 */

export const CATALOGS = {
    tenant: 'mdlz',
    scannedAt: '2026-08-09',

    /** formField-degree — button listbox, 18 options after "Select One". */
    degree: [
        'A.A. - Associate of Arts  or equivalent',
        'B.Arch - Bachelor of Architecture or equivalent',
        'B.B.A. - Bachelor of Business Administration or equivalent',
        'B.C.S. - Bachelor of Computer Science or equivalent',
        'B.Com - Bachelor of Commerce or equivalent',
        'B.Ed - Bachelor of Education or equivalent',
        'B.Eng - Bachelor of Engineering or equivalent',
        'B.F.A. - Bachelor of Fine Arts or equivalent',
        'B.S. Acc - Bachelor of Accountancy or equivalent',
        'L.L.B. - Bachelor of Laws or equivalent',
        'B.S. - Bachelor of Science or equivalent',
        'B.A. - Bachelor of Arts or equivalent',
        'M.A. - Master of Arts or equivalent',
        'MBA - Master of Business Administration or equivalent',
        'M.S. - Master of Science or equivalent',
        'HS - High School or equivalent',
        'PhD - Doctor of Philosophy or equivalent',
        'JD - Juris Doctor or equivalent',
    ],

    /**
     * Overall language proficiency (per-tenant GUID id, found by label).
     * Three rungs and no "Native" — a mother tongue lands on 3 - Fluent.
     */
    overallProficiency: [
        '1 - Beginner',
        '2 - Intermediate',
        '3 - Fluent',
    ],

    // Still to scan (step 2 of the v1-retirement plan):
    //   · "How Did You Hear About Us" — top level is a closed set of ~8
    //     categories; leaves live one drill deeper. Scan during the cascade
    //     measurement trip.
    //   · Phone Device Type, Gender, Race/Ethnicity — closed sets already
    //     driven by ladders; snapshot them when next on the page.
};
