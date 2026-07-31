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
import { trace, traceOnce } from './trace.js';

// Keep in sync with frontend/src/lib/applyRecipes.ts (WORKDAY). Fields verified
// against real 3M Workday captures (My Information, 2026-07-15 / -22). The
// custom-select handler is grounded in the captured widget markup (button[value]
// + promptOption) but PENDING a live-fill verification.
export const FALLBACK_RECIPES = [
    {
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
                    { label: 'First name', selector: '[data-automation-id="formField-legalName--firstName"] input', profileKey: 'firstName', type: 'text', required: true, normalize: 'name' },
                    { label: 'Last name', selector: '[data-automation-id="formField-legalName--lastName"] input', profileKey: 'lastName', type: 'text', required: true, normalize: 'name' },
                    // REQUIRED on Mondelez (measured), and the flat profile carries
                    // them only if the user filled them in by hand — a CV states an
                    // address but nothing extracts it into those two keys. When they
                    // were profile-only the planner hit two empty required fields
                    // and returned NEED_HUMAN, ending the run on data the CV was
                    // holding all along. Resolution is value → profileKey → cvPath,
                    // so a filled profile still wins.
                    { label: 'Address line 1', selector: '[data-automation-id="formField-addressLine1"] input', profileKey: 'addressStreet', cvPath: 'contact.address_street', type: 'text', required: true },
                    { label: 'District or Town', selector: '[data-automation-id="formField-city"] input', profileKey: 'addressDistrict', cvPath: 'contact.address_district', type: 'text', required: true },
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
const OPTION_SEL = '[data-automation-id="promptOption"], [data-automation-id="promptLeafNode"], [role="option"]';

/** The element that actually scrolls a prompt's option list, if any. */
function optionScroller(opt) {
    for (let p = opt?.parentElement; p && p !== document.body; p = p.parentElement) {
        if (p.scrollHeight > p.clientHeight + 20) return p;
    }
    return null;
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
            if (f.type === 'radio') {
                const r = fillRadio(f, val);
                if (r.ok) { filled++; outcomes.push([f.label, 'OK', String(val)]); answers.push({ field: f.label, value: val, source: provenance }); }
                else if (r.reason === 'already-selected') outcomes.push([f.label, 'done', 'already selected']);
                else if (r.reason === 'group-absent') outcomes.push([f.label, 'absent', 'not rendered yet']);
                else outcomes.push([f.label, 'FAIL', r.reason]);
            } else if (f.type === 'custom-select') {
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
    (notable ? trace : traceOnce.bind(null, `recipe.done:${step.name}`))('recipe.fields', {
        step: step.name,
        filled,
        ok: outcomes.filter(([, s]) => s === 'OK').map(([l]) => l).join(', ') || null,
        alreadyDone: outcomes.filter(([, s]) => s === 'done').length,
        absent: outcomes.filter(([, s]) => s === 'absent').map(([l]) => l).join(', ') || null,
        skipped: outcomes.filter(([, s]) => s === 'skip').map(([l, , why]) => `${l}(${why})`).join(', ') || null,
        failed: failed.map(([l, , why]) => `${l}: ${why}`).join(' | ') || null,
    });

    return { matched: true, filled, step: step.name, answers };
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
 * One capital per word, for words that are shouting.
 *
 * The web app normalises this when it BUILDS the profile — but that runs at sync
 * time, so every profile synced before that shipped still carries "HIEU
 * (CHARLES)", and re-syncing is a step nobody should have to know about. Doing it
 * again here makes the result independent of when the profile was last synced.
 *
 * Only ALL-CAPS words are re-cased: title-casing everything quietly damages names
 * whose capitals are correct (McDonald → Mcdonald, MacLeod → Macleod), and a
 * legal-name field is the wrong place to be clever. Single letters are left alone
 * so a middle initial survives. Mirrors normalizeNameCase in
 * frontend/src/lib/extension-profile.ts.
 */
function normalizeNameCase(raw) {
    return String(raw ?? '')
        .split(/(\s+)/)
        .map((word) => {
            const letters = word.replace(/[^\p{L}]/gu, '');
            if (letters.length < 2 || word !== word.toUpperCase()) return word;
            return word.toLowerCase()
                .replace(/(^|[^\p{L}])(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase());
        })
        .join('');
}

function recipeFieldValue(f, profile, cv) {
    // A fixed `value` is the recipe author's literal choice — never rewritten.
    if (f.value != null && f.value !== '') return f.value;
    const shape = (v) => (f.normalize === 'name' ? normalizeNameCase(v) : v);
    const p = profile?.[f.profileKey];
    if (p != null && String(p).trim() !== '') return shape(p);
    const fromCv = readCvPath(cv, f.cvPath);
    if (fromCv != null && String(fromCv).trim() !== '') return shape(String(fromCv));
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
    const matchAll = (list, wanted) => {
        const tier = (pred) => list.filter(pred);
        let cands = tier(o => txt(o) === wanted);
        if (!cands.length) {
            const prefix = tier(o => txt(o).startsWith(wanted));
            // A prefix/substring tier still has to be UNAMBIGUOUS as a set: many
            // DIFFERENT labels matching means we cannot tell which the user meant,
            // and "Marketing" must never resolve to "Marketing Research".
            const distinct = (l) => new Set(l.map(txt)).size;
            if (prefix.length && distinct(prefix) === 1) cands = prefix;
            else {
                const contains = tier(o => txt(o).includes(wanted));
                if (contains.length && distinct(contains) === 1) cands = contains;
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
            // Typing does not narrow every prompt. Mondelez's Field of Study
            // takes the text and still lists all majors from "Accounting" —
            // so the typed rung has to be searched for, not just read off.
            opt = await findInList(visibleOptions, (list) => uniqueMatch(list, wanted), `${f.label}:${wanted}`, wanted);
            if (opt) { matched = wanted; break; }
        }
    } else {
        for (const wanted of ladder) {
            opt = await findInList(visibleOptions, (list) => uniqueMatch(list, wanted), `${f.label}:${wanted}`, wanted);
            if (opt) { matched = wanted; break; }
        }
    }
    if (opt) opt = await revealOption(opt, visibleOptions, (list) => uniqueMatch(list, matched), f.label);
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
            reason: `option-not-found (${shown.length} shown${ladder.length ? `, tried ${ladder.length} candidate(s)` : ''})`,
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
        return okOnce ? { ok: true, matched } : { ok: false, reason: 'policy-denied' };
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
            return { ok: true, matched };
        }
        let cands = level === 0 && !matchAll(visibleOptions(), matched).length
            ? [opt] : matchAll(visibleOptions(), matched);
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
            return { ok: true, matched };
        }
        // No commit. Did the click DRILL IN instead? A changed row set means a
        // submenu opened and the next pass should match inside it.
        await sleep(350);
        const afterRows = renderedRows(visibleOptions).join('|');
        const drilled = afterRows !== beforeRows && !!visibleOptions().length;
        attempts.push(`level${level}:${drilled ? 'drilled-in' : 'no-effect'}`);
        trace('list.drill', { field: f.label, level, wasLeaf: isLeaf, drilled, rows: visibleOptions().length });
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
