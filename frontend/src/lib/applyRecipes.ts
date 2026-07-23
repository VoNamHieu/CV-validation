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

// ─────────────────────────── Form recipes ───────────────────────────
// A per-ATS "recipe" tells the agent how a platform's application form is laid
// out so it fills DETERMINISTICALLY instead of the LLM guessing. Because
// international ATS are dominated by ~10 platforms whose DOM is standardized
// (Workday keys every field with a stable data-automation-id), one recipe per
// ATS covers every company on it. Recipes are code here, served to the extension
// via /api/apply-recipes, so a broken selector is a Vercel deploy away — no
// Chrome Web Store review. `verified:false` = derived from known selectors,
// pending a live-capture check.

export interface RecipeField {
    label: string;
    selector: string;
    profileKey?: string;  // key in the synced ExtensionProfile (omit for a fixed `value`)
    value?: string;       // fixed value (e.g. Postal "100000") — wins over profileKey
    default?: string;     // fallback when the profile key is empty (e.g. Country → "Vietnam")
    pickAny?: boolean;    // required-but-arbitrary dropdown: any option satisfies it
    type?: 'text' | 'select' | 'custom-select' | 'date' | 'file' | 'radio' | 'checkbox';
    required?: boolean;
}
export interface RecipeStep {
    name: string;
    detect?: string;      // selector present when this step is on screen
    fields: RecipeField[];
    advance?: string;     // "Next"/"Continue" button selector
}
// A non-form gateway the agent must click to reach the form (e.g. Workday's
// "Start Your Application" modal, rendered as <a role="button"> the generic scan
// misses). `needsCV` restricts it to when a CV is available (Autofill w/ Resume).
export interface RecipeGateway {
    label: string;
    detect: string;       // selector present when the gateway is on screen
    click?: string;       // element to click (defaults to `detect`)
    needsCV?: boolean;
}
export interface ApplyRecipe {
    ats: string;
    label: string;
    version: number;
    verified: boolean;
    hostPattern: string;  // RegExp source matched against the apply-page host
    login?: { emailSelector?: string; passwordSelector?: string; signInSelector?: string; createAccountSelector?: string };
    gateways?: RecipeGateway[];
    steps: RecipeStep[];
    fileUploadSelector?: string;
    submitSelector?: string;
    finalStepSelector?: string;  // present when the ATS's final review step is on screen → agent stops (never auto-submits)
    thirdPartySkip?: string[];
}

// VERIFIED 2026-07-15 against a real 3M Workday capture (My Information + Sign-In
// steps). The key correction over the guessed selectors: Workday puts the
// data-automation-id on the FIELD WRAPPER (`formField-<fieldId>`), and the actual
// control inside has only a plain `id` — so every field selector is the wrapper
// plus its inner `input` (text) or `button` (custom dropdown). Field IDs
// (legalName--firstName, phoneNumber, addressLine1, city, country…) are Workday's
// standard candidate-data model, stable across tenants.
const WORKDAY: ApplyRecipe = {
    ats: 'workday',
    label: 'Workday',
    version: 3,
    verified: true,
    hostPattern: '\\.myworkdayjobs\\.com|\\.myworkdaysite\\.com',
    login: {
        emailSelector: '[data-automation-id="email"]',
        passwordSelector: '[data-automation-id="password"]',
        signInSelector: '[data-automation-id="signInSubmitButton"]',
        createAccountSelector: '[data-automation-id="createAccountLink"]',
    },
    // "Start Your Application" modal (<a role="button">). ONLY "Autofill with
    // Resume": the flow always syncs a CV PDF first, and Workday's résumé parse
    // pre-fills the tricky required dropdowns (Country/source). "Apply Manually"
    // is intentionally omitted — it skips that pre-fill.
    gateways: [
        { label: 'Autofill with Resume', detect: '[data-automation-id="autofillWithResume"]', needsCV: true },
    ],
    steps: [
        {
            name: 'My Information',
            detect: '[data-automation-id="formField-legalName--firstName"]',
            fields: [
                // Western-script name — the required, always-present pair (a tenant
                // that also enables local-script names adds *--firstNameLocal, which
                // we leave to the LLM since we have no romanization-split for it).
                { label: 'First name', selector: '[data-automation-id="formField-legalName--firstName"] input', profileKey: 'firstName', type: 'text', required: true },
                { label: 'Last name', selector: '[data-automation-id="formField-legalName--lastName"] input', profileKey: 'lastName', type: 'text', required: true },
                { label: 'Address line 1', selector: '[data-automation-id="formField-addressLine1"] input', profileKey: 'addressStreet', type: 'text' },
                { label: 'District or Town', selector: '[data-automation-id="formField-city"] input', profileKey: 'addressDistrict', type: 'text' },
                // Required text input a résumé never carries → autofill leaves it blank
                // and Next validation blocks. Default to the VN generic postal code.
                { label: 'Postal Code', selector: '[data-automation-id="formField-postalCode"] input', value: '100000', type: 'text', required: true },
                { label: 'Phone number', selector: '[data-automation-id="formField-phoneNumber"] input', profileKey: 'phone', type: 'text', required: true },
                // Custom Workday dropdowns (button→listbox): click → listbox opens →
                // type-to-filter → pick the option. The agent's custom-select handler
                // drives these deterministically. Country FIRST (it re-renders the
                // region/postal fields), then Province. `value`/pickAny satisfy the
                // required-but-arbitrary dropdowns so the step no longer relies on the
                // LLM landing them — the cause of the flaky My-Information step.
                { label: 'Country', selector: '[data-automation-id="formField-country"] button', profileKey: 'nationality', default: 'Vietnam', type: 'custom-select', required: true },
                { label: 'Province or City', selector: '[data-automation-id="formField-countryRegion"] button', profileKey: 'addressProvince', type: 'custom-select' },
                { label: 'How did you hear', selector: '[data-automation-id="formField-source"] button', value: 'Website', pickAny: true, type: 'custom-select', required: true },
                { label: 'Phone type', selector: '[data-automation-id="formField-phoneType"] button', value: 'Mobile', type: 'custom-select' },
            ],
            advance: '[data-automation-id="pageFooterNextButton"]',
        },
    ],
    // Resume upload lives on the earlier "Autofill with Resume" step (not captured
    // here) — this is Workday's stable upload input; unverified against a live DOM.
    fileUploadSelector: '[data-automation-id="file-upload-input-ref"]',
    submitSelector: '[data-automation-id="pageFooterSubmitButton"]',
    // Final Review step (its "Submit" reuses pageFooterNextButton) → agent stops here.
    finalStepSelector: '[data-automation-id="applyFlowReviewPage"]',
    thirdPartySkip: ['indeed', 'linkedin'],
};

export const APPLY_RECIPES: ApplyRecipe[] = [WORKDAY];

/** The recipe whose hostPattern matches this apply/job URL, or null. */
export function recipeForUrl(url?: string | null): ApplyRecipe | null {
    if (!url) return null;
    let host = '';
    try { host = new URL(url).host.toLowerCase(); } catch { host = String(url).toLowerCase(); }
    return APPLY_RECIPES.find(r => new RegExp(r.hostPattern, 'i').test(host)) || null;
}
