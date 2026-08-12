/**
 * MDLZ v2 — the measured facts, in one place.
 *
 * Everything here was READ OFF THE LIVE FORM (2026-08-07/08, drafts R-173159,
 * R-172396, R-169319), not inferred from code or documentation. The v1 recipe
 * learned these the expensive way, one regression at a time; v2 starts from
 * them.
 *
 * Nothing in this file executes. It exists so a behavior question has one
 * answer, and so a wrong assumption has to be argued against a measurement.
 */

/** The tenant this controller owns. Nothing else may use it. */
export const TENANT = 'mdlz';
export const isMdlzPage = () => {
    try {
        return /(^|\.)myworkdaysite\.com$/i.test(location.hostname)
            && /\/mdlz\//i.test(location.pathname);
    } catch { return false; }
};

/**
 * OFF by default and read from storage, so shipping this file changes nothing.
 * v2 takes the page only when the flag is on AND the page is mdlz.
 */
export const FLAG_KEY = 'copoMdlzV2';

/**
 * Which ways v2 may identify a section's Add button: 'any' or 'rows'.
 *
 * A kill switch for the one strategy that has never met a real page. Finding a
 * section by its HEADING is grounded in Workday's own copy, and grounded is not
 * the same as proven — if a live run puts a row in the wrong section, this turns
 * that strategy off from the console, without a rebuild and without giving up
 * the sections that already have rows.
 */
export const ADD_VIA_KEY = 'copoMdlzV2AddVia';

// ── Steps ────────────────────────────────────────────────────────────────
export const STEP = {
    AUTOFILL: 'AUTOFILL',
    MY_INFORMATION: 'MY_INFORMATION',
    MY_EXPERIENCE: 'MY_EXPERIENCE',
    APPLICATION_QUESTIONS: 'APPLICATION_QUESTIONS',
    VOLUNTARY_DISCLOSURES: 'VOLUNTARY_DISCLOSURES',
    REVIEW: 'REVIEW',
    UNKNOWN: 'UNKNOWN',
};

/**
 * How a step is RECOGNISED.
 *
 * MEASURED: the "current step N of M" text is NOT usable as state — it read
 * "1/6" for an entire run that crossed My Information, My Experience and
 * Application Questions (the parser sees the first item of the progress nav,
 * not the current one). The step COUNT also varies per job posting: 5 on some
 * mdlz jobs, 6 on those with a separate Autofill page. And the URL changes
 * exactly once (/apply → /apply/autofillWithResume) and then never again.
 *
 * So recognition is by CONTENT: which sections exist on the page right now.
 */
/**
 * PAGE ID FIRST, fields second — for all six.
 *
 * Every one of these pages renders an id of its own, and that id is there
 * before any field is. A recogniser that needs a field cannot see an empty
 * draft at all: measured on PwC's /apply flow, three bare sections and three
 * Add buttons, not one formField, where v1 detected on formField-degree,
 * matched nothing, and advanced past an application with no work history in it.
 *
 * The field selectors stay as a second line, for a page whose id a tenant
 * renames. Review comes first because its page summarises the others.
 */
export const STEP_SIGNALS = [
    { step: STEP.REVIEW, any: ['[data-automation-id="applyFlowReviewPage"]'] },
    { step: STEP.AUTOFILL, any: ['[data-automation-id="applyFlowAutoFillPage"]'] },
    { step: STEP.APPLICATION_QUESTIONS, any: ['[data-automation-id="applyFlowPrimaryQuestionsPage"]'] },
    { step: STEP.VOLUNTARY_DISCLOSURES, any: ['[data-automation-id="applyFlowVoluntaryDisclosuresPage"]', '[data-automation-id="formField-gender"]', '[data-automation-id="formField-ethnicity"]'] },
    { step: STEP.MY_EXPERIENCE, any: ['[data-automation-id="applyFlowMyExpPage"]', '[data-automation-id="formField-jobTitle"]', '[data-automation-id="formField-schoolName"]', '[data-automation-id="formField-language"]'] },
    // applyFlowMyInfoPage is MEASURED the same way its siblings are (PwC
    // 715624WD draft, 2026-08-06, read off the live DOM alongside
    // applyFlowMyExpPage). An id nobody measured is not a detect — but this one
    // was, and leaving it out made this the only page that needed a field.
    { step: STEP.MY_INFORMATION, any: ['[data-automation-id="applyFlowMyInfoPage"]', '[data-automation-id="formField-legalName--firstName"]', '[data-automation-id="formField-addressLine1"]', '[data-automation-id="formField-phoneNumber"]', '[data-automation-id="formField-country"]'] },
    // Last: the upload input also appears on My Experience (Resume/CV), so on
    // its own it names the Autofill page only when nothing above matched.
    { step: STEP.AUTOFILL, any: ['[data-automation-id="file-upload-input-ref"]'] },
];

