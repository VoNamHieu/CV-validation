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

import { FIELD_ERROR_SEL, deepFindControl, deepQuery, deepQueryAll, dropFileOnZone, normalizeNameCase, readFileCommitState, safeActivate, setFileOnInput, setNativeValue, simulateTyping, sleep, waitForElement } from './dom.js';
import { isThirdPartyApply } from './detect.js';
import { showToast } from './ui.js';
import { trace, traceOnce } from './trace.js';
import { callAgentPlan, callApplyMessage } from './llm.js';
import { isPickerShape, probeFieldShape } from './probe.js';

// Keep in sync with frontend/src/lib/applyRecipes.ts (WORKDAY). Fields verified
// against real 3M Workday captures (My Information, 2026-07-15 / -22). The
// custom-select handler is grounded in the captured widget markup (button[value]
// + promptOption) but PENDING a live-fill verification.
export const FALLBACK_RECIPES = [
    {
        ats: 'workday',
        label: 'Workday',
        version: 18,
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
                    // Honorific, REQUIRED on some tenants (PwC) — derived from
                    // the profile's own gender via prefixLadder; an empty
                    // gender leaves it a named gap, never a guess.
                    {
                        label: 'Prefix', labelMatch: 'prefix', profileKey: 'gender',
                        prefixLadder: true, type: 'custom-select', answerSource: 'PROFILE',
                    },
                    { label: 'First name', selector: '[data-automation-id="formField-legalName--firstName"] input', profileKey: 'firstName', type: 'text', required: true, normalize: 'name' },
                    { label: 'Last name', selector: '[data-automation-id="formField-legalName--lastName"] input', profileKey: 'lastName', type: 'text', required: true, normalize: 'name' },
                    // REQUIRED on Mondelez (measured), and the flat profile carries
                    // them only if the user filled them in by hand — a CV states an
                    // address but nothing extracts it into those two keys. When they
                    // were profile-only the planner hit two empty required fields
                    // and returned NEED_HUMAN, ending the run on data the CV was
                    // holding all along. Resolution is value → profileKey → cvPath,
                    // so a filled profile still wins.
                    // City-name fallback (user decision 2026-08-03): a CV that
                    // only says "Hà Nội" answers street/district with the city
                    // instead of stalling a required field.
                    { label: 'Address line 1', selector: '[data-automation-id="formField-addressLine1"] input', profileKey: 'addressStreet', cvPath: 'contact.address_street', fallbackProfileKey: 'addressProvince', type: 'text', required: true },
                    { label: 'District or Town', selector: '[data-automation-id="formField-city"] input', profileKey: 'addressDistrict', cvPath: 'contact.address_district', fallbackProfileKey: 'addressProvince', type: 'text', required: true },
                    // Required text input; a résumé never carries it, so autofill leaves
                    // it blank and the step's Next validation blocks. Default to the VN
                    // generic postal code.
                    // 5 DIGITS, not the legacy 6 ("100000"): Vietnam switched in
                    // 2018 (Hà Nội 10000, HCMC 70000) and Workday validates it —
                    // "Postal code must be 5 digits" outlived 24 iterations of
                    // this very field refilling its own hard-coded legacy value.
                    { label: 'Postal Code', selector: '[data-automation-id="formField-postalCode"] input', value: '10000', type: 'text', required: true },
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
                        selector: '[data-automation-id="formField-source"] input, [data-automation-id="formField-source"] button, [data-automation-id="formField-source"] select',
                        valuePriority: [
                            'Company Website', 'Company Careers Website', 'Employer Website',
                            'Careers Website', 'Career Site', 'Careers Page', 'Career Page', 'Company Webpage', 'Website', 'Webpage',
                            // Final rung by user decision (2026-08-03, hit on P&G where
                            // the catalogue has no company-website entry at all):
                            // "Other" is a truthful neutral claim, better than a
                            // stranded required field. '=' anchors the match — a plain
                            // substring tier would resolve "other" to "Another job
                            // board" via the letters inside "another".
                            '=Other', '=Khác',
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
                    // REQUIRED on Mondelez and matched by nothing here — the recipe
                    // filled the other eleven required fields and left this one, so
                    // the step never validated and never advanced. "No" is not a
                    // guess: it is the deterministic Answer Policy rule for
                    // previous_employment, and a candidate who HAD worked there
                    // would be applying from an internal site.
                    { label: 'Previously worked here', selector: '[data-automation-id="formField-candidateIsPreviousWorker"]', value: 'No', type: 'radio', required: true, answerSource: 'AGENT_DEFAULT' },
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
                // Work Experience starts EMPTY on some jobs — measured: the section
                // shows an Add button and no fields at all, while the same step on
                // another job of the same company had them, because Workday's
                // résumé parse created a row there. Mondelez varies the form per
                // job, so the recipe cannot assume either shape.
                ensureSections: ['Work Experience'],
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
                        // Vietnamese qualifications do not appear on this list at
                        // all — a CV says "Cử nhân Marketing" and the dropdown
                        // offers B.S. / B.B.A. / L.L.B. No string rule bridges
                        // that, so when nothing matches the model is asked to pick
                        // from the options actually on screen, given the education.
                        type: 'custom-select', required: true, accept: 'qualification', infer: true,
                    },
                    // Measured as REQUIRED on Mondelez, and left blank by Workday's
                    // own résumé parse — so the step could not advance without them
                    // even though the CV states both.
                    // The Work Experience block — REQUIRED on Mondelez and matched by
                    // nothing here, so five required fields sat empty and the
                    // planner reported the dates as "not in the user profile" when
                    // the CV held all of them. Matched by LABEL rather than by
                    // automation id: the labels are the part measured verbatim from
                    // a real run, and guessing ids is how earlier fixes failed.
                    { label: 'Job Title', selector: '[data-automation-id="formField-jobTitle"] input', cvPath: 'experience[0].title', type: 'text', required: true },
                    { label: 'Company', selector: '[data-automation-id="formField-companyName"] input', cvPath: 'experience[0].company', type: 'text', required: true },
                    { label: 'Role description', selector: '[data-automation-id="formField-roleDescription"] textarea', cvPath: 'experience[0].description', type: 'text' },
                    // startDate/endDate hold TWO inputs — dateSectionMonth-input and
                    // dateSectionYear-input — so the wrapper is the selector and the
                    // date filler finds both. A single fill enters half a date and
                    // leaves the step invalid.
                    { label: 'Work From', selector: '[data-automation-id="formField-startDate"]', cvPath: 'experience[0].start_date', type: 'date', required: true },
                    { label: 'Work To', selector: '[data-automation-id="formField-endDate"]', cvPath: 'experience[0].end_date', type: 'date' },
                    // `labelMatch` beside the selector = per-tenant id drift
                    // (measured: mdlz names it formField-schoolName, Visa does
                    // not — the field sat "absent" while the form demanded it).
                    // The selector is tried first, the label is the fallback.
                    { label: 'School or University', selector: '[data-automation-id="formField-schoolName"] input', labelMatch: 'school or university', cvPath: 'education[0].institution', type: 'text', required: true },
                    { label: 'Field of Study', selector: '[data-automation-id="formField-fieldOfStudy"] input', labelMatch: 'field of study', cvPath: 'education[0].degree', type: 'text', required: true },
                    // "Overall Result (GPA)" — REQUIRED on some Mondelez postings.
                    // Only the profile may answer (grade rule: a plausible-looking
                    // number is a fabricated academic record); empty profile →
                    // named gap, never invented.
                    { label: 'GPA', labelMatch: 'overall result', profileKey: 'gpa', type: 'text', required: true },
                    // The Languages block. Measured on Mondelez: Language and
                    // "Overall" (proficiency) are both REQUIRED, and "Overall" has
                    // a per-tenant GUID for an automation id — hence labelMatch.
                    // "Fluent" resolves to "3 - Fluent" through the unambiguous
                    // substring rule; no ladder needed, and no fallback invented
                    // if the CV states no level.
                    { label: 'Language', selector: '[data-automation-id="formField-language"] button', cvPath: 'languages[0].language', type: 'custom-select', required: true },
                    {
                        // Measured: the list is "1 - Beginner / 2 - Intermediate /
                        // 3 - Fluent" — there is NO "Native" row, and a CV that says
                        // Native (a first language) found nothing and blocked the
                        // step. The ladder maps down to the highest rung the form
                        // actually offers. That is not an overclaim in either
                        // direction: a native speaker IS fluent, and nothing higher
                        // exists to claim.
                        label: 'Language level', labelMatch: 'overall', cvPath: 'languages[0].level',
                        // NOT the "Overall Result (GPA)" text box — measured on
                        // Marketing Intern, where 'overall' matched it first in
                        // DOM order and the proficiency fill spent its whole
                        // listbox timeout clicking a text input.
                        labelDeny: 'overall result|gpa',
                        // Sliced DOWN from the candidate's own level at fill
                        // time — a static Native-first list overclaimed for
                        // anyone below Native when their exact rung was absent.
                        levelLadder: true,
                        type: 'custom-select', required: true,
                    },
                    // Skills refuses free text: typing leaves the box empty and the
                    // value only exists once a SEARCH RESULT is clicked. Each skill
                    // is its own type → pick → confirm cycle.
                    // Measured id. The search runs on ENTER, not on typing: without
                    // it the list says "No Items." for every term, which I first
                    // mistook for an empty taxonomy. A field that returns nothing
                    // for every term is still reported as a skip rather than a
                    // failure — the employer may genuinely have configured none.
                    { label: 'Skills', selector: '[data-automation-id="formField-skills"] input', profileKey: 'skills', type: 'search-multi', max: 8 },
                ],
                advance: '[data-automation-id="pageFooterNextButton"]',
            },
            {
                // Application Questions: every field here has a per-job dynamic id,
                // so all are matched by question text (labelMatch).
                name: 'Application Questions',
                detect: '[data-automation-id="applyFlowPrimaryQuestionsPage"]',
                fields: [
                    { label: 'Notice period', labelMatch: 'notice period', value: '30 days', type: 'text' },
                    { label: 'Salary expectations', labelMatch: 'salary', profileKey: 'desiredSalary', default: 'Negotiable', type: 'text' },
                    // The three screening dropdowns Mondelez asks on every job
                    // (measured on R-173278; labelMatch phrasings verbatim from the
                    // page). All three are AGENT_DEFAULT answers ABOUT the candidate,
                    // so they surface in the review list before the user submits —
                    // the agent itself never submits.
                    //   · conflict-of-interest / relatives-at-company: "No" is the
                    //     overwhelmingly-true default; a user for whom it is false
                    //     corrects it at review.
                    //   · visa sponsorship: "No" is correct for the home-market case
                    //     (VN candidate, VN-located job — the only market served
                    //     today). REVISIT before targeting abroad jobs: there this
                    //     default would falsely waive a sponsorship need.
                    { label: 'Conflict of interest', labelMatch: 'conflict of interest', value: 'No', type: 'custom-select', required: true, answerSource: 'AGENT_DEFAULT' },
                    { label: 'Relatives at company', labelMatch: 'relatives currently employed', value: 'No', type: 'custom-select', required: true, answerSource: 'AGENT_DEFAULT' },
                    { label: 'Visa sponsorship', labelMatch: 'sponsor a work visa', value: 'No', type: 'custom-select', required: true, answerSource: 'AGENT_DEFAULT' },
                ],
                advance: '[data-automation-id="pageFooterNextButton"]',
            },
            {
                // Voluntary Disclosures — measured on Mondelez R-173278
                // (2026-08-02): two demographic prompts and the terms-consent
                // checkbox. This page had NO step at all, so it always fell to
                // the planner ("no recipe step matches this page").
                name: 'Voluntary Disclosures',
                detect: '[data-automation-id="applyFlowVoluntaryDisclosuresPage"]',
                fields: [
                    // Demographics: declining is the only answer that states
                    // nothing about the person. Tenants word the decline row
                    // however they like — measured: "Not Specified" (Mondelez:
                    // Female/Male/Not Specified/Other), "Not Declared" (Visa:
                    // Female/Male/Not Declared); the longer rungs cover the
                    // US-styled phrasings.
                    {
                        label: 'Gender',
                        selector: '[data-automation-id="formField-gender"] button',
                        // The candidate's own stated gender FIRST (genderLadder
                        // prepends it — user decision 2026-08-04: tenants ask
                        // it as an administrative fact and Prefix derives from
                        // it); the decline rungs remain the whole answer when
                        // the profile is silent.
                        profileKey: 'gender', genderLadder: true,
                        valuePriority: ['Not Specified', 'Not Declared', 'Undeclared', 'Prefer not to say', 'Decline to answer', 'I do not wish to answer', 'Decline to self-identify', 'Choose not to disclose', 'Not applicable'],
                        // When every rung misses, the MODEL identifies the decline
                        // row (the agent-plan prompt's rule 21 orders exactly that,
                        // never an actual demographic value) — and inferDeny is the
                        // structural belt: a substantive pick is refused here, so
                        // the model's worst mistake is an empty field, which is
                        // what a missing rung produced anyway (measured on Visa:
                        // "Not Declared" stalled two runs for a phrasing).
                        infer: true,
                        inferDeny: /^\s*(male|female|man|woman|nam|nữ|khác|other)\s*$/i,
                        type: 'custom-select', required: true, answerSource: 'AGENT_DEFAULT',
                    },
                    {
                        // The candidate's own ethnicity FIRST ("Kinh"): a VN
                        // tenant's list is the country's ethnic-group catalogue
                        // and carries none of the decline phrasings — those stay
                        // only as the fallback when the profile is silent.
                        label: 'Race/Ethnicity',
                        selector: '[data-automation-id="formField-ethnicity"] button',
                        profileKey: 'ethnicity',
                        valuePriority: ['Not Specified', 'Not Declared', 'Undeclared', 'Prefer not to say', 'Decline to answer', 'I do not wish to answer', 'Decline to self-identify', 'Choose not to disclose', 'Not applicable'],
                        // Same decline-detection fallback as Gender. The deny
                        // cannot enumerate every ethnicity, so it blocks the
                        // shapes a wrong pick would take on THESE catalogues:
                        // single ethnic names are already prevented by rule 21's
                        // decline-only instruction, and the profile's own value
                        // ("Kinh") was tried before the model ever spoke.
                        infer: true,
                        inferDeny: /^\s*(asian|white|black|hispanic|latino|kinh|hoa|tày|thái|mường|khmer|nùng|other)\s*$/i,
                        type: 'custom-select',
                    },
                    {
                        // The terms acknowledgement. User decision 2026-08-02:
                        // the agent ticks it — this product's one approval
                        // boundary is the SUBMIT button, which stays the
                        // user's; an acknowledgement gating the review page is
                        // answered exactly like its dropdown twin in
                        // ANSWER_RULES, and it lands in the review list the
                        // user reads before submitting. Marketing opt-ins stay
                        // denied at the policy layer as before.
                        label: 'Terms acknowledgement',
                        selector: '[data-automation-id="formField-acceptTermsAndAgreements"] input[type="checkbox"]',
                        value: 'Yes',
                        type: 'checkbox', required: true, answerSource: 'AGENT_DEFAULT',
                    },
                ],
                advance: '[data-automation-id="pageFooterNextButton"]',
            },
            {
                // Step 1 of the wizard, and it had no entry here at all — which is
                // why a run that logged in and uploaded the CV then sat on this page
                // until the stuck-detector killed it. The page carries NO form
                // fields (a dropzone and "Continue", nothing else), so the agent
                // took the "host matches but the form has not rendered yet" branch
                // and waited for a form that was never coming: no step matched, so
                // there was no `advance` selector to click, and the LLM is
                // deliberately not handed a fieldless page.
                //
                // LAST in the array on purpose. `steps.find()` takes the first
                // match, and Workday keeps the /apply/autofillWithResume URL for
                // the whole wizard — so if this page's container id outlives the
                // step it belongs to, the specific steps above must still win.
                name: 'Autofill with Resume',
                detect: '[data-automation-id="applyFlowAutoFillPage"]',
                fields: [],
                // Do not leave until the résumé is actually attached. Advancing
                // early skips the parse this step exists for, and the parse is what
                // fills My Information — measured: the file input is absent on the
                // first pass and appears on the second, so an unguarded advance
                // would sail past the upload on iteration 1.
                advanceWhen: '[data-automation-id="file-upload-item"], [data-automation-id="file-upload-successful"]',
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
        // v2: the Message box reads `applyMessage` (was `coverLetter`, which
        // falls back to the CV summary) and generates one when none was synced.
        // Bumped on BOTH sides deliberately: the merge takes the remote recipe
        // whenever remoteV >= bundledV, so leaving these equal would let a web
        // app that has not redeployed yet overwrite this with the old field.
        version: 2,
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
                    // Optional free-text note to the hiring team. Verified live on a
                    // Bosch posting (2026-08-01): <oc-textarea data-test=…> wraps an
                    // <spl-textarea> whose SHADOW root holds the real 10-row
                    // <textarea>; aria-required=false, no maxlength — so a ~150-word
                    // note fits the box without scrolling.
                    //
                    // Filled from `applyMessage`, the short per-job note the web app
                    // writes before dispatch. It used to read `coverLetter`, which
                    // falls back to the CV SUMMARY when no letter was generated — so
                    // an application whose owner never pressed "Tạo thư giới thiệu"
                    // sent a third-person paragraph about themselves to a box asking
                    // what they wanted to say. `generate` covers the other direction:
                    // an apply that never passed through the editor has no message to
                    // carry, and the agent writes one here instead.
                    { label: 'Message', selector: '[data-test="hiring-manager-message-text"], [data-test="hiring-manager-message-container"]', profileKey: 'applyMessage', type: 'shadow-text', generate: 'message' },
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
const OPTION_SEL = '[data-automation-id="promptOption"], [data-automation-id="promptLeafNode"], [role="option"]';

/** The element that actually scrolls a prompt's option list, if any. */
function optionScroller(opt) {
    // Prefer an ancestor that already overflows; fall back to the first ancestor
    // STYLED to scroll. A lazy list can read scrollHeight == clientHeight until
    // it is scrolled once, and returning null there froze the walk at window one
    // (measured: Mondelez's Language prompt — "Vietnamese" sat past the fold and
    // every pass reported option-not-found on a list that contained it).
    let styled = null;
    for (let p = opt?.parentElement; p && p !== document.body; p = p.parentElement) {
        if (p.scrollHeight > p.clientHeight + 20) return p;
        if (!styled) {
            const oy = getComputedStyle(p).overflowY;
            if (oy === 'auto' || oy === 'scroll') styled = p;
        }
    }
    return styled;
}

/**
 * Close any popup left open by a PREVIOUS field before opening this one's.
 *
 * Workday portals every prompt's option list to the document root — no
 * formField ancestor — so a leftover popup is indistinguishable from our own by
 * ownership. Measured on Mondelez: the proficiency field read the still-open
 * Language list as its own options (85 shown, none matched), and a stale skills
 * popup covered the Degree row it was trying to click (no-effect ×4). Escape is
 * how a user closes them, and it targets whatever currently has focus.
 */
async function closeStrayPopups(label) {
    const stray = () => [...document.querySelectorAll(OPTION_SEL)]
        .filter(o => o.offsetParent !== null)
        .filter(o => !o.closest('[data-automation-id="selectedItemList"]'));
    if (!stray().length) return;
    trace('list.strayPopup', { field: label, rows: stray().length });
    for (let round = 0; round < 2 && stray().length; round++) {
        const at = document.activeElement && document.activeElement !== document.body
            ? document.activeElement : document.body;
        for (const type of ['keydown', 'keyup']) {
            at.dispatchEvent(new KeyboardEvent(type, {
                key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
                bubbles: true, cancelable: true, composed: true,
            }));
        }
        const by = Date.now() + 800;
        while (stray().length && Date.now() < by) await sleep(120);
    }
}

/**
 * Make a virtualised list re-render around its current scrollTop.
 *
 * Measured on Mondelez's Field of Study (≈1000 majors, ~22 rows in the DOM at a
 * time): assigning scrollTop moves the scrollbar but leaves the SAME rows
 * rendered — 40 assignments in a row never got past "A". The rows only refreshed
 * once a scroll event reached the widget, and then they matched whatever
 * scrollTop already was. So: move, then tell it we moved.
 */
function nudgeScroll(sc) {
    try {
        sc.dispatchEvent(new Event('scroll', { bubbles: true }));
        sc.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true, cancelable: true }));
    } catch { /* a widget that ignores this is one we can already read */ }
}

/**
 * Page through a scrollable option list looking for a match.
 *
 * Without this the agent only ever saw the first rendered window, so any value
 * past the first ~20 rows read as "option-not-found" on a list that contained it.
 * Returns null when the whole list has been walked without an unambiguous match —
 * still no guessing.
 */
/** The rendered rows, de-duplicated — Workday emits each option twice. */
const renderedRows = (getShown) =>
    [...new Set(getShown().map(o => (o.textContent || '').trim()).filter(Boolean))];

/**
 * Wait for the rendered window to actually change after a scroll.
 *
 * Measured on Mondelez's Field of Study: one scroll step costs ~550ms, not the
 * 120ms the walk used to sleep — the container lazily loads more options as it
 * moves (its scrollHeight grows while you scroll it). Reading the rows too early
 * means comparing against the PREVIOUS window, which makes a bisect step decide
 * on stale evidence and walk the wrong way.
 */
async function settleAfterScroll(sc, getShown, beforeKey, budgetMs = 1600) {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
        await sleep(120);
        const now = renderedRows(getShown).join('|');
        if (now !== beforeKey) return now;
    }
    return renderedRows(getShown).join('|');
}

/**
 * The widget's own option array, read off the React fiber.
 *
 * Workday's prompt is a `react-virtualized` Grid (its inner element carries the
 * library's own `ReactVirtualized__Grid__innerScrollContainer` class), which means
 * the FULL ordered list lives in a prop while only ~22 rows exist in the DOM.
 * Measured on Field of Study: 327 entries, each `{label, ariaLabel, index, id,
 * isSelected}`, about ten fiber levels above the scroll container.
 *
 * That array is the whole game. With it, the option's row index is a lookup rather
 * than something to be discovered by scrolling — and since react-virtualized
 * positions row N at `top = N × rowHeight`, the index gives an exact scroll offset.
 * "Marketing" reads as index 200, i.e. scrollTop 6400: precisely the number found
 * by hand after four manual jumps.
 *
 * Returns null freely. This reads a minified library's internals, and it was
 * observed to come back empty moments after succeeding (React swaps to its
 * `alternate` tree on re-render, and a collapsing list has no rows at all), so
 * every caller must have a DOM path to fall back to.
 */
