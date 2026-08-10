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
 * here: they are handled by term ladders + the gap resolver instead. (Degree is
 * the small deterministic closed set that DOES belong here — ~18 fixed labels,
 * exact-picked.)
 */

export const CATALOGS = {
    tenant: 'mdlz',
    scannedAt: '2026-08-10',

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

    /**
     * "How Did You Hear About Us?" — a CASCADE, measured 2026-08-10 (R-170139).
     *
     * The widget is chip-styled ("1 item selected") but behaves SINGLE-select:
     * a new pick replaces the chip. The top level is this closed set of 8
     * categories, each a `menuItem[role=option]` with a chevron and NO control.
     * Clicking one DRILLS: the level below shows a back breadcrumb plus the real
     * leaf, a `promptLeafNode` carrying a RADIO. Only the radio commits.
     *
     * Leaves are fetched on drill (not in local state), so they are not fully
     * enumerable from one open — but the top level is fixed and that is what the
     * registry guards. Known leaf paths measured so far are in `sourceLeaves`.
     *
     * NB the search box: typing does nothing until ENTER, and Enter then commits
     * Workday's TOP-RANKED match, leaf-level ("Referral" committed "Industry
     * Referral"). Drill-and-pick-the-radio is the exact path; search+Enter needs
     * a post-verify that the committed chip equals the intended leaf.
     */
    sourceCategories: [
        'Company Website',
        'Contacted by Recruiter',
        'Job Board',
        'Job Fair',
        'Other',
        'Referral',
        'Social Media',
        'Student / Campus Event',
    ],
    /** Category → the leaf(s) measured under it. Partial: leaves load on drill. */
    sourceLeaves: {
        'Company Website': ['Company Website'],
        'Referral': ['Industry Referral'],
    },

    /** formField-phoneType — button listbox, 4 options after "Select One". */
    phoneType: [
        'Mobile - Personal',
        'Mobile - Work',
        'Telephone - Office',
        'Telephone - Personal',
    ],

    // Still to scan (step 2 of the v1-retirement plan):
    //   · Gender, Race/Ethnicity (Voluntary Disclosures) — closed sets already
    //     driven by ladders; snapshot them on a run that reaches Disclosures.
    //     (Not reachable this trip without save-advancing through My Experience.)
};
