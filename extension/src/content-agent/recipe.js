// AUTO-APPLY RECIPES (extension side). Part of the Copo apply agent.
//
// A per-ATS "recipe" gives the agent exact, verified field selectors so it fills
// the standardized parts of an international apply form DETERMINISTICALLY instead
// of the LLM guessing selectors. The source of truth is the web app
// (/api/apply-recipes, generated from frontend/src/lib/applyRecipes.ts); the
// bundled FALLBACK_RECIPES below is a safety net used when that fetch fails or
// hasn't happened yet — so the agent still works offline / before a deploy.
//
// Scope on purpose: the recipe fills the standardized fields — TEXT inputs AND
// Workday's custom dropdowns (button→listbox) — deterministically. Validation
// recovery and step navigation stay with the LLM planner, which re-observes each
// pass; the recipe re-runs every iteration and is idempotent, so partial progress
// accumulates and already-filled fields are skipped.

import { deepFindControl, deepQuery, deepQueryAll, dropFileOnZone, safeActivate, setFileOnInput, setNativeValue, simulateTyping, sleep, waitForElement } from './dom.js';
import { isThirdPartyApply } from './detect.js';

// Keep in sync with frontend/src/lib/applyRecipes.ts (WORKDAY). Fields verified
// against real 3M Workday captures (My Information, 2026-07-15 / -22). The
// custom-select handler is grounded in the captured widget markup (button[value]
// + promptOption) but PENDING a live-fill verification.
export const FALLBACK_RECIPES = [
    {
        ats: 'workday',
        label: 'Workday',
        version: 12,
        verified: true,
        hostPattern: '\\.myworkdayjobs\\.com|\\.myworkdaysite\\.com',
        login: {
            emailSelector: '[data-automation-id="email"]',
            passwordSelector: '[data-automation-id="password"]',
            signInSelector: '[data-automation-id="signInSubmitButton"]',
            createAccountSelector: '[data-automation-id="createAccountLink"]',
        },
        // Non-form gateway the agent clicks to reach the form. The "Start Your
        // Application" modal renders its options as <a role="button"> (not
        // <button>), which the generic scan misses — so drive it by exact selector.
        // ONLY "Autofill with Resume": the flow always syncs a CV PDF first, and
        // letting Workday parse the résumé pre-fills the tricky required dropdowns
        // (Country/source). "Apply Manually" is intentionally omitted — it skips
        // that pre-fill and leaves every required field to fill by hand.
        gateways: [
            { label: 'Autofill with Resume', detect: '[data-automation-id="autofillWithResume"]', needsCV: true },
        ],
        steps: [
            {
                name: 'My Information',
                detect: '[data-automation-id="formField-legalName--firstName"]',
                fields: [
                    { label: 'First name', selector: '[data-automation-id="formField-legalName--firstName"] input', profileKey: 'firstName', type: 'text', required: true },
                    { label: 'Last name', selector: '[data-automation-id="formField-legalName--lastName"] input', profileKey: 'lastName', type: 'text', required: true },
                    { label: 'Address line 1', selector: '[data-automation-id="formField-addressLine1"] input', profileKey: 'addressStreet', type: 'text' },
                    { label: 'District or Town', selector: '[data-automation-id="formField-city"] input', profileKey: 'addressDistrict', type: 'text' },
                    // Required text input; a résumé never carries it, so autofill leaves
                    // it blank and the step's Next validation blocks. Default to the VN
                    // generic postal code.
                    { label: 'Postal Code', selector: '[data-automation-id="formField-postalCode"] input', value: '100000', type: 'text', required: true },
                    { label: 'Phone number', selector: '[data-automation-id="formField-phoneNumber"] input', profileKey: 'phone', type: 'text', required: true },
                    // Custom Workday dropdowns (button→listbox). Country FIRST — picking it
                    // re-renders the region/postal fields — then Province. `value`/pickAny
                    // satisfy the two required-but-arbitrary dropdowns deterministically so
                    // the step stops depending on the LLM landing them.
                    { label: 'Country', selector: '[data-automation-id="formField-country"] button', profileKey: 'nationality', default: 'Vietnam', type: 'custom-select', required: true },
                    { label: 'Province or City', selector: '[data-automation-id="formField-countryRegion"] button', profileKey: 'addressProvince', type: 'custom-select' },
                    // Required, and the answer is a FACT the employer acts on:
                    // "Employee referral" or "Recruiter" routes the application
                    // differently and implies a person who does not exist. It used
                    // to carry `pickAny`, which takes the first option in the list
                    // when nothing matches — a coin flip between claims about how
                    // the candidate found the job. Now it walks a semantic ladder
                    // and, failing all of it, leaves the field for the user.
                    {
                        // Two different widgets behind one automation id: 3M renders
                        // a button→listbox, Mondelez a searchable text input
                        // (placeholder "Search"). Measured on both. The comma list
                        // matches whichever exists — only one does per tenant.
                        label: 'How did you hear',
                        selector: '[data-automation-id="formField-source"] input, [data-automation-id="formField-source"] button',
                        valuePriority: [
                            'Company Website', 'Company Careers Website', 'Employer Website',
                            'Careers Website', 'Company Webpage', 'Website', 'Webpage', 'Online',
                        ],
                        type: 'custom-select', required: true, answerSource: 'AGENT_DEFAULT',
                    },
                    // Measured options on Mondelez: "Mobile - Personal",
                    // "Mobile - Work", "Telephone - Office", "Telephone - Personal".
                    // A bare "Mobile" substring-matches the first of those, but
                    // naming the ladder makes the personal line a deliberate
                    // choice rather than whichever happens to be listed first.
                    {
                        label: 'Phone type', selector: '[data-automation-id="formField-phoneType"] button',
                        valuePriority: ['Mobile - Personal', 'Mobile', 'Cell'],
                        type: 'custom-select', answerSource: 'AGENT_DEFAULT',
                    },
                    // Country Phone Code is a REQUIRED multi-select (input-based, not a
                    // button): the LLM types into it but never commits an item, so it
                    // stays empty ("0 items selected") and silently blocks Next — the
                    // scanner can't see it's required, so the agent looped until stuck.
                    { label: 'Country Phone Code', selector: '[data-automation-id="formField-countryPhoneCode"] input', value: 'Vietnam', type: 'custom-select', multi: true, required: true },
                ],
                advance: '[data-automation-id="pageFooterNextButton"]',
            },
            {
                // My Experience: "Autofill with Resume" populates Job Title / Company /
                // School (text) but leaves the REQUIRED education Degree dropdown at
                // "Select One" — that empty required field silently blocks Next and the
                // agent used to loop until stuck. Pick the candidate's degree level (or
                // any option) so it validates. jobTitle/company/dates come from the
                // parse; anything the parser still left empty is surfaced by the
                // required-blocker audit at hand-off.
                // Detect ONLY by the degree field. `jobTitleHeading` used to be
                // an alternative here, and it is not a step marker at all — it is
                // the <h2> job title Workday renders on EVERY page of the apply
                // flow (measured on the Mondelez Create Account page, where it is
                // visible and the degree field is not). Because `find()` takes the
                // first matching step, that made My Experience swallow the
                // Application Questions page too, so its notice-period and salary
                // fields were never filled on any job.
                name: 'My Experience',
                detect: '[data-automation-id="formField-degree"]',
                fields: [
                    // Also a claim about the candidate, so also no `pickAny`: the
                    // first option in a degree list is as likely to be "High
                    // School" or "Doctorate" as anything else, and either is a
                    // misrepresentation of their education. Match the profile's
                    // own level through common phrasings; if none is offered,
                    // leave it — the required-blocker audit names it at handoff.
                    {
                        label: 'Degree', selector: '[data-automation-id="formField-degree"] button',
                        profileKey: 'highestDegree',
                        // NO ladder. Measured on Mondelez: the list is 19 named
                        // qualifications (B.Arch, B.B.A., B.S., L.L.B. …) with no
                        // generic "Bachelor's Degree" entry, so any fallback rung
                        // would be picking a DISCIPLINE the candidate never
                        // claimed. Only their own stated degree may match here;
                        // absent that the field is left for them at review.
                        // (Backed by the unambiguous-match rule in fillCustomSelect,
                        // which refuses "Bachelor" outright — it hits 11 options.)
                        // No fixed answerSource: when `highestDegree` is on the
                        // profile this IS the user's answer, and hard-coding
                        // AGENT_DEFAULT flagged their own degree for review. The
                        // ladder only applies when the profile has nothing.
                        type: 'custom-select', required: true,
                    },
                    // Measured as REQUIRED on Mondelez, and left blank by Workday's
                    // own résumé parse — so the step could not advance without them
                    // even though the CV states both.
                    { label: 'School or University', selector: '[data-automation-id="formField-schoolName"] input', cvPath: 'education[0].institution', type: 'text', required: true },
                    { label: 'Field of Study', selector: '[data-automation-id="formField-fieldOfStudy"] input', cvPath: 'education[0].degree', type: 'text', required: true },
                ],
                advance: '[data-automation-id="pageFooterNextButton"]',
            },
            {
                // Application Questions: the Yes/No conflict-of-interest dropdowns
                // default to "No"; the two required free-text questions have per-job
                // dynamic ids, so match them by question text (labelMatch).
                name: 'Application Questions',
                detect: '[data-automation-id="applyFlowPrimaryQuestionsPage"]',
                fields: [
                    { label: 'Notice period', labelMatch: 'notice period', value: '30 days', type: 'text' },
                    { label: 'Salary expectations', labelMatch: 'salary', profileKey: 'desiredSalary', default: 'Negotiable', type: 'text' },
                ],
                advance: '[data-automation-id="pageFooterNextButton"]',
            },
        ],
        fileUploadSelector: '[data-automation-id="file-upload-input-ref"]',
        submitSelector: '[data-automation-id="pageFooterSubmitButton"]',
        // The final Review step (its "Submit" reuses pageFooterNextButton). When
        // this is on screen the agent STOPS and hands off — it never submits.
        finalStepSelector: '[data-automation-id="applyFlowReviewPage"]',
        thirdPartySkip: ['indeed', 'linkedin'],
    },
    // SmartRecruiters "oneclick-ui" easy-apply form. UNVERIFIED against a live
    // fill — derived from a real captured DOM (AccorHotel, 2026-07-25). SR is an
    // Angular app built from Shadow-DOM web components (spl-input, spl-phone-field,
    // spl-autocomplete, spl-dropzone): the real <input> lives inside each custom
    // element's shadow root, so every control is resolved by finding the light-DOM
    // host by its stable data-test id, then deep-querying the shadow for the input.
    // The whole form is ONE page (no wizard) and ends in a single "Submit" plus a
    // required consent checkbox — so this is `singlePage`: fill everything, then
    // hand off for the user to tick consent + Submit (we never auto-submit, and we
    // never auto-tick a legal-consent box).
    {
        ats: 'smartrecruiters',
        label: 'SmartRecruiters',
        version: 1,
        verified: false,
        singlePage: true,
        hostPattern: 'smartrecruiters\\.com',
        // The public job ad opens the apply form only after clicking its CTA — a
        // blue "I'm interested" button (NOT "Refer a friend" right below it). It's a
        // styled <a>/<button> with no stable id, so match by visible text; fall back
        // to a link straight to the /oneclick-ui form. Clicking is capped + no-ops on
        // the form page itself.
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
                    // Phone: spl-phone-field pre-sets country VN; its FIRST shadow input
                    // is the country-code picker, so target the tel input explicitly.
                    { label: 'Phone', selector: '[data-test="personal-info-phone"]', control: 'input[type="tel"]', profileKey: 'phone', type: 'shadow-text', required: true },
                    // City autocomplete (min 3 chars → async place lookup → pick a match).
                    { label: 'Location', selector: '[data-test="location-autocomplete"]', profileKey: 'addressProvince', default: 'Ho Chi Minh City', type: 'autocomplete', required: true },
                    // Optional free-text note to the hiring manager → use the tailored letter.
                    { label: 'Message', selector: '[data-test="hiring-manager-message-text"], [data-test="hiring-manager-message-container"]', profileKey: 'coverLetter', type: 'shadow-text' },
                ],
                // No `advance`: single-page form. The agent stops after filling.
            },
        ],
        // Upload the CV to the "Easy Apply" PARSER dropzone ONLY (once). SR parses it
        // to auto-fill personal info + experience + education AND propagates the file
        // to the required "Sơ yếu lý lịch" attachment (user-confirmed). We deliberately
        // do NOT also upload to resume-upload: its <input> clears after processing so
        // hasFile stays false → we'd re-upload every pass → repeated re-parse that
        // WIPED the auto-filled Experience/Education. One upload is enough.
        fileUploadHosts: [
            { host: '[data-test="apply-with-resume-container"]', once: true },
        ],
        // Consent + Submit are intentionally absent → the user reviews, ticks the
        // consent box, and submits. `submitSelector` documented for reference only.
        submitSelector: '[data-test="footer-submit"]',
        thirdPartySkip: ['indeed', 'linkedin'],
    },
];