// ── Commit signals ───────────────────────────────────────────────────────
/**
 * What proves a widget ACCEPTED a value. Measured per widget, and `.value` is
 * never one of them — a committed date section reads `.value === ""` while
 * `aria-valuenow` carries the number.
 *
 * Reading the wrong signal is the single largest source of false verdicts in
 * v1: fields reported failed while correct, and fields reported done while
 * empty.
 */
export const COMMIT_SIGNAL = {
    dateSection: 'aria-valuenow',     // NEVER .value
    listbox: 'button-text-or-chip',
    multiSelect: 'chip-in-selectedItemList',
    checkbox: 'checked-and-no-row-error',
    text: 'value-and-no-row-error',
};

// ── Things that do not work, with the measurement that proved it ─────────
export const FORBIDDEN = {
    typeIntoDateSection:
        'Synthetic KeyboardEvent from a content script writes NOTHING into a '
        + 'Workday date spinbutton (value stays "", aria-valuenow stays null). '
        + 'Only the calendar (ordinary synthetic clicks) or a trusted keydown '
        + 'commits. Every "date filled" in v1 traces was Workday\'s own résumé '
        + 'parse.',
    indexPairingAcrossSections:
        'To disappears from the DOM when "I currently work here" is ticked, so '
        + 'checkbox[i] and endDate[i] stop describing the same row (measured: '
        + '3 boxes / 2 rows). Rows must be identified by their container.',
    stepIndicatorAsState:
        'Reads 1/6 for a whole run across three different steps.',
    valueAsCommitProof:
        'A committed date reads .value === "". A painted value survives in '
        + '.value while Workday\'s state never held it.',
    clickWithoutScroll:
        'A click aimed at a control below the fold hit-tests as whatever covers '
        + 'that point — this is what "calendar did not open" and "add clicked, '
        + 'no row appeared" both were.',
};

// ── Widget selectors, as measured ────────────────────────────────────────
export const SEL = {
    nextButton: '[data-automation-id="pageFooterNextButton"]',
    fileInput: '[data-automation-id="file-upload-input-ref"]',
    addButton: '[data-automation-id="add-button"]',
    option: '[data-automation-id="promptOption"], [data-automation-id="promptLeafNode"], [role="option"]',
    // The container a prompt's options live in. Workday PORTALS it to the
    // document root — it has no formField ancestor — which is why a leftover
    // list cannot be disowned by ownership and has to be counted instead.
    listContainer: '[data-automation-id="activeListContainer"], [role="listbox"]',
    selectedItem: '[data-automation-id="selectedItem"]',
    selectedItemList: '[data-automation-id="selectedItemList"]',
    // What a multi-select is BEFORE it has an answer.
    //
    // MEASURED on My Experience (R-174102, 2026-08-09): an empty Skills field
    // carries `multiSelectContainer` and `data-uxi-widget-type="multiselect"`
    // and NO selectedItemList — Workday creates the chip list with the first
    // chip. Nothing else on that page carries either marker (checked against
    // all 14 formFields: jobTitle, company, location, the two dates, degree,
    // language and Overall are all something else), so this identifies the
    // widget rather than merely describing it.
    multiSelect: '[data-automation-id="multiSelectContainer"], [data-uxi-widget-type="multiselect"]',
    deleteCharm: '[data-automation-id="DELETE_charm"]',
    dateIcon: '[data-automation-id="dateIcon"]',
    dateMonth: '[data-automation-id="dateSectionMonth-input"]',
    dateYear: '[data-automation-id="dateSectionYear-input"]',
    // The picker panel carries no automation id of its own. What it does carry,
    // measured: a UL of twelve cells, each a div[role="button"] labelled
    // "May 2026" (the current one prefixed "Selected "), with the year arrows in
    // the UL's parent. So the panel is found through its cells, not by name.
    monthCell: '[role="button"][aria-label]',
    yearBack: '[aria-label="Previous Year"]',
    yearForward: '[aria-label="Next Year"]',
    spinbutton: '[role="spinbutton"]',
    fieldError: '[data-automation-id="errorMessage"], [data-automation-id="formFieldError"], [data-automation-id="inputAlert"]',
    row: {
        jobTitle: '[data-automation-id="formField-jobTitle"]',
        company: '[data-automation-id="formField-companyName"]',
        location: '[data-automation-id="formField-location"]',
        currentlyWorkHere: '[data-automation-id="formField-currentlyWorkHere"]',
        startDate: '[data-automation-id="formField-startDate"]',
        endDate: '[data-automation-id="formField-endDate"]',
        roleDescription: '[data-automation-id="formField-roleDescription"]',
        schoolName: '[data-automation-id="formField-schoolName"]',
        degree: '[data-automation-id="formField-degree"]',
        language: '[data-automation-id="formField-language"]',
        fluent: '[data-automation-id="formField-native"]',
        // Overall proficiency carries a per-tenant GUID, never a stable id —
        // it must be found by LABEL inside the row's own container.
        overallByLabel: /overall/i,
    },
    skills: '[data-automation-id="formField-skills"]',
};

