// Per-ATS "apply recipe" registry (Option 2: code in the repo, served to the
// extension via /api/apply-recipes later). This first slice only encodes which
// ATS platforms gate their apply flow behind a LOGIN / account creation — the
// international sites whose apply is "lằng nhằng" (Workday makes you create an
// account before you can submit, SuccessFactors/iCIMS/Taleo/Oracle similar).
//
// The web app uses this to warn the user upfront and collect the credentials the
// auto-apply agent will reuse. The registry will grow into full form recipes
// (field selectors, step flow) that the agent reads.

export interface AtsLogin {
    ats: string;      // stable key, e.g. "workday"
    label: string;    // human name for the banner
    requiresLogin: boolean;
}

// Host-pattern → ATS. Order doesn't matter (patterns are disjoint). Greenhouse /
// Lever / Ashby / SmartRecruiters apply without an account, so they're absent
// (detectAtsLogin returns null → no login prompt).
const ATS_RULES: { test: RegExp; ats: string; label: string; requiresLogin: boolean }[] = [
    { test: /\.myworkdayjobs\.com|\.myworkdaysite\.com|myworkday/i, ats: 'workday', label: 'Workday', requiresLogin: true },
    { test: /successfactors|career\d?\.sap\.com|jobs\.sap\.com/i, ats: 'successfactors', label: 'SuccessFactors', requiresLogin: true },
    { test: /\.icims\.com/i, ats: 'icims', label: 'iCIMS', requiresLogin: true },
    { test: /\.taleo\.net/i, ats: 'taleo', label: 'Taleo', requiresLogin: true },
    { test: /oraclecloud\.com|\.oracle\.com/i, ats: 'oracle', label: 'Oracle Cloud', requiresLogin: true },
    { test: /\.avature\.net/i, ats: 'avature', label: 'Avature', requiresLogin: true },
    { test: /brassring|\.kenexa\./i, ats: 'brassring', label: 'BrassRing', requiresLogin: true },
];

/** ATS + login requirement for an apply/job URL, or null if unknown / no login. */
export function detectAtsLogin(url?: string | null): AtsLogin | null {
    if (!url) return null;
    let host = '';
    try {
        host = new URL(url).host.toLowerCase();
    } catch {
        host = String(url).toLowerCase();
    }
    for (const r of ATS_RULES) {
        if (r.test.test(host)) return { ats: r.ats, label: r.label, requiresLogin: r.requiresLogin };
    }
    return null;
}

/** Distinct ATS labels (with a job count) that need login across a set of URLs. */
export function loginAtsSummary(urls: (string | null | undefined)[]): { label: string; count: number }[] {
    const byLabel = new Map<string, number>();
    for (const u of urls) {
        const hit = detectAtsLogin(u);
        if (hit?.requiresLogin) byLabel.set(hit.label, (byLabel.get(hit.label) || 0) + 1);
    }
    return [...byLabel.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count);
}