/**
 * How an open dropdown's choices are marked up — and it is NOT one thing.
 *
 * 3M tags each choice `data-automation-id="promptOption"`. Mondelez (measured on
 * wd3.myworkdaysite.com/recruiting/mdlz) tags none of them: the popup is a plain
 * [role="listbox"] of [role="option"] rows carrying only opaque ids. Matching
 * promptOption alone found zero options there — on a listbox that had opened
 * correctly — so every custom-select on that tenant failed as "listbox-timeout".
 */
const OPTION_SEL = '[data-automation-id="promptOption"], [role="option"]';

let _recipes = null; // in-memory cache for this page's lifetime
// Résumé-upload targets we've already sent the CV to THIS page load. Guards the
// SmartRecruiters "apply-with-resume" parser dropzone (hidefilelist → its file
// input clears after parsing, so an idempotency-by-files check would re-upload +
// re-parse every iteration). Resets on navigation (module re-injected).
const _fileUploadedHosts = new Set();

/**
 * Load the recipe list: background-fetched (cached in storage) if available,
 * otherwise the bundled fallback. Cached in-module so we only ask once per page.
 */
export async function loadRecipes() {
    if (_recipes) return _recipes;
    let fetched = [];
    try {
        const resp = await chrome.runtime.sendMessage({ type: 'GET_APPLY_RECIPES' });
        if (resp?.success && Array.isArray(resp.data?.recipes)) fetched = resp.data.recipes;
    } catch (e) {
        console.warn('[Copo Recipe] fetch failed, bundled fallback only:', e?.message);
    }
    // Merge web-app recipes over the bundled FALLBACK by `ats`. The bundle is the
    // FLOOR — a newly-shipped recipe (e.g. SmartRecruiters) works IMMEDIATELY, even
    // before the web app redeploys /api/apply-recipes (which currently still serves
    // only the older set). A fetched recipe with the same `ats` OVERRIDES the bundled
    // one, so a live selector can still be hotfixed via a Vercel deploy.
    // A fetched recipe wins only when it is at least as NEW as the bundled one.
    // The hotfix direction (Vercel deploy ships a corrected selector before the
    // Web Store review lands) is the point of the merge; the reverse — a web app
    // that hasn't redeployed yet silently DOWNGRADING a recipe the extension just
    // shipped — is a release-skew bug waiting for the next version bump.
    const byAts = new Map(FALLBACK_RECIPES.map(r => [r.ats, r]));
    for (const r of fetched) {
        if (!r?.ats) continue;
        const bundled = byAts.get(r.ats);
        const remoteV = Number(r.version) || 0;
        const bundledV = Number(bundled?.version) || 0;
        if (bundled && remoteV < bundledV) {
            console.warn(`[Copo Recipe] ignoring remote ${r.ats} v${remoteV} — bundled v${bundledV} is newer`);
            continue;
        }
        byAts.set(r.ats, r);
    }
    _recipes = [...byAts.values()];
    console.log(`[Copo Recipe] ${_recipes.length} recipe(s) [${_recipes.map(r => r.ats).join(', ')}] — ${fetched.length} from web app + ${FALLBACK_RECIPES.length} bundled`);
    return _recipes;
}