// ── Workday's own words ──────────────────────────────────────────────────
/**
 * Copy read out of the product, not off a page.
 *
 * Source: the compiled language bundles the apply flow itself loads —
 * wd3.myworkdaycdn.com/wday/asset/candidate-experience-apply-flow/2026.31.14/
 * compiled-lang/{cxs_apply_flow,generic}/en-US.json, captured in a session HAR
 * on 2026-08-04. Every Workday tenant loads the SAME asset, so these strings
 * are the product's, not one tenant's — which is what makes them usable to
 * find a section on a page that has not been measured yet.
 *
 * Why this beats a selector: the section headings and the Add label are how a
 * HUMAN tells Work Experience from Education, and the step renders four Add
 * buttons at once with nothing else to tell them apart.
 *
 * Not measured, and therefore not relied on alone: whether "Successfully
 * Uploaded!" PERSISTS after the upload settles (its key is Virus_Scan_Successful,
 * which reads like a moment rather than a state). It is one signal among
 * several, never the only one.
 */
export const COPY = {
    addAnother: 'Add Another',           // APPLY.Add_Another
    add: 'Add',                          // GENERIC.Add
    uploadedBanner: 'Successfully Uploaded!',   // APPLY.FILE.Virus_Scan_Successful
    autofillWithResume: 'Autofill with Resume', // APPLY.BUTTON.Autofill_with_Resume
    sections: {
        work: 'Work Experience',         // APPLY.MY_EXPERIENCE.Work_Experience
        education: 'Education',          // APPLY.MY_EXPERIENCE.Education
        languages: 'Languages',          // APPLY.MY_EXPERIENCE.Languages
        skills: 'Skills',                // APPLY.MY_EXPERIENCE.Skills
        websites: 'Websites',            // APPLY.MY_EXPERIENCE.Websites
        attachments: 'Additional Attachments',
    },
};

/** "May 2026", or "Selected May 2026" for the month the picker is sitting on. */
export const MONTH_LABEL = /^(?:Selected\s+)?([A-Z][a-z]+)\s+(\d{4})$/;

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// ── Task outcomes ────────────────────────────────────────────────────────
/**
 * An INTERACTION failure is not a SEMANTIC failure. Degree burned 9–11 seconds
 * of model time per pass on a field whose popup was simply blocked by the
 * previous field's list — the value was never in question. Only the semantic
 * outcomes may spend a retry budget or ask the model.
 */
export const RESULT = {
    SATISFIED: 'SATISFIED',
    COMMITTED: 'COMMITTED',
    WAITING_HYDRATION: 'WAITING_HYDRATION',
    BLOCKED_BY_POPUP: 'BLOCKED_BY_POPUP',
    OPEN_TIMEOUT: 'OPEN_TIMEOUT',
    OPTION_NOT_FOUND: 'OPTION_NOT_FOUND',
    AMBIGUOUS: 'AMBIGUOUS',
    COMMIT_FAILED: 'COMMIT_FAILED',
    USER_REQUIRED: 'USER_REQUIRED',
    SKIPPED_OPTIONAL: 'SKIPPED_OPTIONAL',
    // The PLAN is wrong, not the page and not the candidate: a chip-search field
    // reached the executor without a declared capability/cardinality contract.
    // Developer-actionable only — the report must never tell the candidate to
    // fix it — and a CI test catches it before it can ever fire at runtime.
    CONTRACT_ERROR: 'CONTRACT_ERROR',
};