function readVirtualItems(sc) {
    try {
        const key = Object.keys(sc).find(k => /^__reactFiber\$|^__reactInternalInstance\$/.test(k));
        if (!key) return null;
        const looksLikeItems = (v) => Array.isArray(v) && v.length > 20 && v[0]
            && typeof v[0] === 'object' && 'label' in v[0] && 'index' in v[0];
        let f = sc[key];
        for (let d = 0; f && d < 30; d++, f = f.return) {
            for (const node of [f, f.alternate]) {
                if (!node) continue;
                for (const bag of [node.memoizedProps, node.memoizedState]) {
                    if (!bag || typeof bag !== 'object') continue;
                    for (const v of Object.values(bag)) if (looksLikeItems(v)) return v;
                }
            }
        }
    } catch { /* internals moved — the DOM path still works */ }
    return null;
}

/** Uniform row height, read from the absolute offsets react-virtualized writes. */
function virtualRowHeight(sc) {
    const inner = sc.firstElementChild;
    if (!inner) return 0;
    const tops = [...inner.children]
        .map(c => parseInt(c.style.top || '', 10))
        .filter(n => Number.isFinite(n))
        .sort((a, b) => a - b);
    for (let i = 1; i < tops.length; i++) if (tops[i] > tops[i - 1]) return tops[i] - tops[i - 1];
    return 0;
}

/**
 * Scroll straight to a known row index and hand back its option element.
 *
 * One scroll, no search. The alternative that this replaces walked the list in
 * ~40 steps at ~550ms each — about 22 seconds for a single field, against a 120s
 * watchdog for the whole job.
 */
async function jumpToIndex(sc, getShown, match, index, rowHeight, label) {
    const target = Math.max(0, index * rowHeight - Math.round(sc.clientHeight / 2) + rowHeight);
    const before = renderedRows(getShown).join('|');
    sc.scrollTop = target;
    nudgeScroll(sc);
    await settleAfterScroll(sc, getShown, before);
    const hit = match(getShown());
    trace('list.jump', {
        field: label, index, rowHeight, scrolledTo: target,
        landedOn: Math.round(sc.scrollTop), found: !!hit,
    });
    return hit;
}

async function findInList(getShown, match, label = '', wanted = '') {
    let opt = match(getShown());
    if (opt) return opt;
    const sc = optionScroller(getShown()[0]);
    if (!sc) {
        // No scrollable ancestor detected — let the browser do the scrolling.
        // scrollIntoView on the last rendered row moves whatever actually scrolls
        // (measured: Mondelez's Language list hid "Vietnamese" past the fold and
        // reported noScroller here, so the walk below never ran). Stop as soon as
        // a round brings in nothing new: the list is exhausted, not the budget.
        for (let round = 0; round < 12; round++) {
            const rows = getShown();
            if (!rows.length) break;
            const found = match(rows);
            if (found) return found;
            const beforeKey = renderedRows(getShown).join('|');
            try { rows[rows.length - 1].scrollIntoView({ block: 'end' }); } catch { break; }
            await sleep(300);
            if (renderedRows(getShown).join('|') === beforeKey) break;
        }
        const found = match(getShown());
        if (found) return found;
        trace('list.noScroller', { field: label, shown: getShown().length });
        return null;
    }

    // Ask the widget where the row is, rather than looking for it.
    //
    // An earlier version of this bisected on the rendered window's first and last
    // row, which is faster than walking but UNSOUND: the list is not sorted the way
    // localeCompare sorts it. Nine order breaks measured on this very list —
    // "African-American Studies" before "African Languages…", "Humanities" before
    // "Human Resources Management" — because Workday collates punctuation and
    // spaces differently. A bisect that trusts localeCompare walks the wrong way at
    // those points and reports a value that IS present as missing.
    const items = wanted ? readVirtualItems(sc) : null;
    const rowHeight = items ? virtualRowHeight(sc) : 0;
    if (items && rowHeight) {
        const want = String(wanted).trim().toLowerCase();
        const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
        const exact = items.filter(it => norm(it.label) === want || norm(it.ariaLabel) === want);
        const loose = items.filter(it => norm(it.label).includes(want));
        // Same unambiguity rule the DOM matcher uses: exact wins, and a substring
        // only counts when exactly one row carries it. "Marketing" must not resolve
        // by prefix to "Marketing Research" on a real application.
        const pick = exact[0] || (loose.length === 1 ? loose[0] : null);
        if (pick) {
            const at = Number.isFinite(pick.index) ? pick.index : items.indexOf(pick);
            opt = await jumpToIndex(sc, getShown, match, at, rowHeight, label);
            if (opt) return opt;
        } else {
            trace('list.jumpNoRow', {
                field: label, wanted, total: items.length,
                exact: exact.length, substring: loose.length,
                note: loose.length > 1 ? 'ambiguous — refusing to guess' : 'not in the widget list at all',
            });
            // The widget told us its entire contents and the value is not in them.
            // Walking the DOM cannot find what the source array does not hold.
            return null;
        }
    }

    const step = Math.max(40, sc.clientHeight * 0.8);
    const seen = new Set();
    const edge = (rows) => (rows.length ? `${rows[0]}…${rows[rows.length - 1]}` : '(empty)');
    let firstWindow = null;
    let lastWindow = null;
    let rounds = 0;
    for (let pos = 0; pos <= sc.scrollHeight; pos += step) {
        const before = renderedRows(getShown).join('|');
        sc.scrollTop = pos;
        nudgeScroll(sc);
        // Measured ~550ms per step, not 120ms — the container lazily loads as it
        // moves. A fixed short sleep read the PREVIOUS window and counted it as a
        // repeat, which is how a walk "exhausts" a list it never actually saw.
        await settleAfterScroll(sc, getShown, before);
        rounds++;
        const shown = getShown();
        const rows = shown.map(o => (o.textContent || '').trim());
        if (firstWindow === null) firstWindow = edge(rows);
        lastWindow = edge(rows);
        const key = rows.join('|');
        if (seen.has(key)) continue;   // same window re-rendered; already matched it
        seen.add(key);
        opt = match(shown);
        if (opt) {
            trace('list.found', { field: label, rounds, windows: seen.size, at: sc.scrollTop });
            return opt;
        }
    }
    // The diagnosis this exists for. A virtualiser that ignores a SYNTHETIC scroll
    // renders the same rows no matter what scrollTop says — measured on Mondelez's
    // Field of Study, where 40 programmatic scrollTop writes never got past "A" and
    // only a real (trusted) wheel refreshed them. `windows: 1` with a scrollHeight
    // many times clientHeight is that failure exactly, and it is a different
    // problem from "the option genuinely is not in this list".
    trace('list.exhausted', {
        field: label,
        rounds,
        windows: seen.size,
        clientH: sc.clientHeight,
        scrollH: sc.scrollHeight,
        firstWindow,
        lastWindow,
        verdict: seen.size <= 1 && sc.scrollHeight > sc.clientHeight * 2
            ? 'VIRTUALISER IGNORED SYNTHETIC SCROLL — rendered rows never changed'
            : 'walked the whole list, no unambiguous match',
    });
    return null;
}

/**
 * Put an option inside its list's visible band and hand back the element to
 * click.
 *
 * Two separate things go wrong without this. A row can be rendered ABOVE the
 * container's clip rect (measured: the row's box said y=242 while the list
 * started at y=426), and the click then lands on whatever occupies that point
 * instead. And the virtualiser recycles row elements while scrolling, so the
 * element matched a moment ago may since have become a different major — hence
 * the re-resolve by text rather than trusting the old reference.
 */
async function revealOption(opt, getShown, match, label = '') {
    const sc = optionScroller(opt);
    if (sc) {
        const or = opt.getBoundingClientRect();
        const cr = sc.getBoundingClientRect();
        if (or.top < cr.top || or.bottom > cr.bottom) {
            trace('list.reveal', {
                field: label,
                optTop: Math.round(or.top),
                clip: `${Math.round(cr.top)}..${Math.round(cr.bottom)}`,
                why: 'row rendered outside the list clip rect',
            });
            sc.scrollTop += (or.top - cr.top) - (cr.height / 2 - or.height / 2);
            nudgeScroll(sc);
            await sleep(200);
            const after = match(getShown());
            // A recycled row that no longer matches is worth knowing about: the
            // click then lands on a DIFFERENT major with a plausible-looking name.
            if (!after) trace('list.revealLostRow', { field: label, note: 'row recycled; falling back to the stale reference' });
            return after || opt;
        }
        return opt;
    }
    try { opt.scrollIntoView({ block: 'center' }); } catch { /* noop */ }
    await sleep(150);
    return opt;
}

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
/**
 * Answer a DYNAMIC screening dropdown the stored data could not (user-approved
 * 2026-08-02: these are no longer user gaps by default).
 *
 * "Do you have N years of experience in X?" has its answer sitting in the CV —
 * routing it to the user was pure friction. The synthetic descriptor reuses the
 * whole verified custom-select path: open the widget, read the options ACTUALLY
 * offered, let the model pick from those given the CV + profile (infer), commit
 * and verify. The model never types free text — its only power is choosing one
 * of the employer's own options — and the answer lands in the review list as
 * AGENT_DEFAULT, seen by the user before they submit. Demographic/consent
 * questions never reach here: the decline-first ANSWER_RULES resolve them
 * upstream of the gap list.
 */