/**
 * Click through a non-form gateway (the "Start Your Application" modal, an
 * interstitial "Continue" screen…) that the agent must pass to reach the form.
 * Clicks at most one per call and records it in `clickedCounts` so a gateway that
 * doesn't dismiss can't loop forever (capped at 2). Returns { clicked, label }.
 */
export function clickRecipeGateway(recipe, hasCV, clickedCounts) {
    for (const g of recipe?.gateways || []) {
        if (g.needsCV && !hasCV) continue;
        if ((clickedCounts.get(g.label) || 0) >= 2) continue; // don't loop on a stuck gateway
        let target = null;
        // A text-matched CTA (SmartRecruiters "I'm interested" is a styled <a>/<button>
        // with no stable id/class) — match its visible text, skipping third-party
        // shortcuts and a denylist ("Refer a friend" sits right next to it).
        if (g.text) target = findClickableByText(g.text, g.textDeny);
        // Fallback / alternative: an exact CSS selector (Workday's autofill modal).
        if (!target && g.detect) {
            let el;
            try { el = document.querySelector(g.detect); } catch { el = null; }
            if (el && el.offsetParent !== null) target = g.click ? document.querySelector(g.click) : el;
        }
        if (!target || target.offsetParent === null) continue;
        // Workday's modal buttons sit under a click_filter overlay. A gateway is
        // pre-form by definition (it exists to REACH the form), so apply-verb
        // wording here is an opener, not a submit.
        if (!safeActivate(target, {
            source: 'gateway', openingApplication: true,
            submitSelector: recipe?.submitSelector,
        }, g.detect)) continue;
        clickedCounts.set(g.label, (clickedCounts.get(g.label) || 0) + 1);
        console.log(`[Copo Recipe] gateway: clicked "${g.label}"`);
        return { clicked: true, label: g.label };
    }
    return { clicked: false };
}