/** Outcomes that must NOT spend a semantic retry, and must NOT reach the model. */
export const INTERACTION_ONLY = new Set([
    RESULT.WAITING_HYDRATION,
    RESULT.BLOCKED_BY_POPUP,
    RESULT.OPEN_TIMEOUT,
]);

/**
 * Outcomes that mean "the answer is not on this page", not "try again".
 *
 * The catalogue does not hold it, or holds too many of it, or only a person can
 * say — none of which the next pass changes.
 */
export const SEMANTIC = new Set([
    RESULT.OPTION_NOT_FOUND,
    RESULT.AMBIGUOUS,
    RESULT.USER_REQUIRED,
    // A missing plan contract is semantic in the scheduler's sense — no retry
    // and no model can change what the spec failed to declare — but it is the
    // DEVELOPER'S gap, and every surface that words it must say so.
    RESULT.CONTRACT_ERROR,
]);

/**
 * A developer's bug, not the candidate's data and not a busy page: a chip-search
 * field reached the executor with no declared capability/cardinality. It is in
 * SEMANTIC (no retry, no model can fix it) but — unlike every other SEMANTIC
 * outcome — it is NEVER forgiven on an optional field. Forgiving it is exactly
 * how a forgotten contract would advance the page in silence (Skills is both
 * optional AND chip-search, so this is reachable, not hypothetical). Every
 * surface that reports it must word it as an internal error, never a gap the
 * candidate fills.
 */
export const DEVELOPER_FATAL = new Set([RESULT.CONTRACT_ERROR]);

/**
 * The outcomes that TERMINATE a task — no pass, no defer, no model moves them.
 * Canonical here so every layer (the completion check, the blocker list, the
 * outer loop's escalation budget) asks the SAME question. A private copy of this
 * set in the router was the third opinion that let one layer advance a page
 * while another called it blocked. Interaction states are absent on purpose: a
 * blocked/hydrating field is retryable — unsettled, but not a terminal blocker.
 */
export const TERMINAL = new Set([
    RESULT.OPTION_NOT_FOUND,
    RESULT.AMBIGUOUS,
    RESULT.COMMIT_FAILED,
    RESULT.USER_REQUIRED,
    RESULT.CONTRACT_ERROR,
]);

/**
 * An OPTIONAL field's semantic miss the page may complete OVER — the catalogue
 * did not hold its value and no one required it (measured on Skills, R-174102,
 * whose list answers "No Items." to everything). A DEVELOPER_FATAL outcome is
 * never forgiven, even here: a forgotten contract is a bug to fix, not a field
 * to skip.
 */
export function isForgiven(task) {
    return !!task?.optional
        && SEMANTIC.has(task?.result)
        && !DEVELOPER_FATAL.has(task?.result);
}

/**
 * Does this task keep the page from finishing in a way only a HUMAN or a
 * DEVELOPER can clear — the one question the completion check, the blocker list
 * and the escalation budget must all answer alike. A developer-fatal contract
 * error always blocks (even optional); an optional field's forgivable semantic
 * miss never does; otherwise a terminal outcome blocks and a still-working one
 * (satisfied, hydrating, retryable) does not.
 */
export function isPageBlockingTask(task) {
    if (DEVELOPER_FATAL.has(task?.result)) return true;
    if (isForgiven(task)) return false;
    return TERMINAL.has(task?.result);
}

// ── Ownership of the page ────────────────────────────────────────────────
/**
 * The lock that decides who may touch this document — and it is v1's own key,
 * deliberately.
 *
 * v1 already refuses to start a fill while `window.__copoFillLock` is held, so
 * claiming the same key is what makes "either v1 or v2 owns the page, never
 * both" a mechanism instead of an intention. Two passes on one widget is a
 * measured failure, not a theoretical one: two "My Experience" summaries 83ms
 * apart, one reporting the proficiency list as option-not-found (42 shown) and
 * the other reporting it filled. Neither field was broken — each pass was
 * clearing the other's open list as a stray.
 *
 * It lives on `window`, not in module scope, for the same measured reason v1
 * puts it there: a document can hold two copies of the content script (the
 * declarative injection plus a programmatic re-inject after a redirect), and a
 * module-scoped lock guards only the copy that declares it.
 */
export const PAGE_LOCK = '__copoFillLock';

/**
 * A holder that dies past its own `finally` (context invalidated mid-run) must
 * not wedge the page forever. Same figure as v1: longer than any real pass.
 */
export const LOCK_STALE_MS = 120000;
