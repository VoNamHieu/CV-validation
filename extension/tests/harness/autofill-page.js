/**
 * The Autofill page, built out of the one measurement that decides it.
 *
 * MEASURED (dom.js, readFileCommitState): Workday INGESTS the file and CLEARS
 * the input. So `input.files` reads empty on every pass after the first, and an
 * executor that trusts it re-uploads the CV every iteration — 5+ duplicate rows
 * in one run. What testifies instead is Workday's own row marker,
 * `file-upload-item` / `file-upload-successful`.
 *
 * This page reproduces exactly that: set files on the input, and a moment later
 * the input is empty and a row has appeared. An executor that reads the input
 * sees an empty one and uploads again; the harness counts every upload, so the
 * duplicate is visible rather than theoretical.
 *
 * What is NOT modelled, because nobody has measured it: how long Workday takes
 * to parse the CV into the later sections. The harness commits the row after a
 * few milliseconds; the controller must wait for the ROW, never for a number.
 */

export function buildAutofillPage(doc, opts = {}) {
    const cfg = {
        inputDelayMs: 0,        // the file input can render after the page does
        commitMs: 15,           // ingest → input cleared, row rendered
        commits: true,          // a page where the upload never takes
        rowId: 'file-upload-item',
        nextPageId: 'applyFlowMyExpPage',
        navMs: 20,
        ...opts,
    };

    const el = (tag, attrs = {}, parent = null) => {
        const n = doc.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        if (parent) parent.appendChild(n);
        return n;
    };

    const page = el('div', { 'data-automation-id': 'applyFlowAutoFillPage' }, doc.body);
    const nav = { clicks: 0, advancedTo: null };
    const next = el('button', { 'data-automation-id': 'pageFooterNextButton' }, page);
    next.textContent = 'Continue';
    next.addEventListener('click', () => {
        nav.clicks += 1;
        setTimeout(() => {
            page.remove();
            el('div', { 'data-automation-id': cfg.nextPageId }, doc.body);
            nav.advancedTo = cfg.nextPageId;
        }, cfg.navMs);
    });

    const state = { uploads: [], rows: 0 };
    let input = null;

    const addInput = () => {
        input = el('input', { 'data-automation-id': 'file-upload-input-ref', type: 'file' }, page);
        let held = [];
        Object.defineProperty(input, 'files', {
            get: () => held,
            set: (v) => {
                held = v || [];
                if (!held.length) return;
                state.uploads.push(held[0]?.name || '(unnamed)');
                if (!cfg.commits) return;
                setTimeout(() => {
                    // Ingested: the input is emptied and a row appears. Reading
                    // the input from here on says "no file" about a file that is
                    // very much there.
                    held = [];
                    el('div', { 'data-automation-id': cfg.rowId }, page)
                        .textContent = state.uploads[state.uploads.length - 1];
                    state.rows += 1;
                }, cfg.commitMs);
            },
            configurable: true,
        });
    };

    if (cfg.inputDelayMs > 0) setTimeout(addInput, cfg.inputDelayMs);
    else addInput();

    return {
        cfg,
        page,
        /** Every file the page was handed — length > 1 is a duplicate upload. */
        uploads: state.uploads,
        nav,
        rows: () => state.rows,
        input: () => input,
        nextButton: () => page.querySelector('[data-automation-id="pageFooterNextButton"]'),
    };
}