/** Normalize for text matching: lowercase, fold smart apostrophes to a straight
 *  one (SR renders "I'm" with a curly ’), collapse whitespace. */
function _normText(s) {
    return (s || '').toLowerCase().replace(/[‘’ʼ`´]/g, "'").replace(/\s+/g, ' ').trim();
}

/** First visible clickable whose short label contains one of `wants`, excluding
 *  third-party "Apply with …" shortcuts and any label containing a `denies` term
 *  ("refer a friend"). Used for text-only CTAs the CSS-selector gateway can't name. */
function findClickableByText(wants, denies) {
    const want = (Array.isArray(wants) ? wants : [wants]).map(_normText).filter(Boolean);
    const deny = (denies || []).map(_normText);
    for (const el of document.querySelectorAll('button, a, [role="button"], input[type="submit"]')) {
        if (el.offsetParent === null) continue;
        if (isThirdPartyApply(el)) continue;
        const t = _normText(el.textContent || el.value || '');
        if (!t || t.length > 40) continue;
        if (deny.some(d => d && t.includes(d))) continue;
        if (want.some(w => t.includes(w))) return el;
    }
    return null;
}

/** True if the ATS's final review/submit step is on screen — the agent must
 * stop here and let the user submit (never auto-submit an application). */
export function atFinalStep(recipe) {
    if (!recipe?.finalStepSelector) return false;
    try { return !!document.querySelector(recipe.finalStepSelector); } catch { return false; }
}

/** The recipe whose hostPattern matches `url`'s host, or null. */
export function recipeForUrl(recipes, url) {
    if (!Array.isArray(recipes) || !recipes.length) return null;
    let host = '';
    try { host = new URL(url).host.toLowerCase(); } catch { host = String(url || '').toLowerCase(); }
    return recipes.find(r => {
        try { return new RegExp(r.hostPattern, 'i').test(host); } catch { return false; }
    }) || null;
}

/**
 * Deterministically fill the recipe fields for whichever step is on screen.
 *
 * - Idempotent: skips inputs that already hold a value, so it can run every
 *   iteration and naturally goes quiet once the step is filled (returns 0).
 * - Fills TEXT inputs AND Workday's custom dropdowns (button→listbox) — the
 *   required-but-arbitrary ones (Country, "How did you hear", Postal Code) were
 *   the source of the flaky My-Information step when left to the LLM.
 * - NEVER touches a password field and NEVER clicks the final submit; it does
 *   not advance the wizard (the planner owns navigation).
 * - Opportunistically uploads the CV if the step exposes the recipe's file input.
 *
 * @returns {{matched:boolean, filled:number, step?:string}}
 */
export async function applyRecipeFields(recipe, profile, cvData, cv) {
    if (!recipe || !profile) return { matched: false, filled: 0 };

    let filled = 0;
    let uploadedParser = false;   // did we upload the CV to a résumé-PARSER this pass?

    // Opportunistic CV upload — BEFORE the step check, so it runs on ANY page that
    // renders the recipe's file input, even one with no text-field step. Workday's
    // "Autofill with Resume" page (applyFlowAutoFillPage) has the file input
    // (file-upload-input-ref) but no text step; uploading here lets Workday parse
    // the résumé and pre-fill the later sections. Idempotent: skips an input that
    // already holds a file, so it's safe to re-run every iteration.
    if (cvData?.base64 && cvData?.fileName) {
        // Résumé upload targets, in priority order. SmartRecruiters has TWO
        // dropzones: the top "Easy Apply" one (apply-with-resume-container) makes SR
        // PARSE the CV to auto-fill name/experience/education AND propagates it to the
        // required "Résumé"/"Sơ yếu lý lịch" field (resume-upload) — so ONE upload to
        // the parser is normally enough. We upload to the parser first (ONCE — it
        // hides its file list + re-parses on every set) and then BREAK, giving SR a
        // full iteration to propagate before we look at the required field next pass;
        // the required-field upload is a FALLBACK that only fires if SR didn't
        // propagate (idempotent: skipped when the field already holds a file). Each
        // dropzone keeps its <input type=file> in a SHADOW root — the only light-DOM
        // file input is the avatar picker — so resolve the host then deep-query.
        const targets = recipe.fileUploadHosts
            ? recipe.fileUploadHosts
            : recipe.fileUploadHost ? [{ host: recipe.fileUploadHost }]
            : recipe.fileUploadSelector ? [{ selector: recipe.fileUploadSelector }]
            : [];
        for (const t of targets) {
            const key = t.host || t.selector;
            if (t.once && _fileUploadedHosts.has(key)) continue;
            let host = null, fileEl = null;
            if (t.host) {
                host = document.querySelector(t.host);
                fileEl = host ? deepQuery('input[type="file"]', host) : null;
            } else if (t.selector) {
                fileEl = document.querySelector(t.selector) || deepQuery(t.selector);
            }
            const already = !!(fileEl && fileEl.files && fileEl.files.length);
            // Diagnostic — if the CV still doesn't attach, this tells us exactly why:
            // shadow open vs closed (a closed shadow root is unreachable → we can't
            // set the <input>), and how many inputs of any type are reachable.
            const _sh = host ? (host.shadowRoot ? host.shadowRoot.mode : 'none/closed') : '-';
            const _anyInputs = host ? deepQueryAll('input', host).length : 0;
            console.log(`[Copo Recipe] upload "${key}": host=${!!host} shadow=${_sh} fileInput=${!!fileEl} anyInputs=${_anyInputs} hasFile=${already}`);
            if (already) { if (t.once) _fileUploadedHosts.add(key); continue; }
            let ok = false;
            if (t.via === 'drop') {
                // Deliver the file via a synthetic drag-and-drop. A dropzone often runs
                // its FULL résumé parser (and auto-saves the parsed entries) on the
                // 'drop' handler, which — unlike an <input> 'change' — may not be gated
                // on isTrusted, so this can match a real manual drag-drop.
                if (host) { try { ok = dropFileOnZone(host, cvData.base64, cvData.fileName); if (ok) console.log(`[Copo Recipe] upload "${key}": via drag-drop`); } catch { /* best effort */ } }
            } else {
                if (fileEl && fileEl.type === 'file') {
                    try { ok = setFileOnInput(fileEl, cvData.base64, cvData.fileName); } catch { /* best effort */ }
                }
                // Fallback: a dropzone whose <input> we can't reach (lazy / shadow-hidden).
                if (!ok && host) {
                    try { if (dropFileOnZone(host, cvData.base64, cvData.fileName)) { ok = true; console.log(`[Copo Recipe] upload "${key}": used drop fallback`); } } catch { /* best effort */ }
                }
            }
            if (ok) {
                filled++;
                if (t.once) {
                    _fileUploadedHosts.add(key);
                    uploadedParser = true;
                    break;
                }
            }
        }
    }

    // Just uploaded the CV to SR's résumé PARSER → STOP this pass and let it finish.
    // SmartRecruiters parses the résumé and populates the WHOLE form (personal info +
    // Experience + Education). If we start filling/typing fields WHILE it parses, SR
    // treats the form as user-edited and DISCARDS the parse → the auto-filled
    // Experience/Education vanish ("AI xóa field"). So return now; the loop waits, and
    // the next pass fills only whatever the parser left empty.
    if (uploadedParser) return { matched: true, filled, step: 'résumé-parse', uploadedParser: true };

    const step = (recipe.steps || []).find(s => s.detect && document.querySelector(s.detect));
    if (!step) return { matched: filled > 0, filled };  // e.g. the autofill upload page: uploaded, no text step

    // Fields are filled in array order (Country BEFORE Province — picking Country
    // re-renders the region field). Custom-selects re-query fresh each pass, so a
    // field that isn't rendered yet is simply retried next iteration.
    const outcomes = [];   // [label, status, note] per field → debug summary below
    // Provenance for the review hand-off: which answers came from the user's own
    // data, and which are values the agent chose to get the step to validate. The
    // user is going to check the application on the review page, and "these four
    // are ours, not yours" is the difference between a review they can do in a
    // minute and one they have to do field by field.
    const answers = [];
    for (const f of step.fields || []) {
        const val = recipeFieldValue(f, profile, cv);
        const hasLadder = Array.isArray(f.valuePriority) && f.valuePriority.length > 0;
        if ((val == null || String(val).trim() === '') && !hasLadder) { outcomes.push([f.label, 'skip', 'no value']); continue; }
        // A fixed `value`/`default` the profile did not supply is the agent's own
        // choice; anything resolved from the profile is the user's.
        const provenance = f.answerSource
            || (f.profileKey && profile[f.profileKey] ? 'PROFILE' : 'AGENT_DEFAULT');
        try {
            if (f.type === 'custom-select') {
                const r = await fillCustomSelect(f, val);
                if (r.ok) {
                    filled++;
                    outcomes.push([f.label, 'OK', String(r.matched || val)]);
                    // `matched` is the ladder rung that landed — when it is not the
                    // profile's own value, the answer is an agent default whatever
                    // the field declared.
                    // `r.matched` is already lower-cased by the option matcher,
                    // so comparing it to a raw profile value ("Vietnam",
                    // "Bachelor") always failed and mislabelled the user's OWN
                    // answers as agent defaults. Normalise both sides.
                    const nrm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
                    const fromProfile = provenance === 'PROFILE' && nrm(r.matched) === nrm(val);
                    answers.push({ field: f.label, value: r.matched || val, source: fromProfile ? 'PROFILE' : 'AGENT_DEFAULT' });
                }
                else if (r.reason === 'already-selected') outcomes.push([f.label, 'done', 'already selected']);
                else if (r.reason === 'button-absent') outcomes.push([f.label, 'absent', 'not rendered yet']);
                else outcomes.push([f.label, 'FAIL', r.reason]);
            } else if (f.type === 'autocomplete') {
                // Type-to-search field (SmartRecruiters city) → type then pick a match.
                const r = await fillAutocomplete(f, val);
                if (r.ok) { filled++; outcomes.push([f.label, 'OK', String(val)]); answers.push({ field: f.label, value: val, source: provenance }); }
                else if (r.reason === 'already-selected') outcomes.push([f.label, 'done', 'already filled']);
                else if (r.reason === 'host-absent' || r.reason === 'input-absent') outcomes.push([f.label, 'absent', 'not rendered yet']);
                else outcomes.push([f.label, 'FAIL', r.reason]);
            } else if (f.type === 'shadow-text') {
                // Text control living inside a web-component's shadow root: resolve
                // the light-DOM host by data-test, then deep-find the input inside.
                // (Don't gate on host.getClientRects() — some spl-* hosts are
                // display:contents and have no box even though their input is visible.)
                const host = document.querySelector(f.selector);
                if (!host) { outcomes.push([f.label, 'absent', 'host not found']); continue; }
                const el = deepFindControl(host, f.control);
                if (!el) { outcomes.push([f.label, 'absent', 'no control in shadow']); continue; }
                if (el.type === 'password') { outcomes.push([f.label, 'skip', 'password']); continue; }   // never
                if (String(el.value ?? '').trim() !== '') { outcomes.push([f.label, 'done', 'already filled']); continue; }  // idempotent
                setNativeValue(el, String(val));
                await sleep(120);
                if (String(el.value ?? '').trim() !== '') { filled++; outcomes.push([f.label, 'OK', String(val)]); answers.push({ field: f.label, value: val, source: provenance }); }
                else outcomes.push([f.label, 'FAIL', 'value did not stick']);
            } else {
                const el = f.labelMatch ? findFieldByLabel(f.labelMatch) : document.querySelector(f.selector);
                if (!el || el.offsetParent === null) { outcomes.push([f.label, 'absent', 'not rendered yet']); continue; }
                if (el.type === 'password') { outcomes.push([f.label, 'skip', 'password']); continue; }   // never
                if (String(el.value ?? '').trim() !== '') { outcomes.push([f.label, 'done', 'already filled']); continue; }  // idempotent
                setNativeValue(el, String(val));
                await sleep(120);
                if (String(el.value ?? '').trim() !== '') { filled++; outcomes.push([f.label, 'OK', String(val)]); answers.push({ field: f.label, value: val, source: provenance }); }
                else outcomes.push([f.label, 'FAIL', 'value did not stick']);
            }
        } catch (e) { outcomes.push([f.label, 'FAIL', (e && e.message) || 'exception']); }
        await sleep(120);
    }

    // Per-field debug log — only on passes where something was filled or failed
    // (the recipe re-runs every iteration; skip the idempotent all-"done" passes).
    const failed = outcomes.filter(([, s]) => s === 'FAIL');
    // Always log the per-field verdict while debugging — shows OK/done/absent/skip/
    // FAIL for every recipe field each pass (why filled=0 etc.).
    console.log(`[Copo Recipe] "${step.name}" fields →`, outcomes.map(([l, s]) => `${l}:${s}`).join('  ·  '));
    if (failed.length) {
        console.warn(`[Copo Recipe] ✗ FAILED (${step.name}):`,
            failed.map(([l, , why]) => `${l} — ${why}`).join('  |  '));
    }

    return { matched: true, filled, step: step.name, answers };
}

/**
 * Read a dotted/indexed path out of the structured CV — `education[0].institution`,
 * `languages[0].level`, `experience[1].company`.
 *
 * The flat 23-field profile cannot express any of those. It has one
 * `highestDegree` string where Workday's My Experience step asks for the school,
 * the qualification, the subject, the grade and a language proficiency — each a
 * separate REQUIRED field, and each blank after Workday's own résumé parse
 * (measured on a live Mondelez application). Widening the flat profile one key at
 * a time does not fix that: the next tenant asks for a SECOND education entry, or
 * three employment rows, and there is no flat key for those either.
 *
 * The structured CV was already synced to the extension for Mode-1 tailoring
 * (`jobfitCv`); it was simply never read by the apply agent.
 */
function readCvPath(cv, path) {
    if (!cv || !path) return undefined;
    let node = cv;
    for (const part of String(path).split('.')) {
        const m = part.match(/^([^[\]]+)(?:\[(\d+)\])?$/);
        if (!m || node == null) return undefined;
        node = node[m[1]];
        if (m[2] != null) node = Array.isArray(node) ? node[Number(m[2])] : undefined;
    }
    return node;
}

/**
 * Resolve a field's value, best source first:
 *   1. an explicit fixed `value` (Postal code, phone type)
 *   2. the flat profile key — the fast path for the standard identity fields
 *   3. a `cvPath` into the structured CV, for everything the flat shape cannot hold
 *   4. the recipe `default`
 */
function recipeFieldValue(f, profile, cv) {
    if (f.value != null && f.value !== '') return f.value;
    const p = profile?.[f.profileKey];
    if (p != null && String(p).trim() !== '') return p;
    const fromCv = readCvPath(cv, f.cvPath);
    if (fromCv != null && String(fromCv).trim() !== '') return String(fromCv);
    return f.default ?? '';
}

/** Resolve a dynamic-id field (e.g. Workday Application Questions, whose formField
 *  ids are per-job) by matching its question/label text. Returns the textarea /
 *  input / button inside the first matching formField wrapper. */
function findFieldByLabel(labelMatch) {
    const want = String(labelMatch).toLowerCase();
    for (const wrap of document.querySelectorAll('[data-automation-id^="formField-"]')) {
        const lbl = (wrap.querySelector('legend, label')?.textContent || '').toLowerCase();
        if (lbl.includes(want)) return wrap.querySelector('textarea, input:not([type="hidden"]), button');
    }
    return null;
}

/**
 * Fill one Workday custom dropdown (button→listbox) deterministically.
 * Idempotent: Workday stores the chosen option's id in the button's `value`
 * attribute, so a non-empty value (incl. an "Autofill with Resume" pre-fill) is
 * skipped. Opens the listbox, type-filters when the field has a search input,
 * then picks by semantic priority (`f.valuePriority`) — never by position.
 * Leaves the popup CLOSED on a miss so it can't block the next field.
 *
 * Returns `{ok, reason, matched}` where `matched` is which rung of the ladder
 * actually landed, so the caller can record whether the answer came from the
 * profile or from an agent default.
 */
async function fillCustomSelect(f, value) {
    const trigger = document.querySelector(f.selector);
    if (!trigger || trigger.offsetParent === null) return { ok: false, reason: 'trigger-absent' };
    const wrap = trigger.closest('[data-automation-id^="formField-"]');
    // Idempotency. Three shapes, all seen in the wild:
    //   · a button-select stores the chosen option's id in the button's `value`
    //   · a multi-select lists its picks as chips in selectedItemList
    //   · a SEARCHABLE single-select (Mondelez's source/phone-code prompt) is an
    //     <input>, whose `value` attribute stays empty after a pick — its answer
    //     also lands in selectedItemList
    // Checking chips regardless of `f.multi` is what stops the search-box shape
    // from being re-answered on every pass.
    const chips = wrap?.querySelector('[data-automation-id="selectedItemList"]');
    if (chips && chips.children.length) return { ok: false, reason: 'already-selected' };
    if (!f.multi && (trigger.getAttribute('value') || '').trim()) {
        return { ok: false, reason: 'already-selected' };
    }
    // `widget: true` — opening this listbox and picking from it are steps INSIDE
    // one approved field fill, so they are judged as values, not as page actions.
    if (!safeActivate(trigger, { source: 'recipe', activation: 'widget-open' }, f.selector)) {
        return { ok: false, reason: 'policy-denied' };
    }
    // Scope the option list. Workday reuses `promptOption` for the SELECTED
    // CHIPS as well as for the popup's choices — measured on Mondelez, where the
    // committed "Vietnam (+84)" sits inside countryPhoneCode's selectedItemList
    // carrying that exact automation id. A global query therefore sees other
    // fields' answers as candidates, and clicking a chip DESELECTS it: filling
    // one field could silently erase another's. It also made the
    // waitForElement() guard below pass instantly on a page where no listbox had
    // opened at all.
    const visibleOptions = () => [...document.querySelectorAll(OPTION_SEL)]
        .filter(o => o.offsetParent !== null)
        // A committed chip is also role=option / promptOption. Clicking one
        // DESELECTS it, so leaving them in the candidate pool meant filling one
        // field could silently erase another field's answer.
        .filter(o => o.getAttribute('data-automation-id') !== 'selectedItem')
        .filter(o => !o.closest('[data-automation-id="selectedItemList"]'))
        // The placeholder row is a real option element; picking it answers nothing.
        .filter(o => o.id !== 'select-one' && (o.textContent || '').trim().toLowerCase() !== 'select one')
        .filter(o => {
            const owner = o.closest('[data-automation-id^="formField-"]');
            return !owner || owner === wrap;   // never another field's committed answer
        });

    // Wait for OUR listbox, not for any promptOption anywhere on the page.
    {
        const deadline = Date.now() + 4000;
        while (!visibleOptions().length && Date.now() < deadline) await sleep(150);
        if (!visibleOptions().length) return { ok: false, reason: 'listbox-timeout' };
    }
    await sleep(150);
    const want = String(value || '').trim().toLowerCase();
    // Type-to-filter: the trigger itself when it's an input (Mondelez renders the
    // source and phone-code prompts as a search box, placeholder "Search"), else a
    // search input beside the button (long lists like Country on 3M).
    const filter = (trigger.tagName === 'INPUT' ? trigger : null) || wrap?.querySelector('input[type="text"]');
    const txt = (o) => (o.textContent || '').trim().toLowerCase();

    // The candidates, best first: the resolved value, then each rung of the
    // field's semantic ladder. Exact match beats a substring match at every rung,
    // so "Website" never wins over "Company Website" just by appearing earlier.
    //
    // There is NO "pick the first option" fallback. These dropdowns answer
    // questions ABOUT the candidate — how they found the job, what degree they
    // hold — and the first option in an unmatched list is an arbitrary claim sent
    // to a real employer ("Employee referral", "Doctorate"). Leaving the field
    // empty is recoverable; a wrong answer on a submitted application is not.
    const ladder = [want, ...(f.valuePriority || []).map(v => String(v).trim().toLowerCase())]
        .filter(Boolean);

    /**
     * A match only counts when it is UNAMBIGUOUS.
     *
     * Measured on Mondelez's Degree list: every option names a discipline
     * ("B.Arch - Bachelor of Architecture or equivalent", "B.B.A. - Bachelor of
     * Business Administration…") and there is no generic "Bachelor's Degree" at
     * all. A plain substring match on "Bachelor" hits ELEVEN of them and takes
     * the first — Architecture — which is a false credential claim on a real
     * application for someone who studied Marketing.
     *
     * So: exact wins; a prefix or substring match is accepted only when exactly
     * one option matches it. Anything else is ambiguous and answers nothing,
     * which the review then names.
     */
    const uniqueMatch = (list, wanted) => {
        const exact = list.filter(o => txt(o) === wanted);
        if (exact.length) return exact[0];
        const prefix = list.filter(o => txt(o).startsWith(wanted));
        if (prefix.length === 1) return prefix[0];
        const contains = list.filter(o => txt(o).includes(wanted));
        return contains.length === 1 ? contains[0] : null;
    };

    let opt = null;
    let matched = '';
    let shown = visibleOptions();
    if (filter) {
        // A SEARCH box shows nothing until something is typed, so each rung has to
        // be typed before it can be matched. Previously the ladder was only
        // compared against whatever happened to be on screen — which for a search
        // prompt is nothing at all, so a required field like "How Did You Hear
        // About Us?" could never be answered on tenants that render it this way.
        for (const wanted of ladder) {
            await simulateTyping(filter, wanted);
            await sleep(450);
            shown = visibleOptions();
            opt = uniqueMatch(shown, wanted);
            if (opt) { matched = wanted; break; }
        }
    } else {
        for (const wanted of ladder) {
            opt = uniqueMatch(shown, wanted);
            if (opt) { matched = wanted; break; }
        }
    }
    if (!opt) {
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); // close, don't block
        return {
            ok: false,
            reason: `option-not-found (${shown.length} shown${ladder.length ? `, tried ${ladder.length} candidate(s)` : ''})`,
        };
    }
    if (!safeActivate(opt, { source: 'recipe', activation: 'widget-option' }, f.selector)) {
        return { ok: false, reason: 'policy-denied' };
    }
    await sleep(250);
    // A MULTI-select stays OPEN after a pick (so you can add more) — and its popup
    // overlays the page footer, SWALLOWING the agent's later "Next" click, so the
    // step looks stuck even though the field is filled ("× Vietnam (+84)" is set but
    // the list is still open). Close it. (Single-selects already close on pick.)
    if (f.multi) {
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        try { trigger.blur?.(); } catch { /* noop */ }
        await sleep(150);
    }
    return { ok: true, matched };
}

/**
 * Fill a type-to-search autocomplete (SmartRecruiters city / place lookup).
 * SR renders the result dropdown in a CLOSED shadow root / portal we can't reach
 * with querySelector — so we DON'T try to click a suggestion node. Instead we type
 * (≥3 chars → async lookup), then drive the component's keyboard list-navigator:
 * ArrowDown highlights the first result, Enter commits it. Retried a few times
 * because the place API is slow. Keyboard-only is also safer than clicking a found
 * node — it can never mis-target an Experience/Education card. Idempotent: skips
 * when the input already holds text.
 */
async function fillAutocomplete(f, value) {
    // Don't gate on host.getClientRects() — spl-autocomplete can be display:contents
    // (no box) while its inner input is visible; that made Location read as absent.
    const host = document.querySelector(f.selector);
    if (!host) return { ok: false, reason: 'host-absent' };
    const input = deepFindControl(host, f.control);
    if (!input) return { ok: false, reason: 'input-absent' };
    if (String(input.value ?? '').trim() !== '') return { ok: false, reason: 'already-selected' };

    // Type char-by-char to trigger the async place lookup. No trailing blur (blur
    // closes the list before we can commit).
    input.focus();
    input.dispatchEvent(new Event('focus', { bubbles: true }));
    try { input.value = ''; } catch { /* readonly */ }
    for (const ch of String(value)) {
        input.value += ch;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, composed: true }));
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true, composed: true }));
        await sleep(45);
    }
    const typed = String(input.value ?? '').trim();

    // Keyboard commit: ArrowDown (highlight first result) → Enter (select). Full key
    // props for handlers that read keyCode/which. Retry — the async lookup can lag.
    const evt = (kind, k, code) => new KeyboardEvent(kind, { key: k, code: k, keyCode: code, which: code, bubbles: true, composed: true, cancelable: true });
    for (let attempt = 0; attempt < 3; attempt++) {
        await sleep(attempt === 0 ? 1700 : 900);   // wait for results (longer on the first pass)
        input.dispatchEvent(evt('keydown', 'ArrowDown', 40));
        input.dispatchEvent(evt('keyup', 'ArrowDown', 40));
        await sleep(280);
        input.dispatchEvent(evt('keydown', 'Enter', 13));
        input.dispatchEvent(evt('keyup', 'Enter', 13));
        await sleep(420);
        const now = String(input.value ?? '').trim();
        // Committed: selecting a place replaces the input with e.g. "Hanoi, Vietnam"
        // — it differs from what we typed and/or gains a comma.
        if (now && (now !== typed || now.includes(','))) {
            console.log(`[Copo Recipe] autocomplete "${f.label}": committed via keyboard → "${now.slice(0, 40)}"`);
            return { ok: true };
        }
    }
    console.log(`[Copo Recipe] autocomplete "${f.label}": keyboard nav did not commit (value="${String(input.value || '').slice(0, 30)}")`);
    return { ok: false, reason: 'keyboard-no-commit' };
}
