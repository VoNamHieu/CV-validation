/**
 * Maersk deviations from the Workday baseline, measured 2026-08-14. These are
 * the second data point that turns "MDLZ behaviour" into "platform vs tenant".
 */
export const maerskQuirks = [
    {
        id: 'tenant-in-subdomain',
        statement: 'Tenant id is the SUBDOMAIN (maersk.wd3.myworkdayjobs.com); /Maersk_Careers/ in the path is the SITE.',
        impact: 'breaks any path-only tenant derivation; the FIRST measured case of subdomain-tenant.',
        evidence: 'R173118',
    },
    {
        id: 'skillsearch.create-only',
        statement: 'skillsearch returns ONLY the create row for every term (n=1, catalogN=0) — Maersk has no skills catalog enabled.',
        impact: 'every skill is free text at index 0, unique, no twin → the SIMPLE case; the twin/tail machinery is never exercised here.',
        evidence: 'probed negotiation/sql/agile → all n=1',
    },
    {
        id: 'six-steps-double-questions',
        statement: 'Six steps: Application Questions appears twice (primary + secondary questionnaire).',
        impact: 'confirms the engine must not assume 5 steps; step is read from the progress bar, page role from the heading.',
        evidence: 'progressBar "step N of 6"',
    },
    {
        id: 'disclosures.rich',
        statement: 'Voluntary Disclosures carries dateOfBirth (segmented), nationality, additionalNationalities, disabilities — far more than MDLZ.',
        impact: 'the dateOfBirth segmented widget is the one place v1 looped ~3 min before self-escaping; the concrete capability gap for v2-on-Maersk.',
        evidence: 'R173118 iters 8-25',
    },
    {
        id: 'proficiency-ladder-differs',
        statement: 'Language "Overall" ladder offered "Advanced" where the CV said "Native".',
        impact: 'the engine FLAGGED it for review rather than guessing — correct; proficiency rungs are tenant-specific.',
        evidence: '[Copo Needs] ⚠ flagged Overall*',
    },
    {
        id: 'degree-options-are-abbreviations',
        statement: 'Degree options are SHORT codes: High School, AA, AS, BA, BS, MA '
            + '(/wday/cxs/maersk/values/educations/degrees). MDLZ\'s are long labels ("Bachelor of Business Administration or equivalent").',
        impact: 'WAS the Nhịp-2 blocker: degreeLadder() was spelled in MDLZ long labels → no rung matched Maersk → required Degree looped. '
            + 'FIXED 2026-08-14: each ladder tier now falls through verbose-label → category short codes (=BA/=BS/=MA), matched against LIVE options; MDLZ hits its verbose rung first (untouched). '
            + 'Confirms the ladder-select invariant "the ladder is per-tenant"; unit-proven both vocabularies. A doctorate Maersk does not offer is left for the candidate, not downgraded to a master.',
        evidence: 'v2 run 2026-08-14 R173118: "Degree required" ×N, degreeLadder rungs measured vs the live values API',
    },
    {
        id: 'auth-is-a-sign-in-chooser',
        statement: 'A FRESH application opens a "Create Account / Sign In" gateway (step 1 of 7) with a CHOOSER: Sign in with email / Apple / Google — not a direct email+password form.',
        impact: 'a fresh dry-run cannot proceed without the candidate signing in (agent never enters credentials); resume an already-authenticated draft to measure the form. The extension login flow must click "Sign in with email" first, then fill — a per-tenant auth shape.',
        evidence: 'R189353 fresh apply 2026-08-14',
    },
];
