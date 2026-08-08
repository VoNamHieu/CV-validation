// P1 — Autofill with Resume.
//
// One page, one action, and one measured way to be wrong: WORKDAY INGESTS THE
// FILE AND CLEARS THE INPUT (dom.js, beside readFileCommitState). So
// `input.files` reads empty on every pass after the first, and an executor that
// trusts it uploads the CV again — measured at 5+ duplicate rows in one run.
// The same measurement records the other half of that bug: two modules
// answering "does the ATS have the file" differently froze a run, the recipe
// skipping the upload while the observer called the finished page an unfilled
// required field.
//
// So the first test here is the NEGATIVE CONTROL: read the input the obvious
// way and the harness hands you the duplicate. Everything after it is the
// controller declining to make that mistake.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';
import { buildAutofillPage } from './harness/autofill-page.js';

let dom;
let page;
let p1;
let pages;
let RESULT;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 12)));
const CV = { fileName: 'HIEU_VO.pdf', base64: 'JVBERi0xLjQK' };
const ctx = (extra = {}) => ({ sleep, cvData: CV, commitMs: 800, inputMs: 600, ...extra });

const waitUntil = async (fn, budgetMs = 1500) => {
    const by = Date.now() + budgetMs;
    while (Date.now() < by) { if (fn()) return true; await sleep(8); }
    return fn();
};

before(async () => {
    console.log = () => { };
    dom = installDom();
    p1 = await import('../src/content-agent/mdlz-v2/page-autofill.js');
    pages = await import('../src/content-agent/mdlz-v2/pages.js');
    ({ RESULT } = await import('../src/content-agent/mdlz-v2/config.js'));
});

after(() => dom?.uninstall());

beforeEach(() => {
    dom.document.body.children.forEach((c) => { c.parentNode = null; });
    dom.document.body.children = [];
    globalThis.window.__copoNavLock = null;
    p1.forgetUploads();
    pages.releasePage();
    page = buildAutofillPage(dom.document);
});

// ── the pathology, reproduced ────────────────────────────────────────────

describe('the harness hands you the measured bug if you read the input', () => {
    test('after Workday ingests the file, the input is empty and a row is there', async () => {
        const input = page.input();
        input.files = [{ name: CV.fileName }];
        await waitUntil(() => page.rows() > 0);

        assert.equal(input.files.length, 0, 'the input says no file');
        assert.equal(page.rows(), 1, 'the row says otherwise, and the row is right');
        // An executor asking the input would now upload again — which is the
        // 5-duplicate-rows run, in two lines.
        assert.equal(page.uploads.length, 1);
    });
});

// ── P1 ───────────────────────────────────────────────────────────────────

describe('the CV goes up once, and only on proof does the page get left', () => {
    test('it uploads, waits for the row, and advances', async () => {
        const r = await p1.runAutofillPage(ctx());

        assert.equal(r.result, RESULT.COMMITTED, r.reason || '');
        assert.deepEqual(page.uploads, [CV.fileName]);
        assert.equal(r.advanced, true);
        assert.equal(r.report.step, 'Autofill with Resume');
    });

    test('a second pass finds the file already there and uploads nothing', async () => {
        await p1.runAutofillPage(ctx({ advance: false }));
        const after = page.uploads.length;

        // Re-entry: the input is empty, the row is not. Reading the input here
        // is the whole bug.
        const again = await p1.runAutofillPage(ctx({ advance: false }));
        assert.equal(again.result, RESULT.SATISFIED);
        assert.equal(page.uploads.length, after, 'no second attachment');
    });

    test('and a pass that runs while the row is still coming does not re-upload', async () => {
        // The window the duplicates lived in: the file is handed over, Workday
        // has not acknowledged it yet, and the next pass arrives. What this run
        // already uploaded is remembered on `window` — where the OTHER copy of
        // the content script can see it too.
        page = buildAutofillPage(dom.document, { commitMs: 400 });
        dom.document.body.children[0].remove();

        const first = p1.runAutofillPage(ctx({ advance: false, commitMs: 50 }));
        await sleep(30);
        const second = await p1.runAutofillPage(ctx({ advance: false, commitMs: 900 }));
        await first;

        assert.equal(page.uploads.length, 1, 'one CV, one upload');
        assert.equal(second.result, RESULT.SATISFIED);
    });

    test('a different CV in the same run IS uploaded', async () => {
        await p1.runAutofillPage(ctx({ advance: false }));
        // Identity is the file, not the fact that an upload happened: a new CV
        // is a new answer and should go up.
        assert.equal(p1.alreadyUploaded(p1.cvIdentity({ fileName: 'OTHER.pdf', base64: 'AAA' })), false);
    });
});

describe('it does not leave a page whose upload never landed', () => {
    test('an upload the page never acknowledges is COMMIT_FAILED, and nothing advances', async () => {
        page = buildAutofillPage(dom.document, { commits: false });
        dom.document.body.children[0].remove();

        const r = await p1.runAutofillPage(ctx({ commitMs: 300 }));
        assert.equal(r.result, RESULT.COMMIT_FAILED);
        assert.match(r.reason, /no upload row/);
        assert.equal(page.nextButton().clickCount, 0, 'a page left before the parse is a page re-rendered under us');
    });

    test('a file input that has not rendered yet is waited for, not failed on', async () => {
        page = buildAutofillPage(dom.document, { inputDelayMs: 60 });
        dom.document.body.children[0].remove();

        const r = await p1.runAutofillPage(ctx({ inputMs: 900 }));
        assert.equal(r.result, RESULT.COMMITTED, r.reason || '');
        assert.deepEqual(page.uploads, [CV.fileName]);
    });

    test('and a page with no input at all after the budget says so', async () => {
        dom.document.body.children.forEach((c) => { c.parentNode = null; });
        dom.document.body.children = [];
        const bare = dom.document.createElement('div');
        bare.setAttribute('data-automation-id', 'applyFlowAutoFillPage');
        dom.document.body.appendChild(bare);

        const r = await p1.runAutofillPage(ctx({ inputMs: 120 }));
        assert.equal(r.result, RESULT.WAITING_HYDRATION);
    });

    test('no CV to send is a question for a human, not a guess', async () => {
        const r = await p1.runAutofillPage({ sleep, cvData: null, inputMs: 300 });
        assert.equal(r.result, RESULT.USER_REQUIRED);
        assert.deepEqual(page.uploads, []);
    });
});

describe('the page is v2\'s now', () => {
    test('Autofill is in the owned set, so nothing else may click there', async () => {
        const state = await pages.observePageState({ sleep });
        assert.equal(state.page, 'AUTOFILL');
        assert.equal(state.owner, 'mdlz-v2');
        assert.equal(pages.mayActivate('recipe'), false);
        assert.equal(pages.mayActivate('mdlz-v2'), true);
    });
});
