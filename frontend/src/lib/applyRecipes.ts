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
    selector?: string;    // exact CSS selector; omit when using labelMatch (dynamic-id fields).
                          // For shadow-text/autocomplete this is the light-DOM HOST selector
                          // (the control lives in the host's shadow root — see `control`).
    control?: string;     // selector for the control INSIDE a shadow host (e.g. 'input[type="tel"]');
                          // resolved by piercing shadow roots. Defaults to the first text control.
    profileKey?: string;  // key in the synced ExtensionProfile (omit for a fixed `value`)
    /** Dotted/indexed path into the STRUCTURED CV (`jobfitCv`) —
     *  `education[0].institution`, `languages[0].level`, `experience[1].company`.
     *  The flat profile is one string per concept and cannot express a list;
     *  Workday asks for school / qualification / subject / grade / language level
     *  as five separate required fields, and for a second education entry after
     *  that. Resolution order is value → profileKey → cvPath → default. */
    cvPath?: string;
    value?: string;       // fixed value (e.g. Postal "100000") — wins over profileKey
    default?: string;     // fallback when the profile key is empty (e.g. Country → "Vietnam")
    /** Semantic fallbacks for a required dropdown, tried in order after the
     *  resolved value. Replaces the old `pickAny`, which took the FIRST option
     *  when nothing matched — on "How did you hear about us?" that is a coin flip
     *  between "Employee referral", "Recruiter" and "Job fair", i.e. a claim about
     *  the candidate invented by the agent. No match now means the field is left
     *  for the user rather than answered wrongly. */
    valuePriority?: string[];
    /** Where this answer came from, for the review hand-off. Omit when the value
     *  is resolved from the profile. */
    answerSource?: 'AGENT_DEFAULT';
    multi?: boolean;      // input-based multi-select (Country Phone Code): idempotency checks selectedItemList
    labelMatch?: string;  // match a dynamic-id field by its question/label text (Application Questions)
    // shadow-text  = text input inside a web-component shadow root (SmartRecruiters spl-input)
    // autocomplete = type-to-search field that must commit a picked suggestion (SR city)
    // search-multi = a multi-select that refuses free text (Workday Skills):
    // each value must be typed, then picked from the search results it returns.
    type?: 'text' | 'select' | 'custom-select' | 'shadow-text' | 'autocomplete' | 'date' | 'file' | 'radio' | 'checkbox' | 'search-multi';
    /** Cap for a multi-value field, so a long skills list is not typed in full. */
    max?: number;
    /** Reshape the resolved value before filling. 'name' = one capital per word
     *  for ALL-CAPS words only. The web app already normalises names when it
     *  builds the profile, but that runs at SYNC time — a profile synced before
     *  that shipped still shouts, and re-syncing is a step nobody should need to
     *  know about. Applying it at fill time makes the result independent of when
     *  the profile was last synced. Never applied to a fixed `value`. */
    normalize?: 'name';
    /** Values the field can possibly take. A degree dropdown lists
     *  QUALIFICATIONS, and CVs write the SUBJECT on the same line — so
     *  `highestDegree` arrives as "Marketing" and the search is doomed before it
     *  starts, at ten seconds an iteration. A rejected value resolves to empty,
     *  which leaves a gap the review names instead. */
    accept?: 'qualification';
    /** When nothing matches, ask the model to choose from the options actually on
     *  screen, given the candidate's education. For fields where no string rule
     *  can work: a Vietnamese qualification ("Cử nhân Marketing") has to be mapped
     *  onto a list that never names it (B.S. / B.B.A. / L.L.B.). The reply is
     *  discarded unless it is one of the offered options. */
    infer?: boolean;
    required?: boolean;
}
export interface RecipeStep {
    name: string;
    detect?: string;      // selector present when this step is on screen
    fields: RecipeField[];
    advance?: string;     // "Next"/"Continue" button selector
    // Precondition for LEAVING this step: `advance` is withheld until this
    // selector matches. The résumé-upload step needs it — clicking Continue
    // before the file attaches skips the parse the step exists for. Only enforced
    // when a CV is actually in play, so a text-only apply cannot deadlock waiting
    // for an upload that was never going to happen.
    advanceWhen?: string;
    /** Repeating sections that must have an entry before their fields exist.
     *  Measured on Mondelez: "Work Experience" renders an Add button and nothing
     *  else until it is pressed — and the same step on another job of the same
     *  company came pre-filled, because the résumé parse created a row there. The
     *  section heading identifies the button; all of them share one automation id. */
    ensureSections?: string[];
}
// A non-form gateway the agent must click to reach the form (e.g. Workday's
// "Start Your Application" modal, rendered as <a role="button"> the generic scan
// misses). `needsCV` restricts it to when a CV is available (Autofill w/ Resume).
export interface RecipeGateway {
    label: string;
    detect?: string;      // selector present when the gateway is on screen
    click?: string;       // element to click (defaults to `detect`)
    text?: string[];      // match a text-only CTA by its visible label (SmartRecruiters "I'm interested")
    textDeny?: string[];  // never click a clickable whose label contains one of these ("Refer a friend")
    needsCV?: boolean;
}
export interface ApplyRecipe {
    ats: string;
    label: string;
    version: number;
    verified: boolean;
    hostPattern: string;  // RegExp source matched against the apply-page host
    singlePage?: boolean; // one-page form (no wizard): fill everything, then hand off for the user to submit
    login?: { emailSelector?: string; passwordSelector?: string; signInSelector?: string; createAccountSelector?: string };
    gateways?: RecipeGateway[];
    steps: RecipeStep[];
    fileUploadSelector?: string;
    fileUploadHost?: string;     // light-DOM host whose SHADOW root holds <input type=file> (SmartRecruiters dropzone)
    // Multiple résumé-upload targets in priority order. `host` → deep-find the file
    // input in its shadow; `selector` → a direct light/shadow input. `once` = upload
    // only once per page (SR's parser dropzone re-parses on every set).
    fileUploadHosts?: { host?: string; selector?: string; once?: boolean }[];
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
    version: 13,
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
                { label: 'First name', selector: '[data-automation-id="formField-legalName--firstName"] input', profileKey: 'firstName', type: 'text', required: true, normalize: 'name' },
                { label: 'Last name', selector: '[data-automation-id="formField-legalName--lastName"] input', profileKey: 'lastName', type: 'text', required: true, normalize: 'name' },
                // REQUIRED on Mondelez (measured), and the flat profile carries them
                // only if the user typed them in — a CV states an address but nothing
                // extracts it into those two keys. Profile-only, the planner hit two
                // empty required fields and returned NEED_HUMAN, ending the run on
                // data the CV was holding all along. Order is value → profileKey →
                // cvPath, so a filled profile still wins.
                { label: 'Address line 1', selector: '[data-automation-id="formField-addressLine1"] input', profileKey: 'addressStreet', cvPath: 'contact.address_street', type: 'text', required: true },
                { label: 'District or Town', selector: '[data-automation-id="formField-city"] input', profileKey: 'addressDistrict', cvPath: 'contact.address_district', type: 'text', required: true },
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
                {
                    // 3M renders this as a button→listbox, Mondelez as a
                    // searchable text input. Measured on both; only one exists
                    // per tenant, so the comma list resolves whichever is there.
                    label: 'How did you hear',
                    selector: '[data-automation-id="formField-source"] input, [data-automation-id="formField-source"] button',
                    valuePriority: [
                        'Company Website', 'Company Careers Website', 'Employer Website',
                        'Careers Website', 'Company Webpage', 'Website', 'Webpage', 'Online',
                    ],
                    type: 'custom-select', required: true, answerSource: 'AGENT_DEFAULT',
                },
                {
                    // Measured options: "Mobile - Personal", "Mobile - Work",
                    // "Telephone - Office", "Telephone - Personal".
                    label: 'Phone type', selector: '[data-automation-id="formField-phoneType"] button',
                    valuePriority: ['Mobile - Personal', 'Mobile', 'Cell'],
                    type: 'custom-select', answerSource: 'AGENT_DEFAULT',
                },
                // Required multi-select (input-based, not a button): the LLM types but never
                // commits an item, leaving it empty ("0 items selected") and blocking Next.
                { label: 'Country Phone Code', selector: '[data-automation-id="formField-countryPhoneCode"] input', value: 'Vietnam', type: 'custom-select', multi: true, required: true },
            // REQUIRED on Mondelez and matched by nothing here — the recipe filled
            // the other eleven required fields and left this one, so the step never
            // validated and never advanced. "No" is not a guess: it is the
            // deterministic Answer Policy rule for previous_employment, and a
            // candidate who HAD worked there would be applying from an internal site.
            { label: 'Previously worked here', selector: '[data-automation-id="formField-candidateIsPreviousWorker"]', value: 'No', type: 'radio', required: true, answerSource: 'AGENT_DEFAULT' },
            ],
            advance: '[data-automation-id="pageFooterNextButton"]',
        },
        {
            // My Experience: "Autofill with Resume" fills Job Title / Company / School
            // (text) but leaves the REQUIRED education Degree dropdown at "Select One" —
            // that empty required field silently blocks Next (the agent looped until
            // stuck). Pick the candidate's degree level (or any option) so it validates.
            name: 'My Experience',
            // ONLY the degree field: `jobTitleHeading` is the job-title <h2>
            // Workday renders on EVERY page of the apply flow, so using it as a
            // step marker made My Experience match the Application Questions page
            // first — and those fields were never filled on any job.
            detect: '[data-automation-id="formField-degree"]',
            ensureSections: ['Work Experience'],
            fields: [
                {
                    label: 'Degree', selector: '[data-automation-id="formField-degree"] button',
                    profileKey: 'highestDegree',
                    // NO ladder. Measured on Mondelez: 19 named qualifications
                    // (B.Arch, B.B.A., B.S., L.L.B. …) and no generic "Bachelor's
                    // Degree", so a fallback rung would pick a DISCIPLINE the
                    // candidate never claimed. Only their own stated degree may
                    // match; absent that the field goes to them at review.
                    //
                    // `accept` is what stops the OTHER failure: a CV writes the
                    // SUBJECT on the degree line, so highestDegree arrives as
                    // "Marketing" and the search of a qualification list is doomed
                    // before it starts — ten seconds an iteration, every iteration.
                    type: 'custom-select', required: true, accept: 'qualification', infer: true,
                },
                // Measured as REQUIRED on Mondelez and left blank by Workday's own
                // résumé parse, so the step could not advance without them.
                // The Work Experience block — REQUIRED on Mondelez and matched by
                // nothing here, so five required fields sat empty and the planner
                // reported the dates as "not in the user profile" when the CV held
                // all of them. Matched by LABEL rather than automation id: the
                // labels are what a real run measured verbatim.
                { label: 'Job Title', selector: '[data-automation-id="formField-jobTitle"] input', cvPath: 'experience[0].title', type: 'text', required: true },
                { label: 'Company', selector: '[data-automation-id="formField-companyName"] input', cvPath: 'experience[0].company', type: 'text', required: true },
                { label: 'Role description', selector: '[data-automation-id="formField-roleDescription"] textarea', cvPath: 'experience[0].description', type: 'text' },
                // startDate/endDate hold TWO inputs (dateSectionMonth-input,
                // dateSectionYear-input), so the WRAPPER is the selector.
                { label: 'Work From', selector: '[data-automation-id="formField-startDate"]', cvPath: 'experience[0].start_date', type: 'date', required: true },
                { label: 'Work To', selector: '[data-automation-id="formField-endDate"]', cvPath: 'experience[0].end_date', type: 'date' },
                { label: 'School or University', selector: '[data-automation-id="formField-schoolName"] input', cvPath: 'education[0].institution', type: 'text', required: true },
                { label: 'Field of Study', selector: '[data-automation-id="formField-fieldOfStudy"] input', cvPath: 'education[0].degree', type: 'text', required: true },
                // The Languages block. Measured on Mondelez: Language and "Overall"
                // (proficiency) are both REQUIRED, and "Overall" carries a
                // per-tenant GUID for an automation id — hence labelMatch.
                { label: 'Language', selector: '[data-automation-id="formField-language"] button', cvPath: 'languages[0].language', type: 'custom-select', required: true },
                {
                    // Measured: the list is "1 - Beginner / 2 - Intermediate /
                    // 3 - Fluent" — no "Native" row, so a CV stating a first
                    // language matched nothing and blocked a required field. The
                    // ladder steps DOWN only: a native speaker is fluent, so this
                    // claims nothing extra, and nothing higher exists to claim.
                    label: 'Language level', labelMatch: 'overall', cvPath: 'languages[0].level',
                    valuePriority: ['Native', 'Fluent', 'Advanced', 'Intermediate', 'Beginner'],
                    type: 'custom-select', required: true,
                },
                // Skills refuses free text: typing leaves the box empty and the
                // value only exists once a SEARCH RESULT is clicked.
                // Measured id. The search runs on ENTER, not on typing — without it
                // the list reads "No Items." for every term, which is easy to mistake
                // for an empty taxonomy.
                { label: 'Skills', selector: '[data-automation-id="formField-skills"] input', profileKey: 'skills', type: 'search-multi', max: 8 },
            ],
            advance: '[data-automation-id="pageFooterNextButton"]',
        },
        {
            // Application Questions: Yes/No conflict-of-interest dropdowns default to
            // "No"; the two required free-text questions have per-job dynamic ids, so
            // match them by question text.
            name: 'Application Questions',
            detect: '[data-automation-id="applyFlowPrimaryQuestionsPage"]',
            fields: [
                { label: 'Notice period', labelMatch: 'notice period', value: '30 days', type: 'text' },
                { label: 'Salary expectations', labelMatch: 'salary', profileKey: 'desiredSalary', default: 'Negotiable', type: 'text' },
            ],
            advance: '[data-automation-id="pageFooterNextButton"]',
        },
        {
            // Step 1 of the wizard, and it had no entry here at all — which is why
            // a run that logged in and uploaded the CV then sat on this page until
            // the stuck-detector killed it. The page carries NO form fields (a
            // dropzone and "Continue", nothing else), so the agent took the "host
            // matches but the form has not rendered yet" branch and waited for a
            // form that was never coming: no step matched, so there was no
            // `advance` selector to click, and the LLM is deliberately not handed a
            // fieldless page.
            //
            // LAST in the array on purpose. steps.find() takes the first match, and
            // Workday keeps the /apply/autofillWithResume URL for the whole wizard
            // — so if this page's container id outlives the step it belongs to, the
            // specific steps above must still win.
            name: 'Autofill with Resume',
            detect: '[data-automation-id="applyFlowAutoFillPage"]',
            fields: [],
            // Do not leave until the resume is actually attached. Advancing early
            // skips the parse this step exists for, and that parse is what fills My
            // Information — measured: the file input is absent on the first pass and
            // appears on the second, so an unguarded advance sails past the upload.
            advanceWhen: '[data-automation-id="file-upload-item"], [data-automation-id="file-upload-successful"]',
            advance: '[data-automation-id="pageFooterNextButton"]',
        },
    ],
    // Uploaded on the "Autofill with Resume" step above — Workday's stable upload
    // input, measured on Mondelez (present from the second pass, not the first).
    fileUploadSelector: '[data-automation-id="file-upload-input-ref"]',
    submitSelector: '[data-automation-id="pageFooterSubmitButton"]',
    // Final Review step (its "Submit" reuses pageFooterNextButton) → agent stops here.
    finalStepSelector: '[data-automation-id="applyFlowReviewPage"]',
    thirdPartySkip: ['indeed', 'linkedin'],
};