export async function inferFillDynamicField(gap, profile, cv, resolvedValue = '') {
    const f = {
        label: String(gap.label || '').slice(0, 70) || '(unlabelled select)',
        selector: gap.selector,
        type: 'custom-select',
        required: true,
        infer: true,
        answerSource: 'AGENT_DEFAULT',
    };
    // Workday's button prompt reads its options only once opened.
    // `resolvedValue` is the DETERMINISTIC path through the same machinery:
    // an answer the rules already hold ("No" to sponsorship) used to go
    // through the generic dropdown handler, which paints Workday prompts
    // without committing — measured on Visa's questionnaire, where the four
    // model-answered selects all committed via THIS route while the one
    // rule-answered select failed until the fuse blew. The model only enters
    // when the resolved value matches nothing on the list (infer fallback).
    if (!gap.componentType || gap.componentType === 'custom-dropdown') {
        return fillCustomSelect(f, resolvedValue, { profile, cv });
    }
    // Native <select> and radio groups already told the observer their options —
    // ask the model to pick from EXACTLY those, then commit and verify.
    const offered = (gap.options || []).map(o => o.text || o.value).filter(Boolean);
    const picked = await inferOptionViaLLM(f, offered, profile, cv);
    if (!picked?.value) return { ok: false, reason: `inference: ${picked?.why || 'no pick'}` };
    const want = String(picked.value).trim().toLowerCase();
    const el = document.querySelector(gap.selector);
    if (!el) return { ok: false, reason: 'element-gone' };
    if (gap.componentType === 'native-select') {
        const opt = [...(el.options || [])].find(o =>
            (o.textContent || '').trim().toLowerCase() === want || String(o.value).trim().toLowerCase() === want);
        if (!opt) return { ok: false, reason: `model picked "${picked.value}" but the select has no such option` };
        setNativeValue(el, opt.value);
        return String(el.value) === String(opt.value)
            ? { ok: true, matched: (opt.textContent || '').trim() }
            : { ok: false, reason: 'value did not stick' };
    }
    if (gap.componentType === 'radio-group') {
        const wrap = el.closest('fieldset, [data-automation-id^="formField-"]') || el.parentElement;
        const radios = [...(wrap?.querySelectorAll('input[type="radio"]') || [])].filter(r => r.offsetParent !== null);
        const labelOf = (r) => {
            const byFor = r.id ? wrap.querySelector(`label[for="${CSS.escape(r.id)}"]`) : null;
            return ((byFor || r.closest('label'))?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        };
        const exact = radios.filter(r => labelOf(r) === want);
        const loose = radios.filter(r => labelOf(r).includes(want));
        const target = exact[0] || (loose.length === 1 ? loose[0] : null);
        if (!target) return { ok: false, reason: `model picked "${picked.value}" but no unique radio matches` };
        if (target.checked) return { ok: false, reason: 'already-selected' };
        if (!safeActivate(target, { source: 'recipe', activation: 'widget-option' }, gap.selector)) {
            return { ok: false, reason: 'policy-denied' };
        }
        return target.checked ? { ok: true, matched: picked.value } : { ok: false, reason: 'click did not select it' };
    }
    return { ok: false, reason: `unsupported shape: ${gap.componentType}` };
}

// ── Field ownership: resolve vs execute ─────────────────────────────────────
// Any layer may RESOLVE an answer for a field the recipe covers, but only the
// recipe EXECUTES it — its widget knowledge is what turns an answer into a
// committed value, and a generic fill on a recipe-owned widget is how "How Did
// You Hear" got free text typed into a searchable prompt: looked answered,
// committed nothing, pinned the step on a validation error for ten iterations.
// A field is RELEASED to the generic layers only on structured failure: the
// recipe exhausted its strategies (FAIL) or its selector found nothing
// (absent) — so a stale recipe cannot hold a field hostage either.
const _fieldStatus = new Map();   // field label → { status, why, at, fails, tried[] }

/**
 * How many passes a field may keep failing before the recipe stops holding the
 * step for it.
 *
 * Two is deliberate. One pass is not evidence — half the widgets on a Workday
 * step legitimately fail their first attempt because the row had not rendered,
 * a stale popup covered it, or the section was still being added, and all of
 * those fix themselves on the next pass. A THIRD identical failure is not going
 * to become a success; by then the field needs a different actor, not another
 * try with the same one.
 */
export const FIELD_FAIL_BUDGET = 2;

/** Last recipe verdict for a field, as recorded by the most recent pass. */
export function recipeFieldStatus(label) { return _fieldStatus.get(label) || null; }

/** True when the recipe has formally given up on the field this page-state. */
export function recipeReleased(label) {
    const s = _fieldStatus.get(label);
    return !!s && (s.status === 'FAIL' || s.status === 'absent');
}

/**
 * Fields that FAILED this pass and still have retries left.
 *
 * The step must not advance while this is non-empty. Advancing is how a failed
 * field became invisible: the recipe reported FAIL, nothing consumed that
 * verdict, the observer did not list the widget as unfilled-required (it shows
 * a value, or the tenant did not mark it required), and the loop clicked
 * "Save and Continue" over the top of it. The application went to the next step
 * carrying a field the agent KNEW it had not filled.
 *
 * Bounded on purpose: once a field is out of budget it drops off this list, the
 * step is allowed to move, and the failure travels to the user in the review
 * instead of deadlocking the run. Blocking forever and advancing blindly are
 * both wrong; the budget is where they meet.
 */
export function recipeBlockingFields() {
    const out = [];
    for (const [label, s] of _fieldStatus) {
        if (s.status === 'FAIL' && (s.fails || 0) <= FIELD_FAIL_BUDGET) {
            out.push({ label, why: s.why, fails: s.fails || 1 });
        }
    }
    return out;
}

/**
 * Record one pass's verdicts, counting how many times each field has failed IN A
 * ROW and what it failed with.
 *
 * The streak is the part that was missing. Every pass re-ran the identical
 * strategy against the identical widget and re-derived the identical failure,
 * with nothing anywhere noticing that it had seen this before — so "try
 * something else" had no trigger to fire on, and the loop's only remaining move
 * was to advance. `tried` keeps the distinct reasons so the escalation can say
 * what has already been ruled out rather than starting from nothing.
 */
export function recordOutcomes(outcomes) {
    for (const [label, status, why] of outcomes) {
        const prev = _fieldStatus.get(label);
        if (status === 'FAIL') {
            const tried = prev?.status === 'FAIL' ? [...(prev.tried || [])] : [];
            if (why && !tried.includes(why)) tried.push(why);
            const fails = (prev?.status === 'FAIL' ? (prev.fails || 0) : 0) + 1;
            _fieldStatus.set(label, { status, why, at: Date.now(), fails, tried });
            trace('field.fail', { field: label, why, streak: fails, budget: FIELD_FAIL_BUDGET, tried: tried.join(' → ') });
        } else {
            // Any non-FAIL verdict ends the streak — including 'absent', because a
            // widget that stopped resolving is a different situation from one that
            // resolves and refuses, and carrying the old count into it would spend
            // a budget the new situation never used.
            _fieldStatus.set(label, { status, why, at: Date.now(), fails: 0, tried: [] });
        }
    }
}

/** Forget every field verdict — a new step/page starts its own budget. */
export function resetFieldStatus() { _fieldStatus.clear(); }

/** formField wrapper element → recipe field label. MENU-wide, matching the
 *  fill scope: any known field whose control resolves on THIS page is the
 *  recipe's to execute, whichever step first measured it. */
export function recipeOwnedWrappers(recipe) {
    const owned = new Map();
    for (const f of (recipe?.steps || []).flatMap(s => s.fields || [])) {
        const el = resolveFieldControl(f);
        const wrap = el?.closest?.('[data-automation-id^="formField-"]') || el;
        if (wrap && !owned.has(wrap)) owned.set(wrap, f.label);
    }
    return owned;
}

/**
 * Only ONE fill may be in flight per page.
 *
 * Nothing enforced this: the auto-apply loop and copoStep() both call straight
 * in, so a debug step fired while the loop was running put two passes on the
 * same widgets. Measured — two "My Experience" summaries 83ms apart with
 * opposite verdicts: one reported Language `level1:no-row` and its proficiency
 * list `option-not-found (42 shown)` while the other reported both OK. Neither
 * field was broken; the passes were closing each other's popups (every pass
 * clears stray popups by design, and the other pass's open list looks exactly
 * like a stray one). Refuse rather than queue — a caller that collided wants to
 * know, and the loop simply retries next iteration.
 */
// The lock lives on `window`, NOT in this module.
//
// A module-scoped lock only guards callers that share this module — and the case
// it was written for does not. A document can end up with two copies of the
// content script (declarative injection plus a programmatic re-inject after a
// redirect), each with its own module scope and therefore its own lock, and the
// two passes then interleave on the same widgets: a skill picked from the other
// pass's still-settling result list, a language committed twice, two summaries
// for one step disagreeing about what happened. `window` is shared by every copy
// in this document's isolated world, so a lock there is the only one that holds.
//
// The `init()` claim in index.js closes the same race one level up; this is the
// backstop, because a lost race there costs a wrong entry on a submitted
// application and the cost of an extra guard is a boolean.
const LOCK = '__copoFillLock';
// A pass that throws past its own `finally` (context invalidated mid-fill) must
// not wedge the page forever. Longer than any real pass: the slowest measured is
// a full My Experience with a virtualized language list, well under a minute.
const LOCK_STALE_MS = 120000;

export async function applyRecipeFields(recipe, profile, cvData, cv) {
    const held = window[LOCK];
    if (held && Date.now() - held.at < LOCK_STALE_MS) {
        console.warn('[Copo Recipe] a fill is already running on this page — skipping this one. '
            + '(Two agent instances, or the Auto Apply loop + copoStep() at once? Let one finish.)');
        trace('recipe.busy', { url: location.pathname.slice(-40), heldForMs: Date.now() - held.at });
        return { matched: false, filled: 0, busy: true };
    }
    if (held) trace('recipe.lockStale', { heldForMs: Date.now() - held.at });
    // Claimed synchronously — no await between reading the lock and taking it.
    const token = { at: Date.now() };
    window[LOCK] = token;
    try {
        return await _applyRecipeFields(recipe, profile, cvData, cv);
    } finally {
        // Only release OUR claim: a stale-takeover means someone else owns it now,
        // and clearing it blindly would hand the page to a third pass.
        if (window[LOCK] === token) window[LOCK] = null;
    }
}

async function _applyRecipeFields(recipe, profile, cvData, cv) {
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
            // ONE commit definition, shared with the observer (readFileCommitState):
            // `input.files` alone is not the truth — Workday ingests the file and
            // CLEARS the input, so hasFile read false on every later pass and the
            // agent re-uploaded the CV each iteration (measured: 5+ duplicate rows
            // in one run). And when only the recipe knew about the uploaded rows,
            // the observer kept counting the same upload as unfilled-required.
            const fileState = readFileCommitState(fileEl, document);
            const uploadedRows = fileState.uploadedRows;
            const already = fileState.committed;
            // Diagnostic — if the CV still doesn't attach, this tells us exactly why:
            // shadow open vs closed (a closed shadow root is unreachable → we can't
            // set the <input>), and how many inputs of any type are reachable.
            const _sh = host ? (host.shadowRoot ? host.shadowRoot.mode : 'none/closed') : '-';
            const _anyInputs = host ? deepQueryAll('input', host).length : 0;
            console.log(`[Copo Recipe] upload "${key}": host=${!!host} shadow=${_sh} fileInput=${!!fileEl} anyInputs=${_anyInputs} hasFile=${already} uploadedRows=${uploadedRows}`);
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
            // The upload itself, in the trace. "Uploaded the CV and then nothing
            // happened" is reported often and answered by exactly two facts: did
            // the file reach an input, and was this pass then cut short to let the
            // parser run (`once`) — because that early return is indistinguishable
            // from a stall if you are watching the page rather than the code.
            // Only when something is actually there. A page with no upload target
            // reports "nothing here" identically on every iteration, and those
            // rows crowded out the ones that explained a failure.
            const notable = ok || !!fileEl || already || !!host;
            (notable ? trace : traceOnce.bind(null, `upload.none:${location.pathname}:${key}`))('upload', {
                target: key,
                via: t.via || 'input',
                hostFound: !!host,
                fileInput: !!fileEl,
                shadow: _sh,
                alreadyHadFile: already,
                uploadedRows,
                ok,
                stopsPass: !!(ok && t.once),
            });
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

    // ── FIELD MENU: tenants reorder and reshape Workday's steps — the same
    // Degree prompt can sit on a differently-named page, or one page can mix
    // fields the measured tenant spread across two. So known fields are a MENU
    // matched against what THIS page actually renders, never a list locked to
    // the step that first measured them. The matched step's fields go first
    // (their array order carries real dependencies — Country re-renders
    // Province), then every OTHER known field whose control resolves on this
    // page joins in. On the measured tenant nothing changes: other steps'
    // selectors simply don't resolve cross-page.
    const stepFields = step?.fields || [];
    const inStep = new Set(stepFields.map(f => f.label));
    const fieldOnPage = (f) => {
        const el = resolveFieldControl(f);
        return !!(el && el.offsetParent !== null);
    };
    const menuExtras = (recipe.steps || [])
        .flatMap(s => s.fields || [])
        .filter((f, i, arr) => arr.findIndex(x => x.label === f.label) === i)
        .filter(f => !inStep.has(f.label))
        .filter(fieldOnPage);
    const fieldsToFill = [...stepFields, ...menuExtras];
    const stepName = step?.name || (menuExtras.length ? 'Field Menu' : null);
    // A matched step with NOTHING to fill is still MATCHED — the Autofill page
    // is a dropzone and a Continue button, and returning matched:false there
    // stranded the run between two gates: the recipe advance wants rf.matched,
    // the generic advance stands down because a step detect matched. Measured:
    // four iterations staring at a visible "Continue" without clicking it.
    if (!stepName) return { matched: filled > 0, filled };
    if (menuExtras.length) {
        trace('recipe.menu', {
            step: stepName,
            extras: menuExtras.map(f => f.label).join(' | '),
        });
    }

    // Fields are filled in array order (Country BEFORE Province — picking Country
    // re-renders the region field). Custom-selects re-query fresh each pass, so a
    // field that isn't rendered yet is simply retried next iteration.
    // Sections that must EXIST before their fields can be filled. A repeating
    // block starts empty on some jobs and pre-filled on others (Workday's résumé
    // parse decides), and the recipe cannot fill a row that is not there.
    for (const sectionName of step?.ensureSections || []) {
        const r = ensureSectionEntry(sectionName);
        if (r.ok) await sleep(900);   // let the new row render before filling it
    }

    const outcomes = [];   // [label, status, note] per field → debug summary below
    // Provenance for the review hand-off: which answers came from the user's own
    // data, and which are values the agent chose to get the step to validate. The
    // user is going to check the application on the review page, and "these four
    // are ours, not yours" is the difference between a review they can do in a
    // minute and one they have to do field by field.
    const answers = [];
    // The FULL work history, not just row one — autonomy must not stop at the
    // schema's single-selector boundary (measured: three CV jobs, a Review
    // page reading "Work Experience: No Response").
    if (recipe.ats === 'workday' && (step?.ensureSections || []).includes('Work Experience')) {
        try { filled += await fillWorkExperienceRows(cv, outcomes); }
        catch (e) { outcomes.push(['Work Experience (rows)', 'FAIL', (e && e.message) || 'exception']); }
    }
    for (const f of fieldsToFill) {
        let val = recipeFieldValue(f, profile, cv);
        // Free text nobody stored, that the agent may write itself. Gated on the
        // box being EMPTY on screen — resolving the value happens before the
        // per-type handlers get to their own "already filled" check, so without
        // this a re-run would pay for a message the form is already showing.
        if ((val == null || String(val).trim() === '') && f.generate === 'message') {
            const host = f.selector ? document.querySelector(f.selector) : null;
            const box = host ? deepFindControl(host, f.control) : null;
            if (box && String(box.value ?? '').trim() === '') {
                val = await generateMessageViaLLM(f, cv);
            }
        }
        const hasLadder = Array.isArray(f.valuePriority) && f.valuePriority.length > 0;
        // A field that may be INFERRED is not skipped for having no value — no
        // value is precisely when the model is worth asking. Everything else with
        // nothing to fill is left alone.
        if ((val == null || String(val).trim() === '') && !hasLadder && !f.infer) {
            outcomes.push([f.label, 'skip', 'no value']); continue;
        }
        // A fixed `value`/`default` the profile did not supply is the agent's own
        // choice; anything resolved from the profile is the user's.
        const provenance = f.answerSource
            || (f.profileKey && profile[f.profileKey] ? 'PROFILE' : 'AGENT_DEFAULT');
        try {
            if (f.type === 'search-multi') {
                const r = await fillSearchMulti(f, val, { profile, cv });
                if (r.satisfied && r.changed) { filled++; outcomes.push([f.label, 'OK', `${r.added} added${r.already ? `, ${r.already} already` : ''}`]); }
                else if (r.satisfied) outcomes.push([f.label, 'done', 'all terms already committed']);
                else if (r.reason === 'field-absent' || r.reason === 'no search box') outcomes.push([f.label, 'absent', 'not rendered yet']);
                else if (r.reason === 'no value') outcomes.push([f.label, 'skip', 'no value']);
                // Every term returning nothing means the employer configured no
                // matching skills. That is not a fault here, and calling it FAILED
                // buries the real failures in the same line.
                else if (r.emptyTaxonomy) outcomes.push([f.label, 'skip', 'no results for any term']);
                else outcomes.push([f.label, 'FAIL', r.reason]);
            } else if (f.type === 'date') {
                const r = await fillDateField(f, val);
                if (r.ok) { filled++; outcomes.push([f.label, 'OK', String(val)]); answers.push({ field: f.label, value: val, source: provenance }); }
                else if (r.reason === 'already-selected') outcomes.push([f.label, 'done', 'already filled']);
                else if (r.reason === 'field-absent') outcomes.push([f.label, 'absent', 'not rendered yet']);
                // "Hiện tại" is not a date. A current role HAS no end date, so
                // there is nothing to fill and nothing failed.
                else if (r.reason === 'no value') outcomes.push([f.label, 'skip', 'no end date (current role)']);
                else outcomes.push([f.label, 'FAIL', r.reason]);
            } else if (f.type === 'checkbox') {
                const el = resolveFieldControl(f);
                if (!el || el.offsetParent === null) { outcomes.push([f.label, 'absent', 'not rendered yet']); continue; }
                if (el.checked) { outcomes.push([f.label, 'done', 'already ticked']); continue; }
                if (!safeActivate(el, { source: 'recipe', activation: 'widget-option' }, f.selector)) {
                    outcomes.push([f.label, 'FAIL', 'policy-denied']);
                    continue;
                }
                await sleep(250);
                let on = el.checked;
                // Workday's styled checkbox often wires the CLICK to a panel
                // div or the label, not the input — measured on Visa, where
                // the input click flipped nothing ("tick did not take") on the
                // terms acknowledgement, twice. Same escalation discipline as
                // the currently-work-here ladder: every rung re-reads the real
                // input, nothing trusts its own click.
                if (!on) {
                    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch { /* noop */ }
                    await sleep(250);
                    on = el.checked;
                }
                if (!on) {
                    const wrapEl = el.closest('[data-automation-id^="formField-"]');
                    const alt = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`))
                        || el.closest('label')
                        || wrapEl?.querySelector('[data-automation-id="checkboxPanel"]');
                    if (alt && safeActivate(alt, { source: 'recipe', activation: 'widget-option' }, f.selector)) {
                        await sleep(300);
                        on = el.checked;
                    }
                }
                if (on) { filled++; outcomes.push([f.label, 'OK', 'ticked']); answers.push({ field: f.label, value: 'Yes', source: provenance }); }
                else outcomes.push([f.label, 'FAIL', 'tick did not take']);
            } else if (f.type === 'radio') {
                const r = fillRadio(f, val);
                if (r.ok) { filled++; outcomes.push([f.label, 'OK', String(val)]); answers.push({ field: f.label, value: val, source: provenance }); }
                else if (r.reason === 'already-selected') outcomes.push([f.label, 'done', 'already selected']);
                else if (r.reason === 'group-absent') outcomes.push([f.label, 'absent', 'not rendered yet']);
                else outcomes.push([f.label, 'FAIL', r.reason]);
            } else if (f.type === 'custom-select') {
                const r = await fillCustomSelect(
                    f.levelLadder ? { ...f, valuePriority: levelLadder(val) }
                        : f.prefixLadder ? { ...f, valuePriority: prefixLadder(val) }
                        : f.genderLadder ? { ...f, valuePriority: [...genderLadder(val), ...(f.valuePriority || [])] }
                        : f,
                    (f.prefixLadder || f.genderLadder) ? '' : val, { profile, cv });
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
                else if (r.reason === 'button-absent' || r.reason === 'trigger-absent') outcomes.push([f.label, 'absent', 'not rendered yet']);
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
                // Truncated in the outcome line only: a written message is ~150
                // words, and the debug summary is a table meant to be scanned.
                // `answers` keeps the full value — the review reads that.
                if (String(el.value ?? '').trim() !== '') { filled++; outcomes.push([f.label, 'OK', String(val).slice(0, 60)]); answers.push({ field: f.label, value: val, source: provenance }); }
                else outcomes.push([f.label, 'FAIL', 'value did not stick']);
            } else {
                const el = resolveFieldControl(f);
                if (!el || el.offsetParent === null) { outcomes.push([f.label, 'absent', 'not rendered yet']); continue; }
                if (el.type === 'password') { outcomes.push([f.label, 'skip', 'password']); continue; }   // never
                // TEST the widget before trusting the declared type: the same
                // question is free text on one tenant and a pick-required
                // prompt on another, and typing into a prompt paints an answer
                // that commits nothing. The probe decides the strategy; the
                // label only decided the VALUE.
                const probed = await probeFieldShape(el);
                if (isPickerShape(probed.shape)) {
                    trace('shape.reroute', { field: f.label, declared: f.type || 'text', probed: probed.shape, evidence: probed.evidence });
                    const r = await fillCustomSelect(f, val, { profile, cv });
                    if (r.ok) { filled++; outcomes.push([f.label, 'OK', String(r.matched || val)]); answers.push({ field: f.label, value: r.matched || val, source: provenance }); }
                    else if (r.reason === 'already-selected') outcomes.push([f.label, 'done', 'already selected']);
                    else outcomes.push([f.label, 'FAIL', r.reason]);
                    continue;
                }
                // Same commit rule as dates and prompts: a value NEXT TO a live
                // validation error is not an answer. Measured on the salary
                // textarea — "Negotiable" painted in the box, "must have a
                // value" right under it (Workday saw the field as EMPTY: the
                // native setter never reached its state), and this guard then
                // read the painted text as done on every later pass.
                const wrapEl = el.closest('[data-automation-id^="formField-"]');
                const errCount = () => wrapEl
                    ? wrapEl.querySelectorAll(FIELD_ERROR_SEL).length
                    : 0;
                const errsBefore = errCount();
                if (String(el.value ?? '').trim() !== '' && !errsBefore) { outcomes.push([f.label, 'done', 'already filled']); continue; }
                if (String(el.value ?? '').trim() !== '' && errsBefore) {
                    setNativeValue(el, '', { quiet: true });
                    await sleep(120);
                }
                // The keyboard path — the one route Workday's widgets reliably
                // consume — then a real exit so its validation pass runs.
                await simulateTyping(el, String(val));
                try { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); el.blur?.(); } catch { /* noop */ }
                await sleep(300);
                const nowVal = String(el.value ?? '').trim();
                if (!nowVal) outcomes.push([f.label, 'FAIL', 'value did not stick']);
                else if (errsBefore > 0 && errCount() > 0) outcomes.push([f.label, 'PARTIAL', 'value shown but error persists']);
                else { filled++; outcomes.push([f.label, 'OK', String(val)]); answers.push({ field: f.label, value: val, source: provenance }); }
            }
        } catch (e) {
            outcomes.push([f.label, 'FAIL', (e && e.message) || 'exception']);
            // A field that died mid-widget leaves its popup open and its search box
            // dirty — state the NEXT field then reads as its own (measured: the
            // skills crash left a popup that covered Degree's list a pass later).
            try { await closeStrayPopups(`${f.label}:after-crash`); } catch { /* best effort */ }
        }
        await sleep(120);
    }

    // Every work-experience row's end date — the field list above only reaches
    // the first formField-endDate on the page.
    // Shape-based, not step-name-based: any page showing language rows gets
    // the per-row pass, whatever the tenant called the step.
    if (recipe.ats === 'workday' && document.querySelector('[data-automation-id="formField-language"]')) {
        try { filled += await fillLanguageRows(cv, outcomes, profile); }
        catch (e) { outcomes.push(['Languages (rows)', 'FAIL', (e && e.message) || 'exception']); }
    }
    // The checkbox-group twin of the same question (Unilever: "What languages
    // do you speak?*"). Shape-based like the rows — cheap no-op when absent.
    if (recipe.ats === 'workday') {
        try { filled += await fillLanguageCheckboxGroup(cv, outcomes, profile); }
        catch (e) { outcomes.push(['Languages (checkbox group)', 'FAIL', (e && e.message) || 'exception']); }
    }
    // Shape-based, not step-name-based: any page showing endDate rows gets the
    // per-row pass, whatever the tenant called the step.
    if (recipe.ats === 'workday' && document.querySelector('[data-automation-id="formField-endDate"]')) {
        try { filled += await fillExperienceEndDates(cv, outcomes); }
        catch (e) { outcomes.push(['Work To (rows)', 'FAIL', (e && e.message) || 'exception']); }
    }

    // Per-field debug log — only on passes where something was filled or failed
    // (the recipe re-runs every iteration; skip the idempotent all-"done" passes).
    const failed = outcomes.filter(([, s]) => s === 'FAIL');
    // Always log the per-field verdict while debugging — shows OK/done/absent/skip/
    // FAIL for every recipe field each pass (why filled=0 etc.).
    // The ownership registry: what the generic layers consult before touching a
    // field this recipe covers (see recipeReleased above).
    recordOutcomes(outcomes);
    console.log(`[Copo Recipe] "${stepName}" fields →`, outcomes.map(([l, s]) => `${l}:${s}`).join('  ·  '));
    if (failed.length) {
        // The streak, not just the reason: "Language — no-row" on its own reads as
        // a fresh problem every pass, and the whole point is to see that it is the
        // same one for the third time.
        console.warn(`[Copo Recipe] ✗ FAILED (${stepName}):`,
            failed.map(([l, , why]) => {
                const n = _fieldStatus.get(l)?.fails || 1;
                return `${l} — ${why}${n > 1 ? ` [lần ${n}/${FIELD_FAIL_BUDGET + 1}${n > FIELD_FAIL_BUDGET ? ', hết lượt → nhường cho lớp khác' : ''}]` : ''}`;
            }).join('  |  '));
    }
    // The same verdicts into the trace. A step that will not advance is always
    // one of these: a field the recipe never had, one whose selector no longer
    // resolves ('absent' every pass), or one that took a value the page then
    // dropped ('FAIL — value did not stick'). All three present identically from
    // outside — the Next button simply does nothing — and the console line above
    // dies with the document on the navigation that never comes.
    // Skip the idempotent all-"done" passes; the recipe re-runs every iteration
    // and a step that is already filled has nothing to explain.
    const notable = filled > 0 || failed.length
        || outcomes.some(([, st]) => st === 'absent' || st === 'skip');
    (notable ? trace : traceOnce.bind(null, `recipe.done:${stepName}`))('recipe.fields', {
        step: stepName,
        filled,
        ok: outcomes.filter(([, s]) => s === 'OK').map(([l]) => l).join(', ') || null,
        alreadyDone: outcomes.filter(([, s]) => s === 'done').length,
        absent: outcomes.filter(([, s]) => s === 'absent').map(([l]) => l).join(', ') || null,
        skipped: outcomes.filter(([, s]) => s === 'skip').map(([l, , why]) => `${l}(${why})`).join(', ') || null,
        failed: failed.map(([l, , why]) => `${l}: ${why}`).join(' | ') || null,
    });

    return { matched: true, filled, step: stepName, answers };
}

/**
 * Create a repeating entry when a section is empty.
 *
 * Measured on Mondelez: My Experience shows "Work Experience" with an Add button
 * and NOTHING else — Job Title, Company and the dates do not exist in the DOM
 * until that button is pressed. On a job where Workday's résumé parse happened to
 * create a row they were there, and on one where it did not the recipe filled
 * nothing and reported nothing, because there was nothing to find. Same step,
 * same recipe, opposite outcomes.
 *
 * All four Add buttons on that page share `data-automation-id="add-button"`, so
 * the SECTION HEADING is the only thing that tells them apart — press the wrong
 * one and the application grows an empty education or website row.
 */
/**
 * A section's bounds = everything between ITS heading and the NEXT heading of
 * the same-or-higher level. The old subtree walk climbed UP "until the block
 * holds more than its title" — and an EMPTY section is all title, so it
 * climbed past its own bounds into a container that also held Education's
 * fields, read them as "this section already has an entry", and silently
 * never clicked Add. The emptier the section, the more certain the miss.
 */
function sectionScope(sectionName) {
    const vis = (e) => !!(e && e.offsetParent !== null);
    const heads = [...document.querySelectorAll('h2, h3, h4')].filter(vis);
    const head = heads.find(h => (h.textContent || '').trim().toLowerCase() === sectionName.toLowerCase());
    if (!head) return null;
    const lvl = (h) => Number(h.tagName[1]) || 6;
    const idx = heads.indexOf(head);
    let nextHead = null;
    for (let j = idx + 1; j < heads.length; j++) {
        if (lvl(heads[j]) <= lvl(head)) { nextHead = heads[j]; break; }
    }
    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    const inSection = (el) => (head.compareDocumentPosition(el) & FOLLOWING)
        && (!nextHead || (el.compareDocumentPosition(nextHead) & FOLLOWING));
    return { head, inSection, vis };
}

/** The section's own Add / Add Another button, or null. */
function sectionAddButton(sectionName) {
    const scope = sectionScope(sectionName);
    if (!scope) return null;
    return [...document.querySelectorAll('[data-automation-id="add-button"]')]
        .filter(scope.vis).filter(scope.inSection)[0] || null;
}

function ensureSectionEntry(sectionName) {
    const scope = sectionScope(sectionName);
    if (!scope) { trace('section.check', { section: sectionName, verdict: 'section-absent' }); return { ok: false, reason: 'section-absent' }; }

    // Already has an entry → nothing to do. Adding a second would submit a blank row.
    const ownFields = [...document.querySelectorAll('[data-automation-id^="formField-"]')].filter(scope.vis).filter(scope.inSection);
    if (ownFields.length) { trace('section.check', { section: sectionName, verdict: 'already-present', fields: ownFields.length }); return { ok: false, reason: 'already-present' }; }

    const btn = sectionAddButton(sectionName);
    if (!btn) { trace('section.check', { section: sectionName, verdict: 'no add button in section' }); return { ok: false, reason: 'no add button' }; }
    const ok = safeActivate(btn, { source: 'recipe', activation: 'page-action' }, '[data-automation-id="add-button"]');
    trace('section.add', { section: sectionName, clicked: ok });
    return ok ? { ok: true } : { ok: false, reason: 'policy-denied' };
}

/**
 * EVERY work-experience row the CV holds, not just the recipe's row one.
 *
 * The recipe schema is born single-row — one field, one selector, first
 * match — so an autonomous agent stopped exactly at that boundary and rows
 * 2..n fell off the application silently. This pass GROWS the section to the
 * CV's row count (append order makes index i ↔ experience[i] ours by
 * construction) and fills each row's columns, never overwriting text someone
 * — the ATS parse, a person — already put there. End dates and the
 * currently-work-here tick stay with fillExperienceEndDates (title-matched,
 * verified), which runs after this.
 */
async function fillWorkExperienceRows(cv, outcomes) {
    const exp = cv?.experience || [];
    if (!exp.length) return 0;
    const vis = (e) => !!(e && e.offsetParent !== null);
    const rowsNow = () => [...document.querySelectorAll('[data-automation-id="formField-jobTitle"]')].filter(vis);

    const want = Math.min(exp.length, 5);
    let guard = 0;
    while (rowsNow().length < want && guard < want + 2) {
        guard++;
        const btn = sectionAddButton('Work Experience');
        if (!btn) break;
        if (!safeActivate(btn, { source: 'recipe', activation: 'page-action' }, '[data-automation-id="add-button"]')) break;
        const had = rowsNow().length;
        const by = Date.now() + 4000;
        while (rowsNow().length <= had && Date.now() < by) await sleep(200);
        if (rowsNow().length <= had) break;   // click added nothing — stop, don't spin
        trace('section.addRow', { section: 'Work Experience', rows: rowsNow().length, want });
    }

    const colWraps = (aid) => [...document.querySelectorAll(`[data-automation-id="${aid}"]`)].filter(vis);
    let filled = 0;
    const titles = rowsNow();
    for (let i = 0; i < titles.length && i < exp.length; i++) {
        const e = exp[i];
        const put = async (wrapEl, val, what) => {
            if (!wrapEl || val == null || String(val).trim() === '') return;
            const box = wrapEl.querySelector('input:not([type="hidden"]), textarea');
            if (!box || String(box.value || '').trim()) return;       // filled → not ours to touch
            try { box.focus(); } catch { /* noop */ }
            // ONE input event, not one per character. Workday re-renders the
            // whole step on every controlled change — measured 1 char/second
            // on a 600-char Role Description, which starved the run's clock
            // before the later rows' dates were ever reached. Plain text and
            // textareas commit off a single native-setter write; per-char
            // typing stays as the fallback for the odd input that ignores it.
            setNativeValue(box, String(val), { quiet: true });
            await sleep(120);
            if (!String(box.value || '').trim()) await simulateTyping(box, String(val));
            try { box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); box.blur?.(); } catch { /* noop */ }
            await sleep(150);
            if (String(box.value || '').trim()) { filled++; outcomes.push([`${what} (row ${i + 1})`, 'OK', String(val).slice(0, 30)]); }
            else outcomes.push([`${what} (row ${i + 1})`, 'FAIL', 'value did not stick']);
        };
        await put(titles[i], e.title, 'Job Title');
        await put(colWraps('formField-companyName')[i], e.company, 'Company');
        // Some tenants render per-row Location REQUIRED (measured on Visa —
        // three empty Location* boxes ended the run NEED_HUMAN) and CVs
        // almost never state one per job. Country-level truth is the honest
        // floor for this product's candidates: their work history is in
        // Vietnam, and "Vietnam" beats a stranded required field (same user
        // decision as the address city fallback).
        await put(colWraps('formField-location')[i], e.location || e.city || 'Vietnam', 'Location');
        await put(colWraps('formField-roleDescription')[i], e.description, 'Role description');
        const sd = colWraps('formField-startDate')[i];
        if (sd) {
            const r = await setDateOnWrap(sd, String(e.start_date || ''));
            if (r.ok) { filled++; outcomes.push([`Work From (row ${i + 1})`, 'OK', String(e.start_date).slice(0, 12)]); }
            else if (!['already-selected', 'no value'].includes(r.reason)) outcomes.push([`Work From (row ${i + 1})`, 'FAIL', r.reason]);
        }
    }
    return filled;
}

/**
 * Fill a Workday date, which is not one input but two.
 *
 * "From" and "To" each render a month box and a year box inside one labelled
 * wrapper, so a single setNativeValue fills half a date and the step stays
 * invalid — the trace showed five required fields with no labels the scanner
 * could name, and the planner then reported the dates as missing from the
 * profile when the CV had them all along ("03/2024").
 *
 * Accepts what CVs actually write: 03/2024, 2024-03, Mar 2024, 2024. A value
 * that names no year is not a date and is left alone rather than half-entered.
 */
async function fillDateField(f, val) {
    const wrap = (f.selector && document.querySelector(f.selector))
        || (f.labelMatch ? findWrapperByLabel(f.labelMatch) : null);
    // An invisible wrapper is a field that is NOT on this step — a leftover
    // hidden node made this report "no inputs in wrapper" as a FAILURE on
    // every Application Questions pass, burning fail-streak budget on a date
    // that simply was not there.
    if (!wrap || wrap.offsetParent === null) return { ok: false, reason: 'field-absent' };
    return setDateOnWrap(wrap, val);
}

/**
 * The month/year mechanics of a split Workday date, on a GIVEN wrapper — so
 * the per-row experience pass can reuse them beyond the recipe's row one.
 *
 * Two commit rules learned the hard way here:
 *   · A value NEXT TO a live validation error is not an answer. Measured:
 *     "03/2024" painted in the box with "The field From is required" right
 *     under it — the value setter updated the DOM sections but Workday's own
 *     state never took them, and the old already-selected guard then read
 *     that DOM text as done forever. Same false-done family as the prompt's
 *     free text and the ticked-but-ignored checkbox.
 *   · Entry goes through the KEYBOARD path (simulateTyping), the one route
 *     Workday's segmented date widget is built to consume, and the exit blur
 *     is what triggers its validation pass.
 */
async function setDateOnWrap(wrap, val) {
    const text = String(val).trim();
    if (/^(hiện tại|present|current|now)$/i.test(text)) return { ok: false, reason: 'no value' };
    const year = (text.match(/\b(19|20)\d{2}\b/) || [])[0];
    if (!year) return { ok: false, reason: `no year in "${text}"` };
    const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    let month = (text.match(/\b(0?[1-9]|1[0-2])\b(?!\d)/) || [])[0];
    if (!month) {
        const named = MONTHS.findIndex(m => new RegExp(`\\b${m}`, 'i').test(text));
        if (named >= 0) month = String(named + 1);
    }

    const inputs = [...wrap.querySelectorAll('input')].filter(i => i.offsetParent !== null);
    if (!inputs.length) return { ok: false, reason: 'no inputs in wrapper' };
    const errorsIn = () => wrap.querySelectorAll(FIELD_ERROR_SEL).length;
    const pick = (re) => inputs.find(i => re.test(
        `${i.getAttribute('data-automation-id') || ''} ${i.getAttribute('aria-label') || ''} ${i.name || ''}`));
    const single = inputs.length === 1 ? inputs[0] : null;
    const monthEl = single ? null : (pick(/month/i) || inputs[0]);
    const yearEl = single || pick(/year/i) || inputs[1];
    if (!yearEl) return { ok: false, reason: 'no year input in wrapper' };
    if (single && !month) return { ok: false, reason: 'combined MM/YYYY input but no month in CV value' };

    // COMMITTED state, not painted DOM. A date section is a spinbutton whose
    // aria-valuenow is rendered from Workday's own state and cannot be written
    // from outside — .value can. Measured: "02/2023" sitting in .value with
    // aria-valuetext still "MM" and the required-error live; reading .value
    // called that done forever. A section that is NOT a spinbutton has no aria
    // contract, so .value stays the best available signal there.
    const committed = (el) => {
        if (!el) return true;
        if (el.getAttribute('role') === 'spinbutton') {
            const now = el.getAttribute('aria-valuenow');
            return now != null && String(now).trim() !== '';
        }
        return String(el.value || '').trim() !== '';
    };
    const errorsBefore = errorsIn();
    // Committed value, no live error → genuinely answered. Anything else —
    // painted text, or a value beside an error — falls through and re-enters.
    if (committed(yearEl) && (single || !month || committed(monthEl)) && !errorsBefore) {
        return { ok: false, reason: 'already-selected' };
    }

    // Digits as REAL keystrokes, one at a time. Workday's date sections are
    // spinbuttons that consume keydown/beforeinput and write their own value —
    // the value setter painted "02/2023" the widget's state never held, the
    // healing re-entry re-painted it the same dead way, and the error outlived
    // every pass. When the widget consumes the key (value changes by itself)
    // its state IS the value; the setter is only the fallback for sections
    // that turn out to be plain inputs.
    const typeInto = async (el, digits) => {
        try { el.focus(); el.select?.(); } catch { /* noop */ }
        setNativeValue(el, '', { quiet: true });
        await sleep(60);
        for (const ch of String(digits)) {
            const kc = ch.charCodeAt(0);
            const before = String(el.value || '');
            const opts = { key: ch, code: `Digit${ch}`, keyCode: kc, which: kc, bubbles: true, cancelable: true, composed: true };
            el.dispatchEvent(new KeyboardEvent('keydown', opts));
            el.dispatchEvent(new InputEvent('beforeinput', { data: ch, inputType: 'insertText', bubbles: true, cancelable: true, composed: true }));
            await sleep(30);
            if (String(el.value || '') === before) {
                setNativeValue(el, before + ch, { quiet: true });
            }
            el.dispatchEvent(new KeyboardEvent('keyup', opts));
            await sleep(40);
        }
    };
    if (single) {
        await typeInto(single, `${month.padStart(2, '0')}${year}`);
    } else {
        if (month && monthEl && monthEl !== yearEl) await typeInto(monthEl, month.padStart(2, '0'));
        await typeInto(yearEl, year);
    }
    try {
        yearEl.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        yearEl.blur?.();
    } catch { /* noop */ }
    await sleep(400);

    // The widget's own state took the digits — .value alone proves a paint,
    // nothing more. And where the spinbutton exposes the number, it must be
    // OUR number: "5" for "05" is fine (it strips the pad), May-for-December
    // is not.
    const ariaAgrees = (el, want) => {
        const now = el?.getAttribute?.('aria-valuenow');
        return now == null || parseInt(now, 10) === parseInt(want, 10);
    };
    if (!committed(yearEl) || (!single && month && monthEl && monthEl !== yearEl && !committed(monthEl))) {
        return { ok: false, reason: 'value painted but never committed' };
    }
    // (Split sections only — a combined MM/YYYY input's aria text is the whole
    // date and no single number can agree with it.)
    if (!single && (!ariaAgrees(yearEl, year) || (month && monthEl !== yearEl && !ariaAgrees(monthEl, month)))) {
        return { ok: false, reason: 'committed a different value' };
    }
    // Delta verification: an error that was live before must be gone; a field
    // that never showed one only needs the value present. (Measured on mdlz:
    // a real commit clears the inputAlert immediately, no Continue needed.)
    if (errorsBefore > 0 && errorsIn() > 0) return { ok: false, reason: 'value shown but error persists' };
    return { ok: true };
}

/**
 * What a CV entry says about how the employment ENDED. Three states, and the
 * difference is a claim on a real application:
 *   CURRENT — the CV says so explicitly ("Present", "Hiện tại", is_current).
 *             Only this state may tick "I currently work here".
 *   DATED   — a real end date to fill.
 *   MISSING — the parse simply has nothing. NOT the same as current: ticking
 *             the box here would assert an employment the CV never claimed.
 *             This is a user gap — name it and leave it.
 */
function classifyEmploymentEnd(exp) {
    if (exp?.is_current === true || exp?.current === true) return { kind: 'CURRENT' };
    const raw = String(exp?.end_date || '').trim();
    if (/^(present|current|now|hiện tại|nay)$/i.test(raw)) return { kind: 'CURRENT' };
    if (/\b(19|20)\d{2}\b/.test(raw)) return { kind: 'DATED', value: raw };
    return { kind: 'MISSING' };
}

/**
 * Honorific from the profile's own gender (user decision 2026-08-04, measured
 * on PwC: "Prefix" is a REQUIRED dropdown in Legal Name). Derived data, not
 * invented: an empty gender derives nothing and the field stays a named gap —
 * the one honest answer when the honorific cannot be known.
 */
function prefixLadder(gender) {
    const g = String(gender || '').trim().toLowerCase();
    if (/^(m|male|nam|anh|ông)$/.test(g)) return ['Mr.', 'Mr', 'Ông', 'Anh'];
    if (/^(f|female|nữ|nu|chị|bà)$/.test(g)) return ['Ms.', 'Ms', 'Chị', 'Bà', 'Mrs.'];
    return [];
}

/** The gender option itself, when the profile states one — tenants ask it as
 *  an administrative fact (PwC: required in My Information). The candidate's
 *  own stated value outranks declining; declines remain the fallback rungs. */
function genderLadder(gender) {
    const g = String(gender || '').trim().toLowerCase();
    if (/^(m|male|nam)$/.test(g)) return ['Male', 'Nam', 'Man'];
    if (/^(f|female|nữ|nu)$/.test(g)) return ['Female', 'Nữ', 'Woman'];
    return [];
}

/** Proficiency order, highest first — ladders slice DOWNWARD from the
 *  candidate's own level so a fallback can never claim above it. */
const LANG_LEVELS = ['Native', 'Fluent', 'Advanced', 'Intermediate', 'Beginner'];
export function levelLadder(level) {
    const i = LANG_LEVELS.findIndex(l => l.toLowerCase() === String(level || '').trim().toLowerCase());
    return i >= 0 ? LANG_LEVELS.slice(i) : LANG_LEVELS.slice(1);   // unknown level → Fluent-down, never Native
}

/** Language names as VN CVs actually write them — in a Skills line, a summary
 *  sentence, anywhere. Programming-language homographs (Go, R) stay out. */
const LANG_KEYWORDS = [
    ['English', /\benglish\b|tiếng anh/i],
    ['Chinese', /\bchinese\b|mandarin|tiếng trung|tiếng hoa/i],
    ['Japanese', /\bjapanese\b|tiếng nhật/i],
    ['Korean', /\bkorean\b|tiếng hàn/i],
    ['French', /\bfrench\b|tiếng pháp/i],
    ['German', /\bgerman\b|tiếng đức/i],
    ['Spanish', /\bspanish\b|tiếng tây ban nha/i],
    ['Vietnamese', /\bvietnamese\b|tiếng việt/i],
];

/** A certificate inside ONE text segment → {language, level, evidence}|null. */
function certLevel(seg) {
    let m;
    if ((m = seg.match(/IELTS[^0-9]{0,10}([4-9](?:\.\d)?)/i))) {
        const b = parseFloat(m[1]);
        return { language: 'English', level: b >= 7 ? 'Fluent' : b >= 5.5 ? 'Advanced' : 'Intermediate', evidence: `IELTS ${m[1]}` };
    }
    if ((m = seg.match(/TOEFL[^0-9]{0,10}(\d{2,3})/i))) {
        const s = parseInt(m[1], 10);
        return { language: 'English', level: s >= 100 ? 'Fluent' : s >= 80 ? 'Advanced' : 'Intermediate', evidence: `TOEFL ${m[1]}` };
    }
    if ((m = seg.match(/TOEIC[^0-9]{0,10}(\d{3})/i))) {
        const s = parseInt(m[1], 10);
        return { language: 'English', level: s >= 900 ? 'Fluent' : s >= 750 ? 'Advanced' : 'Intermediate', evidence: `TOEIC ${m[1]}` };
    }
    if ((m = seg.match(/HSK\s*[- ]?([1-6])/i))) {
        const n = parseInt(m[1], 10);
        return { language: 'Chinese', level: n >= 5 ? 'Fluent' : n >= 3 ? 'Intermediate' : 'Beginner', evidence: `HSK ${m[1]}` };
    }
    if ((m = seg.match(/JLPT\s*[- ]?N([1-5])/i))
        || (/japan|nhật/i.test(seg) && (m = seg.match(/\bN([1-5])\b/)))) {
        const n = parseInt(m[1], 10);
        return { language: 'Japanese', level: n === 1 ? 'Fluent' : n === 2 ? 'Advanced' : n === 3 ? 'Intermediate' : 'Beginner', evidence: `JLPT N${m[1]}` };
    }
    if ((m = seg.match(/TOPIK\s*[- ]?([1-6])/i))) {
        const n = parseInt(m[1], 10);
        return { language: 'Korean', level: n >= 5 ? 'Fluent' : n >= 3 ? 'Intermediate' : 'Beginner', evidence: `TOPIK ${m[1]}` };
    }
    if ((m = seg.match(/\b(DELF|DALF)\s*[- ]?([ABC][12])\b/i))) {
        const lvl = m[2].toUpperCase();
        return { language: 'French', level: /C[12]/.test(lvl) ? 'Fluent' : lvl === 'B2' ? 'Advanced' : 'Intermediate', evidence: `${m[1].toUpperCase()} ${lvl}` };
    }
    return null;
}

/** An explicit level word / CEFR grade inside one segment. */
function statedLevel(seg) {
    let m;
    if ((m = seg.match(/\b([ABC][12])\b/))) {
        const g = m[1].toUpperCase();
        return { level: /C[12]/.test(g) ? 'Fluent' : g === 'B2' ? 'Advanced' : g === 'B1' ? 'Intermediate' : 'Beginner', evidence: `CEFR ${g}` };
    }
    if (/native|bản ngữ|mother tongue/i.test(seg)) return { level: 'Native', evidence: 'stated' };
    if (/fluent|thành thạo|lưu loát/i.test(seg)) return { level: 'Fluent', evidence: 'stated' };
    if (/advanced|nâng cao/i.test(seg)) return { level: 'Advanced', evidence: 'stated' };
    if (/intermediate|trung cấp/i.test(seg)) return { level: 'Intermediate', evidence: 'stated' };
    if (/basic|beginner|elementary|cơ bản|sơ cấp/i.test(seg)) return { level: 'Beginner', evidence: 'stated' };
    return null;
}

/**
 * Languages EXTRACTED from wherever the CV actually put them. Most VN CVs
 * have no Languages section — "English (IELTS 7.5)" sits in the Skills line,
 * "JLPT N3" under certificates. Per SEGMENT (a skills token, a certificate
 * name, a summary sentence): certificate mapping beats a stated word, a bare
 * language mention claims only Intermediate (listed = usable, nothing more),
 * bare Vietnamese is the mother tongue. Every row carries its evidence.
 */
function deriveLanguages(cv, profile) {
    const skillsText = Array.isArray(cv?.skills) ? cv.skills.join(', ') : String(cv?.skills || '');
    const segs = [
        ...splitSkillList(skillsText),
        ...splitSkillList(String(profile?.skills || '')),
        ...(cv?.certifications || []).map(c => `${c.name || ''} ${c.issuer || ''}`),
        ...String(cv?.summary || '').split(/[\n.]+/).slice(0, 8),
    ];
    const out = [];
    for (const s of segs) {
        const seg = String(s || '');
        if (!seg.trim()) continue;
        const cert = certLevel(seg);
        const kw = LANG_KEYWORDS.find(([, re]) => re.test(seg));
        const language = (kw && kw[0]) || cert?.language;
        if (!language || out.some(l => l.language === language)) continue;
        const stated = statedLevel(seg);
        const level = cert?.level || stated?.level
            || (language === 'Vietnamese' ? 'Native' : 'Intermediate');
        out.push({ language, level, evidence: cert?.evidence || stated?.evidence || 'listed in skills' });
    }
    // A CV WRITTEN in English is itself evidence of English: a page of fluent
    // professional prose is a stronger claim than a keyword would be. Advanced,
    // not Fluent — the step up needs a score (IELTS/TOEFL), which upgrades it
    // via the certificate branch above when present.
    if (!out.some(l => l.language === 'English')) {
        const sample = [cv?.summary, ...(cv?.experience || []).map(e => e.description)]
            .filter(Boolean).join(' ').slice(0, 800);
        const viChars = (sample.match(/[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]/gi) || []).length;
        if (sample.length > 250 && viChars < 5) {
            out.push({ language: 'English', level: 'Advanced', evidence: 'CV written in English' });
        }
    }
    return out;
}

/**
 * One entry per language, whatever the CV called it.
 *
 * The derive step already refuses to add a language the CV's own section names,
 * but nothing deduped that section against ITSELF — and CVs write the same
 * language twice all the time: "Vietnamese" beside "Tiếng Việt", "English"
 * beside "English (IELTS 7.5)". Every entry got a row, and Workday refuses the
 * whole step: "Duplicate language entries are not allowed."
 *
 * Folded by language, not by string. Vietnamese and English are named
 * explicitly because their two spellings share no substring; everything else
 * folds on the bare name, so a parenthesised score or a dashed certificate
 * cannot claim a row of its own. Where two entries fold together the one that
 * states a level wins — that is the entry with something to say.
 */
export function dedupeLanguages(langs) {
    const canon = (name) => {
        const s = String(name || '').trim().toLowerCase();
        if (/vietnamese|tiếng việt|tieng viet/.test(s)) return 'vietnamese';
        if (/english|tiếng anh|tieng anh/.test(s)) return 'english';
        return s.replace(/[(（].*$/, '').replace(/[-–—:,].*$/, '').replace(/\s+/g, ' ').trim();
    };
    const byName = new Map();
    for (const l of langs || []) {
        const k = canon(l?.language);
        if (!k) continue;
        const prev = byName.get(k);
        if (!prev || (!prev.level && l.level)) byName.set(k, l);
    }
    return [...byName.values()];
}

/**
 * The per-row Delete control of a repeating section, given any field in the row.
 *
 * Workday renders one per panel; tenants disagree about the automation id and
 * about whether it is labelled or icon-only, so this asks the question three
 * ways and takes the first answer INSIDE the row's own panel. Scoping matters
 * more than matching: a delete button found outside the panel belongs to a
 * different row, and pressing it removes the wrong entry.
 */
function rowDeleteButton(fieldWrap) {
    const panel = fieldWrap?.closest?.(
        '[data-automation-id="panelSet-Item"], [data-automation-id^="panelSet"], li, fieldset, section');
    if (!panel) return null;
    const vis = (e) => !!(e && e.offsetParent !== null);
    const byId = [...panel.querySelectorAll('[data-automation-id*="elete"]')].filter(vis)
        .find(b => b.tagName === 'BUTTON' || b.getAttribute('role') === 'button');
    if (byId) return byId;
    return [...panel.querySelectorAll('button, [role="button"]')].filter(vis).find(b => {
        const t = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.trim().toLowerCase();
        return /^delete\b|^remove\b|^xo[áa]\b/.test(t);
    }) || null;
}

/**
 * Remove language rows that cannot validate: duplicates, and blanks past what
 * the CV needs.
 *
 * Filling more carefully does not fix a section that is ALREADY wrong — Workday
 * refuses the whole step on "Duplicate language entries are not allowed", and a
 * blank row is a required Language* nobody can answer. Whatever produced them
 * (an earlier build that over-grew the section, two passes racing each other,
 * the candidate's own half-finished edit), the only move that lets the step
 * advance is to take them out.
 *
 * Conservative by construction: the FIRST row holding a given language always
 * stays, only later copies go. A row holding a language the CV never mentioned
 * is left alone — the candidate may have added it themselves, and deleting
 * someone's own answer is worse than leaving a row we did not plan.
 */
async function pruneLanguageRows(wantRows, outcomes) {
    const vis = (e) => !!(e && e.offsetParent !== null);
    const wraps = () => [...document.querySelectorAll('[data-automation-id="formField-language"]')].filter(vis);
    const valueOf = (w) => {
        const btn = w.querySelector('button[aria-haspopup="listbox"], button');
        const t = String(btn?.textContent || w.querySelector('input')?.value || '').trim();
        return /^select one$|^$/i.test(t) ? '' : t;
    };
    if (wraps().length < 2) return;

    let removed = 0;
    for (let guard = 0; guard < 4; guard++) {
        const rows = wraps();
        const seen = new Set();
        let victim = null; let why = '';
        for (const w of rows) {
            const v = valueOf(w).toLowerCase();
            if (v) {
                // First occurrence keeps the language; a second one is the row
                // the form is complaining about.
                if (seen.has(v)) { victim = w; why = `duplicate "${valueOf(w)}"`; break; }
                seen.add(v);
            }
        }
        // No duplicate left — drop blanks only while there are more rows than the
        // CV has languages. A blank row inside the wanted count is about to be
        // filled, not surplus.
        if (!victim && rows.length > Math.max(1, wantRows)) {
            const blank = [...rows].reverse().find(w => !valueOf(w));
            if (blank) { victim = blank; why = 'surplus blank row'; }
        }
        if (!victim) break;

        const del = rowDeleteButton(victim);
        if (!del) {
            trace('lang.prune', { action: why, result: 'no delete control on the row' });
            outcomes.push(['Languages (prune)', 'FAIL', `${why} — no delete control`]);
            break;
        }
        const before = rows.length;
        if (!safeActivate(del, { source: 'recipe', activation: 'page-action' }, '[lang-row-delete]')) {
            trace('lang.prune', { action: why, result: 'policy-denied' });
            break;
        }
        const by = Date.now() + 3000;
        while (wraps().length >= before && Date.now() < by) await sleep(150);
        if (wraps().length >= before) {
            // The click did nothing. Stop rather than hammering a control that
            // is not the one — repeated presses on the wrong button is how a row
            // the candidate wanted disappears.
            trace('lang.prune', { action: why, result: 'row count unchanged — giving up' });
            break;
        }
        removed++;
        trace('lang.prune', { action: why, result: 'removed', rowsLeft: wraps().length });
    }
    if (removed) {
        outcomes.push(['Languages (prune)', 'OK', `removed ${removed} row(s)`]);
        console.warn(`[Copo Recipe] dọn ${removed} dòng Languages thừa/trùng`);
    }
}

/**
 * EVERY language the CV names, each row consistent with itself.
 *
 * Two measured defects: the Languages schema was single-row (English with an
 * IELTS score never appeared), and the per-row "I am fluent in this language."
 * checkbox was SKIPPED by the non-boolean guard while Overall said "3 -
 * Fluent" — a review page answering No and Fluent about the same language.
 * Skipping is not neutral once the form shows two answers that contradict.
 * The tick is derived from the row's own level: Native/Fluent/Advanced → Yes;
 * lower levels leave it untouched.
 */
/** Every language the candidate can claim, deduped: the CV's own section,
 *  the certificate/skills derivations, and the VN-market Vietnamese/Native
 *  rule. One list feeding EVERY language-shaped widget — rows, checkbox
 *  groups, whatever a tenant renders. */
function collectLanguages(cv, profile) {
    const langs = [...(cv?.languages || [])];
    // Skills lines, certificates and the summary are proficiency statements:
    // append every language they prove that the CV never gave its own section.
    for (const d of deriveLanguages(cv, profile)) {
        if (!langs.some(l => String(l.language || '').toLowerCase() === d.language.toLowerCase())) {
            langs.push(d);
            trace('lang.derived', { language: d.language, level: d.level, evidence: d.evidence });
        }
    }
    // VN-market hardcode (user decision 2026-08-03): every candidate is a
    // native Vietnamese speaker — the product serves the Vietnamese market.
    // The Vietnamese row always exists and never sits below Native, whatever
    // the CV wrote. This retires the old nationality/phone/province
    // heuristic, which only fired when the CV named no language at all — so
    // a CV whose English was derived silently LOST its Vietnamese.
    const viRow = langs.find(l => /vietnamese|tiếng việt/i.test(String(l.language || '')));
    if (viRow) viRow.level = 'Native';
    else {
        langs.push({ language: 'Vietnamese', level: 'Native' });
        trace('lang.derived', { language: 'Vietnamese', level: 'Native', evidence: 'VN-market default' });
    }
    const deduped = dedupeLanguages(langs);
    if (deduped.length !== langs.length) {
        trace('lang.dedup', {
            before: langs.map(l => l.language).join(', '),
            after: deduped.map(l => l.language).join(', '),
        });
    }
    return deduped;
}

/**
 * The checkbox-GROUP shape of the same question (measured on Unilever:
 * "What languages do you speak?*", ~30 boxes, REQUIRED) — not a select, not
 * a lone checkbox, so every existing layer politely skipped it: the needs
 * boolean guard refuses a "Vietnamese" routed at a checkbox (correctly), and
 * free-answer is select-only. Tick exactly the languages the candidate can
 * claim; every tick is verified off the real input.
 */
async function fillLanguageCheckboxGroup(cv, outcomes, profile) {
    const legends = [...document.querySelectorAll('fieldset, [data-automation-id^="formField-"]')]
        .filter(w => w.offsetParent !== null)
        .filter(w => /what languages|languages (do you|you) speak|ngôn ngữ.*(nói|sử dụng)/i
            .test((w.querySelector('legend, label')?.textContent || '')));
    const group = legends.find(w => w.querySelectorAll('input[type="checkbox"]').length >= 3);
    if (!group) return 0;
    const langs = collectLanguages(cv, profile).map(l => String(l.language || '').trim().toLowerCase()).filter(Boolean);
    if (!langs.length) return 0;
    const boxes = [...group.querySelectorAll('input[type="checkbox"]')].filter(b => b.offsetParent !== null);
    const labelOf = (b) => ((b.id && group.querySelector(`label[for="${CSS.escape(b.id)}"]`)?.textContent)
        || b.closest('label')?.textContent || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
    let filled = 0;
    for (const b of boxes) {
        const lbl = labelOf(b);
        if (!lbl || !langs.includes(lbl)) continue;
        if (b.checked) { outcomes.push([`Language ✓ ${lbl}`, 'done', 'already ticked']); continue; }
        if (!safeActivate(b, { source: 'recipe', activation: 'widget-option' }, 'language-checkbox')) continue;
        await sleep(200);
        let on = b.checked;
        if (!on) {
            const alt = (b.id && group.querySelector(`label[for="${CSS.escape(b.id)}"]`)) || b.closest('label');
            if (alt && safeActivate(alt, { source: 'recipe', activation: 'widget-option' }, 'language-checkbox')) {
                await sleep(250);
                on = b.checked;
            }
        }
        trace('lang.groupTick', { language: lbl, on });
        if (on) { filled++; outcomes.push([`Language ✓ ${lbl}`, 'OK', 'ticked']); }
        else outcomes.push([`Language ✓ ${lbl}`, 'FAIL', 'tick did not take']);
    }
    return filled;
}

async function fillLanguageRows(cv, outcomes, profile) {
    const langs = collectLanguages(cv, profile);
    const vis = (e) => !!(e && e.offsetParent !== null);
    const langWraps = () => [...document.querySelectorAll('[data-automation-id="formField-language"]')].filter(vis);
    if (!langWraps().length) return 0;

    // Pair rows to languages by CONTENT, not by index. A row that already
    // names a language keeps it — and keeps its CV level, so Overall and the
    // fluency tick stay consistent with what the row actually says. An empty
    // row takes the next unclaimed language. Index pairing would duplicate
    // English the moment an earlier pass had committed row one and the
    // hardcoded Vietnamese shifted every later entry by one.
    const rowValue = (w) => {
        const btn = w.querySelector('button[aria-haspopup="listbox"], button');
        const t = String(btn?.textContent || w.querySelector('input')?.value || '').trim();
        return /^select one$|^$/i.test(t) ? '' : t;
    };
    const buildPlans = () => {
        const remaining = [...langs];
        const plans = new Map();   // row wrapper → its language entry
        for (const w of langWraps()) {
            const v = rowValue(w).toLowerCase();
            if (!v) continue;
            const k = remaining.findIndex(l => {
                const name = String(l.language || '').toLowerCase();
                return v.includes(name) || name.includes(v);
            });
            // A committed row the CV knows keeps its level. A language the user
            // picked themselves is not ours to grade: level null skips Overall
            // and the tick for that row.
            plans.set(w, k >= 0 ? remaining.splice(k, 1)[0] : { language: rowValue(w), level: null });
        }
        return { plans, remaining };
    };

    // ── GROW ONLY WHEN THERE IS NOWHERE TO PUT THE NEXT LANGUAGE ──
    //
    // This loop used to read `remaining` ONCE, before it started, and never
    // recompute it — and `buildPlans` skips empty rows entirely (`if (!v)
    // continue`), so a blank row already on the page counted for nothing. A CV
    // with a single language therefore kept clicking Add against a condition
    // that could not change, until it hit the cap: three rows for one language.
    //
    // Those spare blanks are what the duplicate came out of. Each is a row the
    // form marks Language*, and each looked to the next pass like somewhere to
    // put an unclaimed language.
    //
    // The question is capacity, not row count: how many languages still have no
    // home, versus how many rows are free to take one. Recomputed every
    // iteration so the row just added is counted.
    const freeRowCount = () => langWraps().filter(w => !rowValue(w)).length;
    const growGuard = 5;
    for (let g = 0; g < growGuard; g++) {
        const { remaining: unplaced } = buildPlans();
        const need = unplaced.length - freeRowCount();
        if (need <= 0) break;                       // a blank row is already waiting
        if (langWraps().length >= 3) break;         // cap
        const btn = sectionAddButton('Languages');
        if (!btn) break;
        if (!safeActivate(btn, { source: 'recipe', activation: 'page-action' }, '[data-automation-id="add-button"]')) break;
        const had = langWraps().length;
        const by = Date.now() + 4000;
        while (langWraps().length <= had && Date.now() < by) await sleep(200);
        if (langWraps().length <= had) break;       // click added nothing — don't spin
        trace('section.addRow', {
            section: 'Languages', rows: langWraps().length,
            unplaced: unplaced.length, free: freeRowCount(), want: Math.min(langs.length, 3),
        });
    }

    // Whatever the cause — an earlier build's over-growing, two passes racing, a
    // half-finished manual edit — a section that already carries duplicate or
    // surplus rows will not validate, and no amount of careful filling fixes it.
    // Clean it before filling.
    await pruneLanguageRows(langs.length, outcomes);

    const scope = sectionScope('Languages');
    const inScope = scope ? scope.inSection : () => true;
    const overallWraps = () => [...document.querySelectorAll('[data-automation-id^="formField-"]')].filter(vis).filter(inScope)
        .filter(w => {
            const lbl = (w.querySelector('legend, label')?.textContent || '').toLowerCase();
            return lbl.includes('overall') && !/overall result|gpa/.test(lbl);
        });
    const fluentBoxes = () => [...document.querySelectorAll('input[type="checkbox"]')].filter(vis).filter(inScope)
        .filter(c => /fluent in this language|thành thạo/i.test(
            `${c.closest('[data-automation-id^="formField-"]')?.querySelector('legend, label')?.textContent || ''} ${c.getAttribute('aria-label') || ''}`));

    let filled = 0;
    // Rebuilt AFTER growing: adding a row can re-render the section, and a
    // plan keyed to a replaced node would silently drop its row.
    // Rebuilt after growing AND after pruning — both change the row set, and a
    // plan keyed to a node either of them replaced would silently drop its row.
    const rebuilt = buildPlans();
    const plans = rebuilt.plans;
    const remaining = rebuilt.remaining;
    const rows = langWraps();
    for (let i = 0; i < rows.length; i++) {
        const wrap = rows[i];
        // The row's own claim first; an empty row draws the next unclaimed
        // language; a leftover empty row (form has more rows than the CV has
        // languages) is simply left alone.
        const L = plans.get(wrap) || (rowValue(wrap) ? null : remaining.shift());
        if (!L?.language) continue;
        if (!rowValue(wrap)) {
            // Element-precise targeting: tag the row so fillCustomSelect's
            // selector resolution cannot drift to another row's first match.
            wrap.setAttribute('data-copo-row', `lang${i}`);
            const rLang = await fillCustomSelect(
                { label: `Language (row ${i + 1})`, selector: `[data-copo-row="lang${i}"] button, [data-copo-row="lang${i}"] input`, type: 'custom-select' },
                L.language, { profile: {}, cv });
            wrap.removeAttribute('data-copo-row');
            if (rLang.ok) { filled++; outcomes.push([`Language (row ${i + 1})`, 'OK', L.language]); }
            else if (rLang.reason !== 'already-selected') outcomes.push([`Language (row ${i + 1})`, 'FAIL', rLang.reason]);
        }

        const ow = overallWraps()[i];
        if (ow && L.level) {
            ow.setAttribute('data-copo-row', `oa${i}`);
            // Ladder slices DOWN from the row's own level — an Advanced speaker
            // whose tenant offers no "Advanced" row falls to Intermediate,
            // never up to Native.
            const rLvl = await fillCustomSelect(
                { label: `Overall (row ${i + 1})`, selector: `[data-copo-row="oa${i}"] button, [data-copo-row="oa${i}"] input`, valuePriority: levelLadder(L.level), type: 'custom-select' },
                L.level, { profile: {}, cv });
            ow.removeAttribute('data-copo-row');
            if (rLvl.ok) { filled++; outcomes.push([`Overall (row ${i + 1})`, 'OK', String(rLvl.matched || L.level)]); }
            else if (rLvl.reason !== 'already-selected') outcomes.push([`Overall (row ${i + 1})`, 'FAIL', rLvl.reason]);
        }

        // The fluency tick, derived from the level — never contradicting the
        // Overall answer beside it.
        if (/native|fluent|advanced/i.test(String(L.level || ''))) {
            const box = fluentBoxes()[i];
            if (box && !box.checked) {
                safeActivate(box, { source: 'recipe', activation: 'widget-option' }, 'fluent-language');
                await sleep(250);
                if (box.checked) { filled++; outcomes.push([`Fluent (row ${i + 1})`, 'OK', 'ticked']); }
                else outcomes.push([`Fluent (row ${i + 1})`, 'FAIL', 'tick did not take']);
            }
        }
    }
    return filled;
}

/**
 * End dates for EVERY work-experience row, not just the recipe's row one.
 *
 * "Use My Last Application" restores several Work Experience rows with their
 * end dates blank, and the recipe's Work To only addresses the FIRST
 * formField-endDate — measured: a run where everything else was filled ended
 * NEED_HUMAN over three empty "To" fields the CV had answers for. Rows are
 * matched to CV entries BY JOB TITLE (never by position: restored rows aren't
 * guaranteed the CV's order, and a misattributed date is a false statement on
 * a real application). Per row, classifyEmploymentEnd decides: CURRENT → tick
 * "I currently work here" (then VERIFY the To inputs actually stood down);
 * DATED → fill month/year; MISSING → a user gap, named in the trace, never
 * papered over with a current-employment claim.
 */
async function fillExperienceEndDates(cv, outcomes) {
    const exp = cv?.experience || [];
    if (!exp.length) return 0;
    const visible = (sel) => [...document.querySelectorAll(sel)].filter(el => el.offsetParent !== null);
    const endWraps = visible('[data-automation-id="formField-endDate"]');
    if (!endWraps.length) return 0;
    const titleInputs = visible('[data-automation-id="formField-jobTitle"] input');
    const currentBoxes = visible('input[type="checkbox"]').filter(c => {
        const w = c.closest('[data-automation-id^="formField-"]');
        const txt = `${w?.querySelector('legend, label')?.textContent || ''} ${c.getAttribute('aria-label') || ''}`;
        return /currently work here|đang làm việc/i.test(txt);
    });
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    let filled = 0;
    for (let i = 0; i < endWraps.length; i++) {
        const wrap = endWraps[i];
        const inputs = [...wrap.querySelectorAll('input')].filter(x => x.offsetParent !== null);
        const yearEl = inputs.find(x => /year/i.test(`${x.getAttribute('data-automation-id') || ''} ${x.getAttribute('aria-label') || ''}`)) || inputs[1];
        if (!yearEl || String(yearEl.value || '').trim()) continue;   // filled → not ours to touch
        const rowTitle = norm(titleInputs[i]?.value);
        const match = rowTitle ? exp.find(e => {
            const t = norm(e.title);
            return t && (t === rowTitle || t.includes(rowTitle) || rowTitle.includes(t));
        }) : null;
        if (!match) {
            trace('exp.endDate', { row: i, title: rowTitle.slice(0, 30) || '(no title)', verdict: 'no CV row matched — left for review' });
            continue;
        }
        const endState = classifyEmploymentEnd(match);
        if (endState.kind === 'MISSING') {
            // Not ours to guess: no explicit "Present" means ticking the box
            // would claim an employment the CV never stated.
            trace('exp.endDate', { row: i, title: rowTitle.slice(0, 30), verdict: 'end date MISSING in CV — user gap, left for review' });
            outcomes.push([`Work To (row ${i + 1})`, 'skip', 'end date missing in CV — needs user']);
            continue;
        }
        if (endState.kind === 'CURRENT') {
            // Index pairing is only a candidate — the PROOF is structural below.
            const box = currentBoxes.length === endWraps.length ? currentBoxes[i] : null;
            if (!box) {
                trace('exp.endDate', { row: i, title: rowTitle.slice(0, 30), verdict: `current role but checkbox pairing ambiguous (${currentBoxes.length} boxes / ${endWraps.length} rows)` });
                outcomes.push([`Work To (row ${i + 1})`, 'FAIL', 'currently-work-here checkbox not found for this row']);
                continue;
            }
            // Same-row proof: the nearest ancestor holding BOTH the checkbox and
            // this To wrapper must contain exactly ONE endDate field. A page has
            // many checkboxes (preferred name, consent, other rows) — a claim of
            // current employment must never land outside its own row.
            let rowScope = box.parentElement;
            while (rowScope && rowScope !== document.body && !rowScope.contains(wrap)) rowScope = rowScope.parentElement;
            const rowLocal = !!rowScope && rowScope !== document.body
                && rowScope.querySelectorAll('[data-automation-id="formField-endDate"]').length === 1;
            if (!rowLocal) {
                trace('exp.endDate', { row: i, title: rowTitle.slice(0, 30), verdict: 'checkbox and To wrapper share no single-row container — refusing to tick' });
                outcomes.push([`Work To (row ${i + 1})`, 'FAIL', 'row pairing unverified']);
                continue;
            }
            // Postcondition, read as DELTAS. "Checkbox checked" proves the DOM
            // moved, not that Workday accepted a current employment — measured:
            // checked=true with the To inputs still live was reported OK. And a
            // tenant may stand the requirement down ANY of three ways (disable/
            // hide the inputs, drop required, clear the error), so each signal
            // is compared to its own BEFORE. Error idiom = the observer's own.
            const readTo = () => {
                const ins = [...wrap.querySelectorAll('input')].filter(x => !x.disabled && x.offsetParent !== null);
                return {
                    active: ins.length,
                    required: ins.some(x => x.required || x.getAttribute('aria-required') === 'true'),
                    errors: rowScope.querySelectorAll(FIELD_ERROR_SEL).length,
                };
            };
            const before0 = readTo();
            const satisfied = () => {
                const s = readTo();
                return !s.active
                    || (before0.required && !s.required)
                    || (before0.errors > 0 && s.errors === 0);
            };
            const wasChecked = box.checked;
            if (wasChecked && satisfied()) {
                outcomes.push([`Work To (row ${i + 1})`, 'done', 'current role already committed']);
                continue;
            }
            // Escalation ladder — after EVERY rung the postcondition is re-read;
            // "the checkbox looks ticked" never ends the ladder by itself.
            const settle = async (ms) => { await sleep(ms); return box.checked && satisfied(); };
            let okNow = false;
            if (!box.checked) {
                safeActivate(box, { source: 'recipe', activation: 'widget-option' }, 'currently-work-here');
                okNow = await settle(500);
            }
            if (!okNow && box.checked) {
                // The DOM ticked but Workday didn't react — nudge the framework:
                // change + blur are what a real interaction would have fired.
                try { box.dispatchEvent(new Event('change', { bubbles: true })); box.blur?.(); } catch { /* noop */ }
                okNow = await settle(600);
            }
            if (!okNow) {
                const label = (box.id && rowScope.querySelector(`label[for="${box.id}"]`)) || box.closest('label');
                if (label) { safeActivate(label, { source: 'recipe', activation: 'widget-option' }, 'currently-work-here'); okNow = await settle(500); }
            }
            if (!okNow && box.checked && !satisfied()) {
                // Last resort, tightly guarded: DOM checked + requirement still
                // live + row proven → one off→on cycle to resync Workday's state
                // with the DOM. Never toggled blindly per iteration.
                safeActivate(box, { source: 'recipe', activation: 'widget-option' }, 'currently-work-here');
                await sleep(300);
                if (!box.checked) {
                    safeActivate(box, { source: 'recipe', activation: 'widget-option' }, 'currently-work-here');
                    okNow = await settle(600);
                }
            }
            const after0 = readTo();
            trace('exp.endDate', {
                row: i, title: rowTitle.slice(0, 30),
                checkboxAid: box.getAttribute('data-automation-id') || box.id || box.tagName,
                rowLocal,
                checked: box.checked,
                requiredBefore: before0.required, requiredAfter: after0.required,
                activeBefore: before0.active, activeAfter: after0.active,
                errorsBefore: before0.errors, errorsAfter: after0.errors,
                verdict: !box.checked ? 'tick did not take'
                    : okNow ? 'current-role committed'
                    : 'PARTIAL — checked but To requirement did not stand down',
            });
            if (!box.checked) outcomes.push([`Work To (row ${i + 1})`, 'FAIL', 'tick did not take']);
            else if (okNow) { filled++; outcomes.push([`Work To (row ${i + 1})`, 'OK', 'currently work here']); }
            else outcomes.push([`Work To (row ${i + 1})`, 'PARTIAL', 'checked but end-date still required']);
            continue;
        }
        const r = await setDateOnWrap(wrap, endState.value);
        trace('exp.endDate', { row: i, title: rowTitle.slice(0, 30), value: endState.value.slice(0, 16), verdict: r.ok ? 'filled' : r.reason });
        if (r.ok) { filled++; outcomes.push([`Work To (row ${i + 1})`, 'OK', endState.value.slice(0, 16)]); }
        else if (r.reason !== 'already-selected') outcomes.push([`Work To (row ${i + 1})`, 'FAIL', r.reason]);
    }
    return filled;
}

/** The formField WRAPPER whose legend/label contains `want` — findFieldByLabel
 *  returns the first control inside, which is not enough for a split date. */
function findWrapperByLabel(want) {
    const w = String(want).toLowerCase();
    for (const wrap of document.querySelectorAll('[data-automation-id^="formField-"]')) {
        if (wrap.offsetParent === null) continue;
        const lbl = (wrap.querySelector('legend, label')?.textContent || '').toLowerCase();
        if (lbl.includes(w)) return wrap;
    }
    return null;
}

/**
 * Pick one option in a radio group.
 *
 * The recipe had no radio support at all, which is why My Information stalled:
 * Mondelez marks "Have you previously worked for this organization?" REQUIRED,
 * and it is a radio group. The recipe filled the other eleven required fields,
 * left that one untouched, and the advance is withheld while anything required
 * is empty — so the step sat there with nothing to show for it.
 *
 * Three things this does NOT do, each learned from a real defect:
 *   · It does not set `.checked` directly. An earlier version did, and it also
 *     dispatched `change` and reported success even when the policy had refused
 *     the click — a refusal that silently became a mutation.
 *   · It does not match by substring alone. "No" is a substring of "Not
 *     applicable" and of "None of the above", so an exact label match wins first
 *     and a substring only counts when exactly one option has it.
 *   · It does not report success on a click that did not take. Workday's radios
 *     sit under overlays; the only proof is re-reading `checked` afterwards.
 */
function fillRadio(f, val) {
    const wrap = document.querySelector(f.selector);
    if (!wrap) return { ok: false, reason: 'group-absent' };
    const radios = [...wrap.querySelectorAll('input[type="radio"]')].filter(r => r.offsetParent !== null);
    if (!radios.length) return { ok: false, reason: 'group-absent' };

    const labelOf = (r) => {
        const byFor = r.id ? wrap.querySelector(`label[for="${CSS.escape(r.id)}"]`) : null;
        return ((byFor || r.closest('label'))?.textContent || '').replace(/\s+/g, ' ').trim();
    };
    const want = String(val).trim().toLowerCase();
    if (radios.some(r => r.checked && labelOf(r).toLowerCase() === want)) {
        return { ok: false, reason: 'already-selected' };
    }
    const exact = radios.filter(r => labelOf(r).toLowerCase() === want);
    const loose = radios.filter(r => labelOf(r).toLowerCase().includes(want));
    const target = exact[0] || (loose.length === 1 ? loose[0] : null);
    if (!target) return { ok: false, reason: `no unique option for "${val}"` };

    if (!safeActivate(target, { source: 'recipe', activation: 'widget-option' }, f.selector)) {
        return { ok: false, reason: 'policy-denied' };
    }
    return target.checked ? { ok: true } : { ok: false, reason: 'click did not select it' };
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
/**
 * Values a field will accept at all.
 *
 * A degree dropdown lists QUALIFICATIONS — B.S., B.B.A., L.L.B. — and CVs
 * routinely write the SUBJECT on the same line, so `highestDegree` arrives as
 * "Marketing". Searching a qualification list for a subject cannot succeed, and
 * the failure is expensive: ten seconds of paging per iteration, every
 * iteration, before reporting option-not-found.
 *
 * The web app was taught the same rule, but that runs at SYNC time — a profile
 * synced before it shipped still says "Marketing", and telling the user to
 * re-sync is not a fix. Checking here makes it independent of that.
 */
const ACCEPTS = {
    qualification: /bachelor|master|doctor|phd|associate|diploma|certificate|high school|\bb\.?[sae]\b|\bm\.?[sa]\b|mba|llb|cử nhân|thạc sĩ|tiến sĩ|kỹ sư|cao đẳng|trung cấp/i,
};

function recipeFieldValue(f, profile, cv) {
    // A fixed `value` is the recipe author's literal choice — never rewritten.
    if (f.value != null && f.value !== '') return f.value;
    const gate = f.accept ? ACCEPTS[f.accept] : null;
    // A value the field cannot possibly take is worse than none: empty leaves a
    // gap the review names, where a wrong one buys a doomed search.
    const shape = (v) => {
        const out = f.normalize === 'name' ? normalizeNameCase(v) : v;
        if (gate && !gate.test(String(out))) return null;
        return out;
    };
    const p = profile?.[f.profileKey];
    if (p != null && String(p).trim() !== '') {
        const v = shape(p);
        if (v != null) return v;
    }
    const fromCv = readCvPath(cv, f.cvPath);
    if (fromCv != null && String(fromCv).trim() !== '') {
        const v = shape(String(fromCv));
        if (v != null) return v;
    }
    // Another profile key as the LAST resort before empty — user decision
    // 2026-08-03: a CV that only names its city ("Hà Nội") still answers the
    // street/district boxes with that city rather than stalling the run on a
    // required field the candidate has no finer answer for.
    if (f.fallbackProfileKey) {
        const fb = profile?.[f.fallbackProfileKey];
        if (fb != null && String(fb).trim() !== '') {
            const v = shape(fb);
            if (v != null) return v;
        }
    }
    return f.default ?? '';
}

/**
 * The element a recipe field addresses: measured selector FIRST, label as the
 * FALLBACK, preferring whichever hit is visible. Tenants drift automation ids
 * (mdlz names the school box formField-schoolName; Visa does not) — a field
 * declaring BOTH must not lose its measured id just because a label was added
 * for resilience, and must not sit "absent" when only the id drifted.
 */
function resolveFieldControl(f) {
    const vis = (el) => !!(el && el.offsetParent !== null);
    const sel = f.selector ? document.querySelector(f.selector) : null;
    if (vis(sel)) return sel;
    const lab = f.labelMatch ? findFieldByLabel(f.labelMatch, f.labelDeny) : null;
    return vis(lab) ? lab : (sel || lab);
}

/** Resolve a dynamic-id field (e.g. Workday Application Questions, whose formField
 *  ids are per-job) by matching its question/label text. Returns the textarea /
 *  input / button inside the first matching formField wrapper. */
function findFieldByLabel(labelMatch, labelDeny) {
    const want = String(labelMatch).toLowerCase();
    // A substring is ambiguous the day a tenant adds a second field carrying
    // it — measured: labelMatch 'overall' (the language proficiency) landed on
    // "Overall Result (GPA)", a text box, and the proficiency fill spent its
    // listbox timeout clicking it. `labelDeny` names what the field is NOT.
    const deny = labelDeny ? new RegExp(labelDeny, 'i') : null;
    for (const wrap of document.querySelectorAll('[data-automation-id^="formField-"]')) {
        const lbl = (wrap.querySelector('legend, label')?.textContent || '').toLowerCase();
        if (!lbl.includes(want)) continue;
        if (deny && deny.test(lbl)) continue;
        return wrap.querySelector('textarea, input:not([type="hidden"]), button');
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
/**
 * Ask the model which of THESE options the candidate's education means.
 *
 * Vietnamese qualifications do not line up with the list an international ATS
 * offers: a CV says "Cử nhân Marketing" or just "Marketing", and the dropdown
 * offers B.S. / B.B.A. / L.L.B. and sixteen more. No string rule bridges that —
 * matching "Bachelor" hits eleven of them, and picking the first is inventing a
 * discipline the candidate never claimed.
 *
 * So the choice is made by the model, constrained three ways: it may only answer
 * with an option the page is actually offering, it is given the education rather
 * than asked to guess, and a reply that is not on the list is discarded. The
 * agent-plan route already receives `credentials` (education + languages) for
 * exactly this inference, so this needs no new endpoint.
 */
async function inferOptionViaLLM(f, options, profile, cv) {
    const offered = [...new Set(options.map(o => String(o).trim()).filter(Boolean))].slice(0, 60);
    if (offered.length < 2) return null;
    try {
        const plan = await callAgentPlan(
            {
                url: location.href,
                formFields: [{
                    label: f.label,
                    selector: f.selector,
                    required: true,
                    componentType: 'custom-select',
                    value: '',
                    options: offered.map(t => ({ value: t, text: t })),
                }],
                buttons: [], errors: [], blockers: [], unfilledRequired: [f.label],
            },
            profile,
            [],
            false,
            {
                education: (cv?.education || []).slice(0, 4),
                languages: (cv?.languages || []).slice(0, 4),
            },
        );
        const raw = (plan?.instructions || [])
            .map(i => i && (i.value ?? i.text))
            .find(v => v != null && String(v).trim() !== '');
        const chosen = raw == null ? '' : String(raw).trim();
        // Only an option the page offers. A model answering "Bachelor's Degree"
        // when no such row exists must not become a search for one. But EXACT
        // equality was too brittle for long catalogue rows — measured on Visa:
        // the model answered "Bachelor's or Equivalent First-Degree (I…"
        // (truncated, straight apostrophe) against "Bachelor's or Equivalent
        // First-Degree (ISCED …)" (curly apostrophe) and a correct choice was
        // discarded. Normalise quotes/whitespace, then accept a reply that
        // UNAMBIGUOUSLY identifies one row: equal, prefix either way, or
        // contained — a single distinct hit only.
        const nrm = (s) => String(s).toLowerCase()
            .replace(/[‘’`]/g, "'").replace(/\s+/g, ' ').trim();
        const c = nrm(chosen);
        let match = offered.find(o => nrm(o) === c) || null;
        if (!match && c.length >= 4) {
            const hits = offered.filter(o => {
                const t = nrm(o);
                return t.startsWith(c) || c.startsWith(t) || t.includes(c);
            });
            if (new Set(hits.map(nrm)).size === 1) match = hits[0];
        }
        trace('list.infer', { field: f.label, asked: offered.length, replied: chosen.slice(0, 40), accepted: !!match });
        return {
            value: match || null,
            why: match ? 'ok'
                : chosen ? `model answered "${chosen.slice(0, 30)}" which is not on the list`
                    : 'model returned no value',
        };
    } catch (e) {
        // The reason matters more than the failure. An expired token and a model
        // that answered off-list are both "no degree", and only one of them is
        // fixed by re-syncing the app.
        const why = (e && e.message) || 'failed';
        trace('list.infer', { field: f.label, error: why });
        // An expired token is not this field's problem — it disables EVERY
        // inference and every planner call for the whole run, and reading it as
        // "Degree not found" sends the next hour into the wrong file. Say what it
        // is and what fixes it.
        if (/hết hạn|expired|401|unauthor/i.test(why)) {
            return { value: null, authExpired: true, why: 'ĐĂNG NHẬP HẾT HẠN — mở Copo và đồng bộ lại' };
        }
        return { value: null, why: `inference failed: ${why.slice(0, 60)}` };
    }
}

// One generated message per field per page load. The recipe loop re-runs every
// iteration and is meant to be idempotent, but an LLM call is neither free nor
// deterministic — without this, a form that takes eight passes to validate would
// write (and bill for) eight different notes and fill the last one.
const _generated = new Map();

/**
 * The role and employer out of a browser tab title.
 *
 * The <title> is the one thing every ATS fills correctly, and it is
 * conventionally "<role> - <company>", often with a flow word bolted on:
 * SmartRecruiters serves "Easy apply - [EMC] Embedded Android Developer (01
 * Year Contact) - Bosch Group" (measured on a live Bosch posting). Dropping the
 * flow words matters — "Easy apply" as the job title produces a message
 * applying for a job called Easy apply.
 *
 * Exported for the tests: the extension's suite has no DOM, so the parsing is
 * separated from the reading.
 */
export function parseDocumentTitle(raw) {
    const s = String(raw || '').trim();
    const parts = s.split(/\s+[-–—|]\s+/).map(p => p.trim()).filter(Boolean);
    const drop = /^(easy )?apply( now| for this job)?$|^application( form)?$|^careers?$|^jobs?$|^job (details?|description)$|^ứng tuyển$|^tuyển dụng$/i;
    const kept = parts.filter(p => !drop.test(p));
    if (!kept.length) return { title: '', company: '' };
    return {
        title: kept[0],
        // Only when there is something left BESIDE the title — a one-part title
        // is the role, and calling it the company too would put the job's own
        // name where the employer belongs.
        company: kept.length > 1 ? kept[kept.length - 1] : '',
    };
}

/**
 * What this page says the job IS — the grounding for a written message.
 *
 * Deliberately page-derived rather than passed in. The applies that reach this
 * code are the ones the web app did NOT dispatch (no queue entry, no parsed JD,
 * no match score); what the tab is showing is the only job context that exists.
 * On a job ad that is the whole posting; on a bare apply form it is little more
 * than the title, which is why the message prompt is built to lean on the CV and
 * forbidden to invent anything about the employer.
 */
function collectJobContext() {
    const { title, company } = parseDocumentTitle(document.title);

    // Visible prose, minus the form itself — on an ad page this is the JD; on
    // the form page it collapses to nearly nothing, which the caller checks.
    let description = '';
    try {
        const main = document.querySelector('main, [role="main"], article') || document.body;
        const clone = main.cloneNode(true);
        clone.querySelectorAll('input, select, textarea, button, script, style, svg, nav, header, footer').forEach(n => n.remove());
        description = (clone.innerText || '').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000);
    } catch (e) { /* a page that won't clone still has a title */ }

    return { title, company, description };
}

/** Vietnamese by diacritic density — mirrors frontend/src/lib/jd-lang.ts. */
function detectLang(text) {
    const s = String(text || '');
    const vi = (s.match(/[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/gi) || []).length;
    const letters = (s.match(/[a-zăâđêôơư]/gi) || []).length;
    return letters > 0 && vi / letters > 0.02 ? 'vi' : 'en';
}

/**
 * Write the note for a free-text "message to the hiring team" box.
 *
 * Returns null — leaving the box empty — whenever it cannot do this honestly:
 * no CV to draw claims from, no readable job title to address, or the call
 * failed. Every one of those is a better outcome than filling an OPTIONAL field
 * with filler, because the text goes out on a real application under the
 * candidate's name and cannot be taken back.
 */
async function generateMessageViaLLM(f, cv) {
    const key = `${f.label}@${location.pathname}`;
    if (_generated.has(key)) return _generated.get(key);
    _generated.set(key, null);   // claim the slot BEFORE awaiting: two passes can overlap

    if (!cv || !(cv.experience?.length || cv.skills?.length || cv.summary)) {
        trace('message.generate', { field: f.label, skipped: 'no CV' });
        return null;
    }
    const job = collectJobContext();
    if (!job.title || job.title.length < 3) {
        trace('message.generate', { field: f.label, skipped: 'no job title on page' });
        return null;
    }
    try {
        const lang = detectLang(`${job.title} ${job.description.slice(0, 2000)}`);
        const res = await callApplyMessage(job, cv, lang);
        const text = String(res?.coverLetter || '').trim();
        if (!text) {
            trace('message.generate', { field: f.label, error: 'empty reply' });
            return null;
        }
        _generated.set(key, text);
        trace('message.generate', { field: f.label, lang, words: text.split(/\s+/).length, job: job.title.slice(0, 50) });
        return text;
    } catch (e) {
        const why = (e && e.message) || 'failed';
        trace('message.generate', { field: f.label, error: why.slice(0, 80) });
        return null;
    }
}

/**
 * Which search result — if any — is the skill the candidate wrote?
 *
 * Split out from the DOM work because this is the part that can put a claim on a
 * real application. An employer's skills taxonomy is theirs, not the candidate's:
 * typing "SQL" can return SQL, SQL Server, MySQL and PL/SQL, and three of those
 * are things the candidate never said. So an exact label wins, a partial match
 * counts only when every result says the SAME thing, and anything else resolves
 * to nothing — the skill is dropped rather than approximated.
 *
 * `label` is injected so the rule can be exercised without a DOM.
 */
export function pickSearchResult(results, term, label = (r) => String(r)) {
    const want = String(term || '').trim().toLowerCase();
    if (!want || !results?.length) return null;
    const txt = (r) => label(r).trim().toLowerCase();
    const exact = results.filter(r => txt(r) === want);
    if (exact.length) return exact[0];
    const near = results.filter(r => txt(r).includes(want));
    if (!near.length) return null;
    // Several DIFFERENT labels contain the term → we cannot tell which was meant.
    return new Set(near.map(txt)).size === 1 ? near[0] : null;
}

/**
 * Split a skills string without cutting a skill in half.
 *
 * A plain `split(',')` broke "unit economics (CPI, CAC, LTV)" into three pieces
 * and one of them — "CAC" — was found in the employer's taxonomy and ADDED. A
 * fragment of a phrase became a claim on a real application, which is worse than
 * having skipped the skill entirely.
 *
 * So separators inside brackets do not separate. Everything else does.
 */
export function splitSkillList(value) {
    const text = String(value ?? '');
    const out = [];
    let buf = '';
    let depth = 0;
    for (const ch of text) {
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
        if (depth === 0 && (ch === ',' || ch === ';' || ch === '|')) { out.push(buf); buf = ''; continue; }
        buf += ch;
    }
    out.push(buf);
    return out.map(v => v.trim()).filter(Boolean);
}

/**
 * The narrower forms of a compound skill, best first.
 *
 * An employer's taxonomy carries "Agile" and "Scrum" but often not
 * "Agile/Scrum", and a slash is the candidate naming two things rather than one.
 * Only tried after the whole phrase has failed, so an exact entry always wins.
 */
export function skillFallbacks(term) {
    const t = String(term || '').trim();
    const out = [];
    // "Agile/Scrum" → Agile, Scrum. Not applied to dates or fractions.
    if (/[a-z]\s*\/\s*[a-z]/i.test(t)) out.push(...t.split('/').map(v => v.trim()));
    // "unit economics (CPI, CAC, LTV)" → the phrase without its parenthetical.
    const bare = t.replace(/[（(\[][^）)\]]*[）)\]]/g, ' ').replace(/\s+/g, ' ').trim();
    if (bare && bare !== t) out.push(bare);
    return [...new Set(out.filter(v => v && v !== t && v.length > 1))];
}

/**
 * Wait for a search to finish, not merely to start.
 *
 * The obvious rule — wait until the rendered rows CHANGE — is wrong, and was the
 * bug behind half the skills coming back "found it, clicked it, nothing
 * happened". After Enter the list goes stale → empty/loading → results, so the
 * first change is usually the EMPTY state. Matching there finds nothing, or worse
 * finds a leftover row belonging to the previous term and clicks something that
 * is no longer part of any list.
 *
 * So: wait for the rows to be non-empty AND unchanged across two consecutive
 * reads. A search that genuinely returns nothing settles on empty and the caller
 * reports no-match, which is a real answer rather than an artefact of reading too
 * early.
 */
async function waitForResults(readKey, budgetMs = 4000, priorKey = null) {
    // A short budget is a "let it go quiet" call rather than "wait for an
    // answer", so it must be allowed to settle on empty without burning the
    // whole window.
    const emptyStableNeeded = budgetMs <= 2500 ? 2 : 4;
    const deadline = Date.now() + budgetMs;
    let last = null;
    let stable = 0;
    while (Date.now() < deadline) {
        await sleep(180);
        const now = readKey();
        // The PREVIOUS term's results are stable too. Returning on "non-empty and
        // unchanged" handed those straight back — the caller matched a row from
        // the last search, clicked something no longer in any list, and reported
        // no-effect. A list identical to the one before the search started has not
        // answered yet, whatever its size.
        const isStale = priorKey != null && now.key === priorKey && now.rows > 0;
        if (last && now.key === last.key && !isStale) {
            stable++;
            // Non-empty and steady → the search has answered.
            if (stable >= 2 && now.rows > 0) return now;
            // Empty and steady for longer → it answered with nothing.
            if (stable >= emptyStableNeeded) return now;
        } else {
            stable = 0;
            last = now;
        }
    }
    return last;
}

/**
 * Fill a type-to-search multi-select: Workday's Skills field.
 *
 * It refuses free text. Typing "SQL" and moving on leaves the box empty — the
 * value only exists once a SEARCH RESULT is clicked, and the results only appear
 * after typing. So each value is its own small transaction: type, wait for the
 * list, pick the row that matches, confirm a chip appeared, clear the box, next.
 *
 * Values that return no match are skipped rather than forced. A skills taxonomy
 * is the employer's, not the candidate's — "Figma" may simply not be in it, and
 * inventing the nearest-looking entry puts a claim on the application that the
 * candidate never made.
 */
async function fillSearchMulti(f, value, ctx = {}) {
    const wrap = (f.selector && document.querySelector(f.selector)?.closest('[data-automation-id^="formField-"]'))
        || (f.labelMatch ? findWrapperByLabel(f.labelMatch) : null);
    if (!wrap) return { ok: false, reason: 'field-absent' };
    const input = wrap.querySelector('input[type="text"], input:not([type])');
    if (!input || input.offsetParent === null) return { ok: false, reason: 'no search box' };

    const chips = () => [...wrap.querySelectorAll('[data-automation-id="selectedItem"]')]
        .map(c => (c.textContent || '').replace(/\s*×\s*/g, '').trim()).filter(Boolean);
    const wanted = splitSkillList(value).slice(0, f.max || 8);
    if (!wanted.length) return { ok: false, reason: 'no value' };

    // A stale popup from the previous field misreads as this field's results, and
    // text a crashed pass left in the box corrupts the first query — clear both.
    await closeStrayPopups(f.label);
    if (String(input.value || '').trim()) {
        setNativeValue(input, '', { quiet: true });
        await sleep(250);
    }

    // Signature of what the results list currently shows, so "has it settled?"
    // is a question about the ROWS rather than about elapsed time.
    const readResultKey = () => {
        const rows = [...document.querySelectorAll(OPTION_SEL)]
            .filter(o => o.offsetParent !== null)
            .filter(o => o.getAttribute('data-automation-id') !== 'selectedItem')
            .filter(o => !o.closest('[data-automation-id="selectedItemList"]'))
            .map(o => (o.textContent || '').trim())
            .filter(t => t && !/^no items\.?$/i.test(t));
        return { rows: rows.length, key: rows.join('|'), toString() { return this.key; } };
    };


    /**
     * Empty the box and let the widget go quiet before the next term.
     *
     * Clearing and typing straight on was the remaining race: the next search
     * fires while the previous one is still settling, so its results arrive
     * against the wrong query — and the term after that reads rows belonging to
     * the term before. Waiting for the list to fall back to empty is what makes
     * each skill an independent transaction rather than a queue of overlapping
     * ones.
     */
    const resetSearchBox = async () => {
        setNativeValue(input, '', { quiet: true });
        await sleep(200);
        await waitForResults(readResultKey, 2000);
    };

    let added = 0;
    const notes = [];
    for (const term of wanted) {
        if (chips().some(c => c.toLowerCase() === term.toLowerCase())) { notes.push(`${term}:already`); continue; }
        const before = chips().length;
        const priorResults = readResultKey().key;
        await simulateTyping(input, term);
        // ENTER is what runs the search. Typing alone leaves the list showing
        // "No Items." no matter what the term is — I read that as an empty
        // taxonomy and was wrong: the query had simply never been submitted.
        // A search box that needs a keystroke to fire is not the same as a
        // search box with nothing behind it.
        for (const type of ['keydown', 'keypress', 'keyup']) {
            input.dispatchEvent(new KeyboardEvent(type, {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                bubbles: true, cancelable: true, composed: true,
            }));
        }
        let settled = await waitForResults(readResultKey, 6000, priorResults);
        // A slow skillsearch answers AFTER the budget: reading then sees an empty
        // or stale list, and a skill that IS in the taxonomy reports :no-match —
        // measured live, terms that committed in one run no-matched in the next
        // purely on server latency. One more Enter re-runs the same search, so
        // retry once before concluding anything from an unanswered list.
        if (!settled || !settled.rows || settled.key === priorResults) {
            for (const type of ['keydown', 'keypress', 'keyup']) {
                input.dispatchEvent(new KeyboardEvent(type, {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                    bubbles: true, cancelable: true, composed: true,
                }));
            }
            settled = await waitForResults(readResultKey, 4000, priorResults);
        }
        const opts = [...document.querySelectorAll(OPTION_SEL)]
            .filter(o => o.offsetParent !== null)
            .filter(o => o.getAttribute('data-automation-id') !== 'selectedItem')
            .filter(o => !o.closest('[data-automation-id="selectedItemList"]'));
        // Match on the WHOLE result set, not the rendered window.
        //
        // These results scroll: the exact row can sit below the fold, and judging
        // ambiguity from a partial view is worse than missing it — three visible
        // near-matches read as "cannot tell" while the exact one waits offscreen.
        // The widget's own item array gives the full list when it can be read; a
        // paged walk covers the rest.
        let pick = pickSearchResult(opts, term, o => (o.textContent || '').trim());
        if (!pick && opts.length) {
            const sc = optionScroller(opts[0]);
            const all = sc ? readVirtualItems(sc) : null;
            if (all) {
                const chosen = pickSearchResult(all, term, it => String(it.label ?? it.ariaLabel ?? ''));
                if (chosen) {
                    trace('skills.offscreen', { term, index: chosen.index, total: all.length });
                    const rowHeight = virtualRowHeight(sc);
                    const at = Number.isFinite(chosen.index) ? chosen.index : all.indexOf(chosen);
                    if (rowHeight) {
                        // Same selectedItem filter as every other candidate list here:
                        // an already-selected row got through this one and clicking it
                        // DESELECTS (policy denies it as destructive, wasting the pass).
                        pick = await jumpToIndex(sc, () => [...document.querySelectorAll(OPTION_SEL)]
                            .filter(o => o.offsetParent !== null)
                            .filter(o => o.getAttribute('data-automation-id') !== 'selectedItem')
                            .filter(o => !o.closest('[data-automation-id="selectedItemList"]')),
                        (list) => pickSearchResult(list, String(chosen.label ?? ''), o => (o.textContent || '').trim()),
                        at, rowHeight, `Skills:${term}`);
                    }
                }
            }
            // No item array (not virtualised) — walk the list instead.
            if (!pick && sc) {
                pick = await findInList(
                    () => [...document.querySelectorAll(OPTION_SEL)]
                        .filter(o => o.offsetParent !== null)
                        .filter(o => o.getAttribute('data-automation-id') !== 'selectedItem')
                        .filter(o => !o.closest('[data-automation-id="selectedItemList"]')),
                    (list) => pickSearchResult(list, term, o => (o.textContent || '').trim()),
                    `Skills:${term}`, term);
            }
        }
        // The whole phrase is not in the taxonomy — try the narrower forms the
        // candidate actually named. "Agile/Scrum" is two skills written as one, and
        // an employer list carries them separately. Only after the exact phrase has
        // failed, so a real entry always wins.
        if (!pick) {
            for (const alt of skillFallbacks(term)) {
                await resetSearchBox();
                const priorAlt = readResultKey().key;
                await simulateTyping(input, alt);
                for (const type of ['keydown', 'keypress', 'keyup']) {
                    input.dispatchEvent(new KeyboardEvent(type, {
                        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                        bubbles: true, cancelable: true, composed: true,
                    }));
                }
                // Same patience as the main search. This path read the list after a
                // FIXED 1.2s — the one place still racing the server — so a slow
                // answer made every fallback look absent from the taxonomy.
                await waitForResults(readResultKey, 6000, priorAlt);
                const retryOpts = [...document.querySelectorAll(OPTION_SEL)]
                    .filter(o => o.offsetParent !== null)
                    .filter(o => o.getAttribute('data-automation-id') !== 'selectedItem')
                    .filter(o => !o.closest('[data-automation-id="selectedItemList"]'));
                pick = pickSearchResult(retryOpts, alt, o => (o.textContent || '').trim());
                if (pick) { notes.push(`${term}→${alt}`); break; }
            }
        }
        if (!pick) { notes.push(`${term}:no-match`); await resetSearchBox(); continue; }
        // A row that is ALREADY committed must not be clicked — that deselects it.
        // The results list marks committed skills as selectedItem/checked while it
        // still shows the previous query's rows, so a loose match can land on one
        // (measured: "Backlog Prioritization", denied by policy as destructive).
        // Only signals of a COMMITTED pick count here. NOT aria-selected: Workday
        // puts aria-selected="true" on the row the keyboard cursor is merely
        // resting on — measured: "LLM Orchestration", unchecked and chip-less,
        // was skipped as :already because it was the highlighted first result.
        const pickSelected = pick.getAttribute('data-automation-id') === 'selectedItem'
            || pick.getAttribute('aria-checked') === 'true'
            || !!pick.querySelector('input[type="checkbox"]:checked, input[type="radio"]:checked');
        if (pickSelected) { notes.push(`${term}:already-on-list`); await resetSearchBox(); continue; }
        // Try each plausible target and keep the one that takes.
        //
        // A result row nests a styled checkbox, a leaf node and a label, and which
        // of them owns the handler is not visible from the markup — measured:
        // "Product Roadmapping" matched exactly, the row highlighted, the checkbox
        // stayed empty and no chip appeared, while two other skills committed on
        // the same code path. Clicking the input directly is a guess, and it was
        // the wrong one often enough to lose skills silently.
        const targets = [
            pick.querySelector('[data-automation-id="promptLeafNode"]'),
            pick.querySelector('input[type="checkbox"], input[type="radio"]'),
            pick.querySelector('label'),
            pick,
        ].filter((el, i, arr) => el && arr.indexOf(el) === i);
        // Clear of the sticky footer first. With several chips committed the
        // results list sits lower, and a row's click point can land under the
        // page's "Back / Save and Continue" bar — measured: "AI Workflow Design"
        // and "Agentic Systems" matched exactly, every click reported an
        // unrelated overlay at the point, and no chip appeared.
        try { pick.scrollIntoView({ block: 'center' }); await sleep(150); } catch { /* noop */ }
        const deadline = Date.now() + 2500;
        for (const target of targets) {
            safeActivate(target, { source: 'recipe', activation: 'widget-option' }, f.selector || f.labelMatch);
            const tryBy = Date.now() + 900;
            while (Date.now() < tryBy && chips().length === before) await sleep(120);
            if (chips().length > before) break;
        }
        while (Date.now() < deadline && chips().length === before) await sleep(150);
        // Coordinates failed → drive Workday's own keyboard path: ArrowDown until
        // the ACTIVE row (aria-activedescendant) is the exact match, then Enter.
        // No geometry involved, so no overlay can eat it — and Enter fires only
        // on an exact text match, so it can never commit a neighbouring row.
        let viaKeyboard = false;
        if (chips().length === before) {
            const wantTxt = (pick.textContent || '').trim().toLowerCase();
            const activeRow = () => {
                for (const h of [input, ...document.querySelectorAll('[aria-activedescendant]')]) {
                    const id = h?.getAttribute?.('aria-activedescendant');
                    const el = id && document.getElementById(id);
                    if (el && el.offsetParent !== null) return el;
                }
                return null;
            };
            const press = (key, kc) => {
                for (const type of ['keydown', 'keyup']) {
                    input.dispatchEvent(new KeyboardEvent(type, {
                        key, code: key, keyCode: kc, which: kc,
                        bubbles: true, cancelable: true, composed: true,
                    }));
                }
            };
            try { input.focus(); } catch { /* noop */ }
            const seenActive = new Set();
            for (let stepN = 0; stepN < 24 && chips().length === before; stepN++) {
                const row = activeRow();
                if (row && (row.textContent || '').trim().toLowerCase() === wantTxt) {
                    press('Enter', 13);
                    const by = Date.now() + 2000;
                    while (Date.now() < by && chips().length === before) await sleep(120);
                    break;
                }
                if (!row && stepN > 2) break;               // widget has no active-row idiom
                if (row) {
                    if (seenActive.has(row.id)) break;      // cycled the whole list
                    seenActive.add(row.id);
                }
                press('ArrowDown', 40);
                await sleep(150);
            }
            viaKeyboard = chips().length > before;
            if (viaKeyboard) trace('skills.keyboardCommit', { term });
        }
        if (chips().length > before) { added++; notes.push(`${term}:${viaKeyboard ? 'ok-kb' : 'ok'}`); } else {
            notes.push(`${term}:no-effect`);
            // WHICH row was clicked, and what was on offer. "Found it and the click
            // did nothing" is the same sentence whether the row was the right one,
            // a stale leftover from the previous term's search, or a header that
            // merely contains the words — and those need different fixes.
            trace('skills.noEffect', {
                term,
                triedTargets: targets.map(t => t.getAttribute?.('data-automation-id') || t.tagName).join(' → '),
                clickedText: (pick.textContent || '').trim().slice(0, 40),
                clickedAid: pick.getAttribute('data-automation-id') || pick.tagName,
                hitWasInner: targets[0] !== pick,
                resultsOnScreen: opts.length,
                offered: [...new Set(opts.map(o => (o.textContent || '').trim()))].slice(0, 6).join(' | '),
            });
        }
        await resetSearchBox();
    }
    trace('skills.fill', { field: f.label, wanted: wanted.length, added, detail: notes.join(', ') });
    // Three separate claims, not one boolean: SATISFIED (the field needs no
    // further pass), CHANGED (this pass added something). Overloading ok:true
    // for both would count an untouched-but-complete field as progress every
    // iteration — filled++ forever — and ok:false counted it as a failure.
    // Workday keeps skills on the CANDIDATE, so a later application arrives
    // with every chip already committed (measured: all 8 terms :already on a
    // fresh job, reported as FAILED). Only an actionable miss — a row that
    // would not take — leaves the field unsatisfied; not-in-taxonomy terms are
    // the employer's catalogue, not our failure.
    const already = notes.filter(n => /:already(-on-list)?$/.test(n)).length;
    const noMatch = notes.filter(n => n.endsWith(':no-match')).length;
    if (added > 0) return { satisfied: true, changed: true, added, already };
    if (notes.length && already + noMatch === notes.length) {
        if (noMatch === notes.length) return { satisfied: false, changed: false, emptyTaxonomy: true, reason: `nothing committed (${notes.join(', ')})` };
        return { satisfied: true, changed: false, added: 0, already, reason: 'already-selected' };
    }
    return { satisfied: false, changed: false, reason: `unresolved (${notes.join(', ')})` };
}

/**
 * The ONE-ACTION select shape: a native <select> has no popup to open and no
 * option nodes to hunt — choose, fire change, read back. Measured on P&G,
 * where the source question is a plain <select> and the prompt path spent its
 * whole open-timeout waiting for a listbox that never exists. Same ladder,
 * same matching discipline: exact, then unambiguous prefix, then unambiguous
 * substring — and an anchored '=' rung never reaches the substring tier.
 */
function fillNativeSelect(sel, f, value) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const options = [...sel.options]
        .filter(o => norm(o.textContent) && !/^select one$|^-+$/.test(norm(o.textContent)));
    const current = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
    if (current && String(current.value || '').trim() !== ''
        && norm(current.textContent) && norm(current.textContent) !== 'select one') {
        return { ok: false, reason: 'already-selected' };
    }
    const ladder = [...new Set([norm(value), ...(f.valuePriority || []).map(norm)].filter(Boolean))];
    for (const rung of ladder) {
        const anchored = rung.startsWith('=');
        const w = anchored ? rung.slice(1) : rung;
        const set = (l) => new Set(l.map(o => norm(o.textContent))).size;
        let hit = options.find(o => norm(o.textContent) === w) || null;
        if (!hit) {
            const prefix = options.filter(o => norm(o.textContent).startsWith(w));
            if (prefix.length && set(prefix) === 1) hit = prefix[0];
        }
        if (!hit && !anchored) {
            const contains = options.filter(o => norm(o.textContent).includes(w));
            if (contains.length && set(contains) === 1) hit = contains[0];
        }
        if (hit) {
            setNativeValue(sel, hit.value);   // input + change + blur — the framework path
            trace('list.result', { field: f.label, picked: norm(hit.textContent), onPage: 'native-select', stuck: sel.value === hit.value });
            if (sel.value === hit.value) return { ok: true, matched: (hit.textContent || '').trim() };
            return { ok: false, reason: 'select did not take the value' };
        }
    }
    return { ok: false, reason: `option-not-found (native select, ${options.length} options, tried ${ladder.length}: ${ladder.join('/')})` };
}

async function fillCustomSelect(f, value, ctx = {}) {
    // Some prompts have no stable id at all — Workday gives the language
    // proficiency field a per-tenant GUID — so they are addressed by their label.
    const trigger = resolveFieldControl(f);
    if (!trigger || trigger.offsetParent === null) return { ok: false, reason: 'trigger-absent' };
    // The one-action shape needs none of the prompt machinery below.
    if (trigger.tagName === 'SELECT') return fillNativeSelect(trigger, f, value);
    const wrap = trigger.closest('[data-automation-id^="formField-"]');
    // A selector was measured on ONE tenant, and ids drift MEANINGS across
    // tenants: on Mondelez formField-countryRegion IS Country/Region, on
    // Unilever the same id carries "Province or City" — and filling it with
    // "vietnam" fought the province list with every escalation this executor
    // owns, which is exactly what preceded the tenant's "Something went
    // wrong" card. When the field declares a label and the wrapper shows
    // one, they must share a word; otherwise this is not our field HERE.
    if (wrap && f.label && !f.labelMatch) {
        const wl = (wrap.querySelector('legend, label')?.textContent || '').toLowerCase();
        const toks = String(f.label).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 3);
        if (wl && toks.length && !toks.some(t => wl.includes(t))) {
            trace('field.labelMismatch', { field: f.label, wrapperLabel: wl.slice(0, 40), selector: (f.selector || '').slice(0, 60) });
            return { ok: false, reason: 'trigger-absent' };
        }
    }
    // Idempotency. Three shapes, all seen in the wild:
    //   · a button-select stores the chosen option's id in the button's `value`
    //   · a multi-select lists its picks as chips in selectedItemList
    //   · a SEARCHABLE single-select (Mondelez's source/phone-code prompt) is an
    //     <input>, whose `value` attribute stays empty after a pick — its answer
    //     also lands in selectedItemList
    // Checking chips regardless of `f.multi` is what stops the search-box shape
    // from being re-answered on every pass.
    const chips = wrap?.querySelector('[data-automation-id="selectedItemList"]');
    if (chips && chips.children.length) {
        // A chip that CONTRADICTS the candidate's own data is not "already
        // answered" — it is Workday's résumé parser guessing. Measured twice:
        // the CV says "University of Illinois at Urbana-Champaign", the parse
        // committed the CHICAGO campus, and the already-selected guard then
        // protected the wrong school all the way to Review. Eviction is gated
        // three ways: the value must come from the user's own data (cvPath /
        // profileKey — never an agent-default ladder), it must be long enough
        // to judge (≥2 significant tokens), and the chip must be DECISIVELY
        // alien (missing tokens of the wanted value). Anything short of all
        // three keeps the old behaviour.
        const foldT = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/đ/g, 'd').replace(/[‘’`]/g, "'");
        const want = foldT(String(value || '').trim());
        const toks = want.split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 3);
        const chipT = foldT((chips.textContent || '').replace(/\s+/g, ' ').trim());
        const alien = (f.cvPath || f.profileKey) && toks.length >= 2 && !toks.every(k => chipT.includes(k));
        if (!alien) return { ok: false, reason: 'already-selected' };
        trace('prompt.evict', { field: f.label, chip: chipT.slice(0, 50), want: want.slice(0, 40) });
        const item = chips.querySelector('[data-automation-id="selectedItem"]') || chips.firstElementChild;
        if (!item || !safeActivate(item, { source: 'recipe', activation: 'widget-option' }, f.selector)) {
            return { ok: false, reason: 'wrong chip committed — eviction refused' };
        }
        await sleep(600);
        if (wrap.querySelector('[data-automation-id="selectedItemList"]')?.children.length) {
            return { ok: false, reason: 'wrong chip committed and would not deselect' };
        }
        // Chip gone — fall through and fill the right value.
    }
    // The value attribute counts only for BUTTON triggers. On a searchable
    // prompt's INPUT, chips are the ONLY commit signal: free text someone typed
    // (the gap-filler treated "How Did You Hear" as a plain text field) reflects
    // into the attribute via React, made this guard read the field as answered,
    // and the recipe skipped it forever while Workday kept flagging it invalid —
    // the loop then burned a 25s LLM plan per iteration on a field it owns.
    if (!f.multi && trigger.tagName !== 'INPUT' && (trigger.getAttribute('value') || '').trim()) {
        return { ok: false, reason: 'already-selected' };
    }
    // A popup another field left open would otherwise be read as OUR option list
    // below (portal-rendered lists have no formField ancestor to disown them by).
    await closeStrayPopups(f.label);
    // Uncommitted text in the search box breaks the fill twice over: Workday
    // rejects it as an answer, and the ladder below would type INTO it. Clear it
    // and VERIFY the clear took — a React-controlled input can hand the old text
    // straight back on re-render, so escalate: quiet setter → loud setter → the
    // user path (select-all + delete). The trace records which rung it took.
    if (trigger.tagName === 'INPUT' && String(trigger.value || '').trim()) {
        const beforeTxt = String(trigger.value || '').slice(0, 30);
        setNativeValue(trigger, '', { quiet: true });
        await sleep(120);
        if (String(trigger.value || '').trim()) {
            setNativeValue(trigger, '');
            await sleep(120);
        }
        if (String(trigger.value || '').trim()) {
            try {
                trigger.focus();
                trigger.select();
                document.execCommand('delete');
            } catch { /* every rung exhausted — the trace below says so */ }
            await sleep(120);
        }
        trace('prompt.clear', {
            field: f.label,
            before: beforeTxt,
            after: String(trigger.value || '').slice(0, 30),
            verified: !String(trigger.value || '').trim(),
        });
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
    // 6.5s not 4s: the Language prompt was measured taking >4s to open once on
    // Mondelez, and the shorter budget turned a slow open into listbox-timeout.
    {
        const deadline = Date.now() + 6500;
        while (!visibleOptions().length && Date.now() < deadline) await sleep(150);
        if (!visibleOptions().length) {
            // Distinguish "the widget never opened" from "it opened and the option
            // was not in it". Both surface as an unfilled required dropdown.
            trace('list.timeout', {
                field: f.label,
                trigger: trigger.tagName + (trigger.getAttribute('aria-haspopup') ? '[haspopup]' : ''),
                anyOptionsOnPage: document.querySelectorAll(OPTION_SEL).length,
                note: 'widget did not open, or its options are outside this formField',
            });
            return { ok: false, reason: 'listbox-timeout' };
        }
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
    // De-duplicated: the CV value often IS the ladder's top rung ("native" +
    // ["Native", …]) and trying it twice wasted a full type-and-search cycle.
    const ladder = [...new Set([want, ...(f.valuePriority || []).map(v => String(v).trim().toLowerCase())]
        .filter(Boolean))];

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
    /**
     * EVERY node that could be the wanted option, best first.
     *
     * Returning one node was the bug. Workday keeps several elements carrying the
     * same option text in the document at once — measured on "How Did You Hear
     * About Us?", where "Company Website" existed both inside the open popup and
     * again elsewhere — and `exact[0]` takes whichever comes first in DOM order.
     * Click the wrong one and nothing happens at all: no error, no change, and the
     * old code reported success. That is this field failing on every single run.
     *
     * Which duplicate is live cannot be decided by looking at it (they are all
     * "visible" by offsetParent), so the caller tries them in order and keeps the
     * one that actually commits. Nodes with a real box come first as the cheapest
     * useful ordering — a zero-size node is never the one the user would click.
     */
    // Diacritic/apostrophe fold, used only AFTER the raw comparison found
    // nothing. VN catalogues meet profiles typed every which way — the option
    // says "H’Mông (Vietnam)" (curly apostrophe, full diacritics) while the
    // profile says "H'Mong"; "Mường" meets "Muong". Folding both sides bridges
    // that; running it as a FALLBACK tier keeps raw-distinct lists (e.g.
    // "Thái" vs a hypothetical "Thai") resolving exactly as before.
    const fold = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\u0111/g, 'd').replace(/[\u2018\u2019\u0060]/g, "'");
    const matchAll = (list, rawWanted) => {
        // A rung written '=Other' is ANCHORED: exact or prefix only, never the
        // contains tier — "other" lives inside "another", and a substring hit
        // on "Another job board" is a wrong claim, not a fallback.
        const anchored = rawWanted.startsWith('=');
        const wanted = anchored ? rawWanted.slice(1) : rawWanted;
        const tier = (pred) => list.filter(pred);
        const wf = fold(wanted);
        let cands = tier(o => txt(o) === wanted);
        if (!cands.length) cands = tier(o => fold(txt(o)) === wf);
        if (!cands.length) {
            // A prefix/substring tier still has to be UNAMBIGUOUS as a set: many
            // DIFFERENT labels matching means we cannot tell which the user meant,
            // and "Marketing" must never resolve to "Marketing Research".
            // The prefix tier is also what accepts a country-suffixed catalogue
            // row: profile "Kinh" → the one option starting "Kinh (Vietnam)".
            const distinct = (l) => new Set(l.map(txt)).size;
            let prefix = tier(o => txt(o).startsWith(wanted));
            if (!prefix.length) prefix = tier(o => fold(txt(o)).startsWith(wf));
            if (prefix.length && distinct(prefix) === 1) cands = prefix;
            else if (!anchored) {
                let contains = tier(o => txt(o).includes(wanted));
                if (!contains.length) contains = tier(o => fold(txt(o)).includes(wf));
                if (contains.length && distinct(contains) === 1) cands = contains;
                // Wording drift on proper nouns: the CV says "University of
                // Illinois at Urbana-Champaign", a catalogue writes it without
                // the "at" — and no substring bridges that. EVERY significant
                // token must appear in the row, which is also what REJECTS the
                // wrong campus: "…at Chicago" has no urbana and no champaign
                // (measured on Visa, where exactly that school reached the
                // Review page). Single distinct hit only, like every tier.
                if (!cands.length) {
                    const toks = wf.split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 3);
                    if (toks.length >= 2) {
                        const hit = tier(o => { const t = fold(txt(o)); return toks.every(k => t.includes(k)); });
                        if (hit.length && distinct(hit) === 1) cands = hit;
                    }
                }
            }
        }
        return cands.sort((a, b) => {
            const box = (o) => { const r = o.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? 0 : 1; };
            return box(a) - box(b);
        });
    };
    const uniqueMatch = (list, wanted) => matchAll(list, wanted)[0] || null;

    let opt = null;
    let matched = '';
    let shown = visibleOptions();
    let prevSig = null;   // last round's option-list fingerprint — see list.static below
    if (filter) {
        // MATCH-FIRST, TYPE-LAST — the Unilever stack trace made it law. Our
        // per-character typing fires the widget's onChange, whose handler
        // fetches a values endpoint (/source, one request PER KEYSTROKE) and
        // reads its definition atom — and mid-initialisation that atom is
        // undefined, which is the exact TypeError storm behind "Something
        // went wrong". A human never types into these prompts: they read the
        // open list and click, and reproducing that by hand never crashed.
        // So the whole ladder is tried against what is ALREADY visible before
        // a single key is sent; typing remains only for the server-backed
        // searchbox whose list stays empty until fed.
        for (const rung of ladder) {
            const o = uniqueMatch(visibleOptions(), rung);
            if (o) { opt = o; matched = rung; break; }
        }
        // A SEARCH box shows nothing until something is typed, so each rung has to
        // be typed before it can be matched. Previously the ladder was only
        // compared against whatever happened to be on screen — which for a search
        // prompt is nothing at all, so a required field like "How Did You Hear
        // About Us?" could never be answered on tenants that render it this way.
        if (!opt) for (const wanted of ladder) {
            // CLEAR between rungs. Without this each rung types on top of the
            // last, and on a prompt that really does filter the box ends up
            // holding "nativenativefluent…" — measured on the language
            // proficiency field, which opened with three rows and reported
            // "0 shown" because the first rung, "native", is not one of them and
            // narrowed the list to nothing for every rung after it.
            setNativeValue(filter, '', { quiet: true });
            await sleep(200);
            await simulateTyping(filter, wanted.replace(/^=/, ''));   // the '=' anchors matching, it is not text
            await sleep(450);
            // Enter RUNS the search on a search-shaped filter (Field of Study:
            // typing alone leaves the 300-row catalogue unfiltered) — but on a
            // LIVE-filtering box (the source prompt) Enter COMMITS whatever row
            // is highlighted, and pressing it unconditionally turned a working
            // field into a wrong answer ("Found via Job Board"). So: press it
            // ONLY when typing surfaced nothing clickable.
            if ((filter.getAttribute('enterkeyhint') === 'search'
                    || filter.getAttribute('data-uxi-widget-type') === 'selectinput')
                && !uniqueMatch(visibleOptions(), wanted)) {
                for (const type of ['keydown', 'keypress', 'keyup']) {
                    filter.dispatchEvent(new KeyboardEvent(type, {
                        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                        bubbles: true, cancelable: true, composed: true,
                    }));
                }
                await sleep(900);
                // Enter on a live-filtering prompt can COMMIT the highlighted
                // row instead of running the search — measured on Visa:
                // searching for Urbana-Champaign Enter-committed "University
                // of Illinois at Chicago" (alphabetically first) and the wrong
                // school rode all the way to Review. A chip that appears right
                // after OUR Enter is only accepted when every significant
                // token of the wanted value is in it; an alien chip is
                // deselected on the spot and the ladder continues.
                const chip = wrap?.querySelector('[data-automation-id="selectedItemList"] [data-automation-id="selectedItem"]');
                if (chip) {
                    const chipT = fold((chip.textContent || '').trim().toLowerCase());
                    const wf2 = fold(wanted.replace(/^=/, ''));
                    const toks = wf2.split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 3);
                    const isOurs = chipT === wf2 || chipT.includes(wf2)
                        || (toks.length >= 2 && toks.every(k => chipT.includes(k)));
                    trace('prompt.enterCommit', { field: f.label, chip: chipT.slice(0, 50), wanted: wf2.slice(0, 40), accepted: isOurs });
                    if (isOurs) return { ok: true, matched: wanted.replace(/^=/, '') };
                    safeActivate(chip, { source: 'recipe', activation: 'widget-option' }, f.selector);
                    await sleep(500);
                }
            }
            shown = visibleOptions();
            // A filter that narrowed to NOTHING has hidden the answer rather than
            // found it: this prompt's rows are "1 - Beginner / 2 - Intermediate /
            // 3 - Fluent", and no rung of a proficiency ladder is a substring of
            // more than one of them. Fall back to the unfiltered list.
            if (!shown.length) {
                setNativeValue(filter, '', { quiet: true });
                await sleep(350);
                shown = visibleOptions();
            }
            // Typing does not narrow every prompt. Mondelez's Field of Study
            // takes the text and still lists all majors from "Accounting" —
            // so the typed rung has to be searched for, not just read off.
            opt = await findInList(visibleOptions, (list) => uniqueMatch(list, wanted), `${f.label}:${wanted}`, wanted);
            if (opt) { matched = wanted; break; }
            // A catalogue that IGNORES typing shows the same rows for every
            // rung — the answer is on screen now or nowhere. Two identical
            // rounds prove it: evaluate the WHOLE ladder, best rung first,
            // against what is visible and stop typing. Measured on P&G:
            // "Other" was on screen from round one, but its rung sits last,
            // so it only got its turn after eight wasted typing cycles — and
            // the field burned a full iteration before a second pass took it.
            const sig = shown.map(o => (o.textContent || '').trim()).join('¦');
            if (sig && sig === prevSig) {
                for (const rung of ladder) {
                    opt = uniqueMatch(shown, rung);
                    if (opt) { matched = rung; break; }
                }
                trace('list.static', { field: f.label, rows: shown.length, took: matched || '(nothing in ladder)' });
                break;
            }
            prevSig = sig;
        }
        // Every rung typed and nothing matched — try once against the list as it
        // stands with an empty box, in case the filter was the obstacle.
        if (!opt) {
            setNativeValue(filter, '', { quiet: true });
            await sleep(400);
            // The popup can have CLOSED mid-ladder (an Enter that surfaced
            // nothing, a stray blur) — the fallback then matched against an
            // empty page and reported option-not-found for a row that was on
            // screen a moment earlier. Reopen before concluding anything.
            if (!visibleOptions().length) {
                safeActivate(trigger, { source: 'recipe', activation: 'widget-open' }, f.selector);
                const by = Date.now() + 2500;
                while (!visibleOptions().length && Date.now() < by) await sleep(150);
            }
            for (const wanted of ladder) {
                opt = uniqueMatch(visibleOptions(), wanted);
                if (opt) { matched = wanted; break; }
            }
        }
    } else {
        // A button prompt has no typing to narrow it: what is visible IS the
        // whole catalogue. So the ladder is evaluated in ONE walk — the old
        // per-rung loop re-walked and re-opened the list up to 8×12 rounds,
        // and that storm of synthetic scrolls and toggles is what preceded
        // Workday's "Something went wrong" card on Unilever's inline
        // listboxes every time, while a single human-pattern open-and-pick
        // never reproduced it. (The filter branch got the same economy from
        // list.static; this is its no-filter twin.)
        //
        // The list can also pass the open-guard and then COLLAPSE before the
        // ladder reads it — measured on Race/Ethnicity — so one reopen, then
        // one walk.
        if (!visibleOptions().length) {
            safeActivate(trigger, { source: 'recipe', activation: 'widget-open' }, f.selector);
            const by = Date.now() + 2500;
            while (!visibleOptions().length && Date.now() < by) await sleep(150);
        }
        const anyRung = (list) => {
            for (const rung of ladder) {
                const o = uniqueMatch(list, rung);
                if (o) { matched = rung; return o; }
            }
            return null;
        };
        opt = anyRung(visibleOptions())
            || await findInList(visibleOptions, anyRung, `${f.label}:ladder`, ladder[0] || '');
        shown = visibleOptions();   // report what the LAST look saw, not the first
    }
    if (opt) opt = await revealOption(opt, visibleOptions, (list) => uniqueMatch(list, matched), f.label);
    // Nothing matched. If the field is allowed to be INFERRED, ask the model to
    // choose from the options that are on screen right now — this is the case a
    // string rule cannot serve, where a Vietnamese qualification has to be mapped
    // onto an international list that never names it.
    let inferNote = '';
    if (!opt && f.infer) {
        // Re-open BEFORE asking. The model is sent the options that are on screen,
        // and by the time the ladder has exhausted itself the list has often
        // closed — so `offered` came back empty and the call was skipped
        // entirely, reported as "inference: not attempted" beside a count of 18
        // options read moments earlier. Re-opening afterwards, which is what I
        // added last, fixes the click and not the asking.
        if (!visibleOptions().length) {
            safeActivate(trigger, { source: 'recipe', activation: 'widget-open' }, f.selector);
            const by = Date.now() + 4000;
            while (!visibleOptions().length && Date.now() < by) await sleep(150);
            trace('list.reopen', { field: f.label, why: 'closed before the model could be asked', rows: visibleOptions().length });
        }
        const r = await inferOptionViaLLM(
            f, visibleOptions().map(o => (o.textContent || '').trim()), ctx.profile, ctx.cv);
        inferNote = r?.why || 'not attempted';
        if (r?.authExpired) {
            showToast('🔑 Phiên đăng nhập Copo đã hết hạn — mở web app và đồng bộ lại, '
                + 'rồi chạy lại. AI không suy luận được trường nào cho tới lúc đó.', 12000);
        }
        // The structural belt on demographic inference: rule 21 tells the
        // model to pick ONLY the decline row, and this refuses the pick if it
        // is a substantive value anyway — the model's worst mistake collapses
        // to an empty field, never a claim about the person.
        const inferDenied = !!(r?.value && f.inferDeny && f.inferDeny.test(r.value));
        if (inferDenied) {
            trace('list.inferDenied', { field: f.label, picked: r.value.slice(0, 30), why: 'substantive value on a decline-only field' });
            inferNote = `model picked "${r.value.slice(0, 20)}" — refused (decline-only field)`;
        }
        if (r?.value && !inferDenied) {
            matched = r.value.toLowerCase();
            // RE-OPEN first. Asking the model takes seconds, and the prompt does
            // not stay open through them — measured: inference returned a valid
            // option and then every click reported no-effect at all four levels,
            // because by then there was no list to click in. The deterministic
            // path never hit this: it decides in milliseconds, with the list still
            // on screen.
            if (!visibleOptions().length) {
                trace('list.reopen', { field: f.label, why: 'prompt closed while the model was asked' });
                safeActivate(trigger, { source: 'recipe', activation: 'widget-open' }, f.selector);
                const reopenBy = Date.now() + 4000;
                while (!visibleOptions().length && Date.now() < reopenBy) await sleep(150);
            }
            opt = uniqueMatch(visibleOptions(), matched)
                || await findInList(visibleOptions, (l) => uniqueMatch(l, matched), `${f.label}:inferred`, matched);
            if (!opt) inferNote = `model chose "${r.value}" but the row could not be reached`;
        }
    }
    if (!opt) {
        trace('list.noMatch', {
            field: f.label,
            tried: ladder.join(' → '),
            shown: shown.length,
            sample: shown.slice(0, 4).map(o => (o.textContent || '').trim().slice(0, 22)).join(' | '),
            typedInto: !!filter,
        });
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); // close, don't block
        return {
            ok: false,
            reason: `option-not-found (${shown.length} shown${ladder.length ? `, tried ${ladder.length}: ${ladder.join('/')}` : ''}`
                + `${inferNote ? `; inference: ${inferNote}` : ''})`,
        };
    }
    /** What the field shows right now — a chip, or a button label that is not the
     *  placeholder. This is the ONLY evidence that a click was accepted. */
    const readCommitted = () => {
        try {
            const chips = [...wrap.querySelectorAll('[data-automation-id="selectedItem"]')];
            if (chips.length) return chips.map(c => (c.textContent || '').trim()).join(' | ');
            const t = (wrap.querySelector('button')?.textContent || '').trim();
            return t && !/select one/i.test(t) ? t : '';
        } catch { return ''; }
    };
    // Without a wrapper there is no field state to read. "Cannot tell" must not
    // become "did not work", or every widget whose selector sits outside a
    // formField breaks — so that case clicks once and trusts it, and says so.
    if (!wrap) {
        const only = opt.querySelector('input[type="radio"], input[type="checkbox"]') || opt;
        const okOnce = safeActivate(only, { source: 'recipe', activation: 'widget-option' }, f.selector);
        trace('list.result', { field: f.label, picked: matched, onPage: '(no wrapper to verify)', stuck: null });
        return okOnce ? { ok: true, matched: matched.replace(/^=/, '') } : { ok: false, reason: 'policy-denied' };
    }

    // TRY each node that carries this label, and keep whichever actually commits.
    //
    // The failure this fixes had no symptom to read: Workday keeps several elements
    // with the same option text in the document at once, only one of them wired to
    // the open popup. Clicking a dead twin does nothing — no error, no change — and
    // the code took the click as proof and moved on. "How Did You Hear About Us?"
    // failed that way on every run, reported as filled, and the page kept saying
    // the field was required.
    //
    // Inner control before the row itself: measured on Field of Study, where a
    // click on the row's centre hit-tested as the row and did nothing, while the
    // radio inside it committed on the first try.
    const before = readCommitted();

    /**
     * Wait for the field to answer, instead of assuming how long it takes.
     *
     * A fixed 250ms read here was worse than no verification at all. This widget
     * was measured at ~550ms to respond, so the read landed BEFORE the chip
     * appeared, a working click was recorded as "no-effect", and the loop moved on
     * to the next node carrying the same label — which TOGGLED OFF what the first
     * click had just selected. The field ended empty and required, while one click
     * by hand worked every time. The verification was undoing its own success.
     */
    const waitForCommit = async (budgetMs = 2500) => {
        const deadline = Date.now() + budgetMs;
        while (Date.now() < deadline) {
            const now = readCommitted();
            if (now && now !== before) return now;
            await sleep(150);
        }
        return '';
    };

    /**
     * Walk DOWN the prompt, one level per click, until the value commits.
     *
     * This prompt is a CASCADING menu, not a flat list. Level 1 shows categories,
     * each with a "›" chevron and no radio; clicking one opens level 2, which
     * carries a "‹ Company Website" breadcrumb and the real selectable row with a
     * radio in it. Only that second click commits.
     *
     * The agent clicked level 1, saw no chip — correctly, nothing was selected
     * yet — and reported failure. Then the retry loop clicked the same label
     * again, which walked back out. It never once reached the row that answers
     * the question.
     *
     * Re-matching after every click matters: the submenu renders the SAME label,
     * so the node from the previous level is stale the moment it opens.
     */
    const attempts = [];
    for (let level = 0; level < 4; level++) {
        // A field that has already answered is never clicked again — that is how
        // the retry loop used to deselect its own pick.
        const settled = readCommitted();
        if (settled && settled !== before) {
            trace('list.result', { field: f.label, picked: matched, onPage: settled, levels: level, stuck: true });
            return { ok: true, matched: matched.replace(/^=/, '') };
        }
        // A SUBMENU can be as long as the top level — "Job Board" opens onto
        // hundreds of named boards — so the row may be off-screen here exactly as
        // it can be at level 0. The scroll stack (index jump off the widget's own
        // item array, else a paged walk) belongs on every level, not just the
        // first; using a bare match inside a submenu meant anything past the first
        // rendered window read as "not there".
        // A closed list is not a missing option. Re-open before concluding
        // anything, or four clicks land on nothing and report it as the row
        // refusing them.
        if (!visibleOptions().length) {
            safeActivate(trigger, { source: 'recipe', activation: 'widget-open' }, f.selector);
            const by = Date.now() + 3000;
            while (!visibleOptions().length && Date.now() < by) await sleep(150);
            if (!visibleOptions().length) { attempts.push(`level${level}:list-closed`); break; }
        }
        let cands = matchAll(visibleOptions(), matched);
        if (!cands.length && level > 0) {
            const found = await findInList(
                visibleOptions, (list) => uniqueMatch(list, matched), `${f.label}@L${level}`, matched);
            if (found) cands = matchAll(visibleOptions(), matched);
        }
        if (!cands.length && level === 0) cands = [opt];
        if (!cands.length) { attempts.push(`level${level}:no-row`); break; }

        // Inside a submenu the wanted label appears TWICE: once on the "‹ Company
        // Website" breadcrumb that walks back OUT, and once on the row that
        // answers. The breadcrumb comes first in document order, so matching by
        // text alone picked it, went back a level, and the walk ping-ponged until
        // it ran out of levels — stuck, with the field still empty.
        //
        // The row that answers is the one carrying a radio. When any candidate has
        // one, only those are candidates.
        const withControl = cands.filter(c => c.querySelector('input[type="radio"], input[type="checkbox"]'));
        if (withControl.length) cands = withControl;
        else {
            // No radios yet — still at a category level. Drop anything that reads
            // as a way back rather than a way in.
            const isBackControl = (el) => {
                const label = (el.getAttribute('aria-label') || '').toLowerCase();
                if (/^back\b|go back|previous/.test(label)) return true;
                // Workday renders the breadcrumb inside the list's header, above
                // the scrollable option area.
                return !!el.closest('[data-automation-id="menuHeader"], header');
            };
            const forward = cands.filter(c => !isBackControl(c));
            if (forward.length) cands = forward;
        }

        const node = cands[0];
        // Innermost meaningful control first. A row nests
        // menuItem[role=option] › promptLeafNode › promptOption; the radio only
        // exists once we are deep enough to be looking at a real choice.
        const hit = node.querySelector('input[type="radio"], input[type="checkbox"]')
            || node.querySelector('[data-automation-id="promptLeafNode"]')
            || node;
        const isLeaf = !!node.querySelector('input[type="radio"], input[type="checkbox"]');
        // Clear of clipped edges before aiming (ported from the skills fill):
        // a virtualized row parked at the window's edge hit-tests as whatever
        // overlaps it, and the direct-dispatch fallback then lands on nothing.
        try { node.scrollIntoView({ block: 'center' }); await sleep(120); } catch { /* noop */ }
        const beforeRows = renderedRows(visibleOptions).join('|');
        const activated = safeActivate(hit, { source: 'recipe', activation: 'widget-option' }, f.selector);
        if (!activated) { attempts.push(`level${level}:policy-denied`); break; }

        const now = await waitForCommit(isLeaf ? 2500 : 1200);
        if (now) {
            attempts.push(`level${level}:stuck`);
            if (f.multi) {
                // A MULTI-select stays OPEN after a pick and its popup overlays the
                // page footer, swallowing the later "Next" click — the step then
                // looks stuck with the field correctly filled. Close it.
                trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                try { trigger.blur?.(); } catch { /* noop */ }
                await sleep(150);
            }
            trace('list.result', { field: f.label, picked: matched, onPage: now, levels: level + 1, stuck: true });
            return { ok: true, matched: matched.replace(/^=/, '') };
        }
        // No commit. Did the click DRILL IN instead? A changed row set means a
        // submenu opened and the next pass should match inside it.
        await sleep(350);
        const afterRows = renderedRows(visibleOptions).join('|');
        const drilled = afterRows !== beforeRows && !!visibleOptions().length;
        attempts.push(`level${level}:${drilled ? 'drilled-in' : 'no-effect'}`);
        // On no-effect, name what actually sits at the row's click point — "the
        // right row, covered by a stale popup" and "the right row, dead handler"
        // read identically without it and need different fixes.
        const covered = drilled ? null : (() => {
            try {
                const r = node.getBoundingClientRect();
                const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                if (!top || top === node || node.contains(top)) return null;
                return top.getAttribute('data-automation-id') || top.tagName;
            } catch { return null; }
        })();
        trace('list.drill', { field: f.label, level, wasLeaf: isLeaf, drilled, rows: visibleOptions().length, covered });
        if (!drilled) {
            // Nothing committed and nothing opened. Reopen once in case the click
            // merely closed the popup, then give up rather than toggling blindly.
            if (!visibleOptions().length) {
                safeActivate(trigger, { source: 'recipe', activation: 'widget-open' }, f.selector);
                await sleep(400);
                continue;
            }
            break;
        }
    }
    trace('list.result', {
        field: f.label, picked: matched, onPage: readCommitted() || '(still empty)',
        levels: attempts.length, attempts: attempts.join(', '), stuck: false,
    });
    // Every coordinate path failed — drive the widget's own KEYBOARD path
    // (ported from the skills fill, where covered/virtualized rows made clicks
    // land on nothing): ArrowDown until the ACTIVE row (aria-activedescendant)
    // is the match, then Enter. No geometry involved. Bounded small on purpose:
    // with the filter typed the list is short, and a 300-row unfiltered
    // catalogue is beyond this rung by design.
    if (matched) {
        if (!visibleOptions().length) {
            safeActivate(trigger, { source: 'recipe', activation: 'widget-open' }, f.selector);
            const by = Date.now() + 2500;
            while (!visibleOptions().length && Date.now() < by) await sleep(150);
        }
        const kb = (trigger.tagName === 'INPUT' ? trigger : null) || filter || trigger;
        const activeRow = () => {
            for (const h of [kb, ...document.querySelectorAll('[aria-activedescendant]')]) {
                const id = h?.getAttribute?.('aria-activedescendant');
                const rowEl = id && document.getElementById(id);
                if (rowEl && rowEl.offsetParent !== null) return rowEl;
            }
            return null;
        };
        const press = (key, kc) => {
            for (const type of ['keydown', 'keyup']) {
                kb.dispatchEvent(new KeyboardEvent(type, { key, code: key, keyCode: kc, which: kc, bubbles: true, cancelable: true, composed: true }));
            }
        };
        try { kb.focus(); } catch { /* noop */ }
        const seenRows = new Set();
        for (let stepN = 0; stepN < 24; stepN++) {
            const row = activeRow();
            const rowTxt = row ? txt(row) : '';
            if (row && (rowTxt === matched || fold(rowTxt) === fold(matched))) {
                press('Enter', 13);
                const now2 = await waitForCommit(2500);
                if (now2) {
                    attempts.push('keyboard:committed');
                    trace('list.result', { field: f.label, picked: matched, onPage: now2, levels: attempts.length, via: 'keyboard', stuck: true });
                    return { ok: true, matched: matched.replace(/^=/, '') };
                }
                break;
            }
            if (!row && stepN > 2) break;          // widget has no active-row idiom
            if (row) {
                if (seenRows.has(row.id)) break;    // cycled the whole list
                seenRows.add(row.id);
            }
            press('ArrowDown', 40);
            await sleep(120);
        }
        attempts.push('keyboard:no-commit');
    }
    // Leave the popup CLOSED on the way out — an abandoned list is the next
    // field's "72 options that answer a different question" (measured: Field
    // of Study's catalogue read as Language's own list one field later).
    try { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch { /* noop */ }
    return { ok: false, reason: `never committed "${matched}" (${attempts.join(', ')})` };
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
