/**
 * Closed-enum catalogs, READ OFF THE LIVE FORM — the registry's seed.
 *
 * The user verified the premise by hand (2026-08-10): a closed listbox on this
 * tenant renders the SAME fixed option set on every posting — finite, not
 * search-backed. We scanned Degree twice on two different drafts (R-174102,
 * R-170139, 2026-08-09/10): identical 18 rows, identical order, both times.
 *
 * NOT YET WIRED — this is INTENT, not current behavior. Nothing imports
 * `CATALOGS` today; it is inert seed/reference data. The runtime still
 * fuzzy-matches live options at fill time (executors.chooseOption), and the
 * "nối trước" pre-resolution that exists (field of study) lives FE-side against
 * its own catalogue, not this file. The design below is what a future consumer
 * would do; until one exists, treat these arrays as measured ground truth only.
 *
 * The intent: "nối trước" — pre-resolve a CV value to the EXACT label ahead of
 * fill time (FE-side, rules first, LLM once for unusual VN wording), so the
 * runtime does an exact pick instead of fuzzy matching, and its job shrinks to a
 * DRIFT GUARD: before picking, compare the live options against this snapshot; a
 * mismatch means the tenant changed the catalog — do not trust the pre-map, fall
 * back to the runtime ladder, and flag this file stale.
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

    /**
     * formField-gender — button listbox, 4 options after "Select One". Measured
     * live on the intern flow (R-172558, 2026-08-11). The decline row is "Not
     * Specified". This is the exact set the gender translator resolves against:
     * a stated "Nam" → "Male", "Nữ" → "Female" (see semantic.js genderLadder,
     * applied in page-disclosures.js disclosureAnswer). Reference-only — nothing
     * imports this.
     */
    gender: [
        'Female',
        'Male',
        'Not Specified',
        'Other',
    ],

    /**
     * formField-ethnicity ("Race/Ethnicity") — button listbox of Vietnam's 54
     * ethnic groups, each suffixed " (Vietnam)", plus "Others (Vietnam)".
     * Measured live (R-172558, 2026-08-11): 55 options after "Select One", and
     * NO decline row — which is why a silent profile correctly LEAVES this
     * optional field blank rather than declining. The profile value "Kinh"
     * substring-matches "Kinh (Vietnam)", so it is filled from PROFILE with no
     * translation (this change does not touch the ethnicity matcher).
     *
     * VERBATIM: the diacritics, the curly apostrophes (H’Mông / M’Nông /
     * X’Tiêng), and the " (Vietnam)" suffix are what the form renders.
     */
    raceEthnicity: [
        'Ba Na (Vietnam)', 'Bố Y (Vietnam)', 'Brâu (Vietnam)', 'Bru - Vân Kiều (Vietnam)',
        'Chăm (Vietnam)', 'Chơ Ro (Vietnam)', 'Chu Ru (Vietnam)', 'Chứt (Vietnam)',
        'Co (Vietnam)', 'Cơ Ho (Vietnam)', 'Cờ Lao (Vietnam)', 'Cống (Vietnam)',
        'Cơ Tu (Vietnam)', 'Dao (Vietnam)', 'Ê Đê (Vietnam)', 'Gia Rai (Vietnam)',
        'Giáy (Vietnam)', 'Giẻ Triêng (Vietnam)', 'Hà Nhì (Vietnam)', 'Hoa (Vietnam)',
        'Hrê (Vietnam)', 'H’Mông (Vietnam)', 'Kháng (Vietnam)', 'Khơ Me (Vietnam)',
        'Khơ Mú (Vietnam)', 'Kinh (Vietnam)', 'La Chí (Vietnam)', 'La Ha (Vietnam)',
        'La Hủ (Vietnam)', 'Lào (Vietnam)', 'Lô Lô (Vietnam)', 'Lự (Vietnam)',
        'Mạ (Vietnam)', 'Mảng (Vietnam)', 'Mường (Vietnam)', 'M’Nông (Vietnam)',
        'Ngái (Vietnam)', 'Nùng (Vietnam)', 'Others (Vietnam)', 'Ơ Đu (Vietnam)',
        'Pà Thẻn (Vietnam)', 'Phù Lá (Vietnam)', 'Pu Péo (Vietnam)', 'Ra Glai (Vietnam)',
        'Rơ Măm (Vietnam)', 'Sán Chay (Vietnam)', 'Sán Dìu (Vietnam)', 'Si La (Vietnam)',
        'Tà Ôi (Vietnam)', 'Tày (Vietnam)', 'Thái (Vietnam)', 'Thổ (Vietnam)',
        'Xinh Mun (Vietnam)', 'Xơ Đăng (Vietnam)', 'X’Tiêng (Vietnam)',
    ],
};