// SmartRecruiters "oneclick-ui" easy-apply form. UNVERIFIED against a live fill —
// derived from a real captured DOM (AccorHotel oneclick, 2026-07-25). SR is an
// Angular app built from Shadow-DOM web components (spl-input, spl-phone-field,
// spl-autocomplete, spl-dropzone): each control's real <input> lives INSIDE the
// custom element's shadow root, so a plain `[data-test=…] input` selector returns
// null. The agent resolves the light-DOM host by its stable data-test id, then
// deep-queries the shadow for the input. The whole form is ONE page ending in a
// required consent checkbox + a single Submit → `singlePage`: fill everything,
// then hand off (we never auto-submit and never auto-tick a legal-consent box).
const SMARTRECRUITERS: ApplyRecipe = {
    ats: 'smartrecruiters',
    label: 'SmartRecruiters',
    version: 1,
    verified: false,
    singlePage: true,
    hostPattern: 'smartrecruiters\\.com',
    // The public job ad opens the apply form only after clicking its CTA — a blue
    // "I'm interested" button (NOT "Refer a friend" right below it). It's a styled
    // <a>/<button> with no stable id, so match by visible text; fall back to a link
    // straight to the /oneclick-ui form. Clicking is capped + no-ops on the form.
    gateways: [
        {
            label: "I'm interested",
            text: ["i'm interested", 'i am interested', 'apply now', 'apply'],
            textDeny: ['refer a friend', 'refer'],
            detect: '[data-test="job-apply-button"], a[data-test="apply-button"], a[href*="/oneclick-ui/"]',
        },
    ],
    steps: [
        {
            name: 'Easy Apply',
            detect: '[data-test="easy-apply-container"], [data-test="personal-information"], [data-test="personal-info-first-name-input"], [data-test="resume-upload"]',
            fields: [
                { label: 'First name', selector: '[data-test="personal-info-first-name-input"]', profileKey: 'firstName', type: 'shadow-text', required: true },
                { label: 'Last name', selector: '[data-test="personal-info-last-name-input"]', profileKey: 'lastName', type: 'shadow-text', required: true },
                { label: 'Email', selector: '[data-test="personal-info-email-input"]', profileKey: 'email', type: 'shadow-text', required: true },
                { label: 'Confirm email', selector: '[data-test="personal-info-email-confirm-input"]', profileKey: 'email', type: 'shadow-text' },
                // Phone: spl-phone-field pre-sets country VN; its FIRST shadow input is
                // the country-code picker, so target the tel input explicitly.
                { label: 'Phone', selector: '[data-test="personal-info-phone"]', control: 'input[type="tel"]', profileKey: 'phone', type: 'shadow-text', required: true },
                // City autocomplete (≥3 chars → async place lookup → pick a match).
                { label: 'Location', selector: '[data-test="location-autocomplete"]', profileKey: 'addressProvince', default: 'Ho Chi Minh City', type: 'autocomplete', required: true },
                // Optional free-text note to the hiring manager → use the tailored letter.
                { label: 'Message', selector: '[data-test="hiring-manager-message-text"], [data-test="hiring-manager-message-container"]', profileKey: 'coverLetter', type: 'shadow-text' },
            ],
            // No `advance`: single-page form. The agent stops after filling.
        },
    ],
    // Upload the CV to the "Easy Apply" PARSER dropzone ONLY (once). SR parses it to
    // auto-fill personal info + experience + education AND propagates the file to the
    // required "Sơ yếu lý lịch" attachment (user-confirmed). We deliberately do NOT
    // also upload to resume-upload: its <input> clears after processing so hasFile
    // stays false → re-uploading every pass triggers a repeated re-parse that WIPES
    // the auto-filled Experience/Education. One upload is enough. (The file input
    // lives in the dropzone's own shadow root — resolved host → deep-find.)
    fileUploadHosts: [
        { host: '[data-test="apply-with-resume-container"]', once: true },
    ],
    submitSelector: '[data-test="footer-submit"]',   // reference only — the user submits
    thirdPartySkip: ['indeed', 'linkedin'],
};

export const APPLY_RECIPES: ApplyRecipe[] = [WORKDAY, SMARTRECRUITERS];

/** The recipe whose hostPattern matches this apply/job URL, or null. */
export function recipeForUrl(url?: string | null): ApplyRecipe | null {
    if (!url) return null;
    let host = '';
    try { host = new URL(url).host.toLowerCase(); } catch { host = String(url).toLowerCase(); }
    return APPLY_RECIPES.find(r => new RegExp(r.hostPattern, 'i').test(host)) || null;
}
