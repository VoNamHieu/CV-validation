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

// ── Steps ────────────────────────────────────────────────────────────────
export const STEP = {
    AUTOFILL: 'AUTOFILL',
    MY_INFORMATION: 'MY_INFORMATION',
    MY_EXPERIENCE: 'MY_EXPERIENCE',
    QUESTIONS: 'QUESTIONS',
    DISCLOSURES: 'DISCLOSURES',
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
export const STEP_SIGNALS = [
    { step: STEP.REVIEW, any: ['[data-automation-id="applyFlowReviewPage"]'] },
    // The page id comes FIRST because an empty draft has none of the fields.
    // Measured on PwC's /apply flow (no résumé autofill): three bare sections
    // and three Add buttons, not one formField. v1 detected on formField-degree
    // alone, matched nothing, and advanced past an application with no work
    // history in it at all. v2 was one signal away from inheriting that.
    { step: STEP.MY_EXPERIENCE, any: ['[data-automation-id="applyFlowMyExpPage"]', '[data-automation-id="formField-jobTitle"]', '[data-automation-id="formField-schoolName"]', '[data-automation-id="formField-language"]'] },
    { step: STEP.MY_INFORMATION, any: ['[data-automation-id="formField-addressLine1"]', '[data-automation-id="formField-phoneNumber"]', '[data-automation-id="formField-country"]'] },
    { step: STEP.DISCLOSURES, any: ['[data-automation-id="formField-gender"]', '[data-automation-id="formField-ethnicity"]'] },
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
};

/** Outcomes that must NOT spend a semantic retry, and must NOT reach the model. */
export const INTERACTION_ONLY = new Set([
    RESULT.WAITING_HYDRATION,
    RESULT.BLOCKED_BY_POPUP,
    RESULT.OPEN_TIMEOUT,
]);

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
