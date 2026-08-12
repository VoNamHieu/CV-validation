// searchSelect end-to-end — the single-select chip-search (Field of Study),
// driven through the real executor against a widget whose DOM is byte-identical
// to Skills (multiSelectContainer + a "Search" input, no selectedItemList until
// the first chip). The capability is chosen by the plan's CONTRACT, never the
// fingerprint, so every case here passes decl {searchSelect, one}.
//
// The four measured behaviors (Field of Study, R-172558, 2026-08-13):
//   1. a query with exactly ONE result commits its chip on Enter alone;
//   2. a multi-result query filters but commits nothing — the exact row is
//      clicked, and a near-match never is (a wrong major reached a real
//      application once already);
//   3. a term with no exact row is OPTION_NOT_FOUND — no free chip on a closed
//      taxonomy;
//   4. the commit is proven by the CHIP, so a list that stays open after a
//      successful Enter still reads COMMITTED (the "timeout-despite-success"
//      trap the review named).
//
// The fifth case the review asked for — another popup open when searchSelect
// starts — is covered upstream, not here: withList's openList() runs a VERIFIED
// sweep BEFORE it opens (popup-manager openList → sweep), so no foreign list is
// on the page while this capability reads options. Asserting it here would test
// the sweep, which owns its own suite.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';
import { buildHostilePage } from './harness/hostile-page.js';

let dom;
let page;
let fp;
let exec;
let RESULT;
let WIDGET;
let PAGE_LOCK;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 12)));
// The contract every chip-search field's task now carries; searchSelect is the
// single-select half of the router matrix.
const fosCtx = () => ({ sleep, searchMs: 4000, commitMs: 1500, decl: { capability: 'searchSelect', cardinality: 'one' } });

const field = (automationId) => fp.fingerprintOf(
    () => dom.document.querySelector(`[data-automation-id="${automationId}"]`),
    { name: automationId },
);

before(async () => {
    console.log = () => { };
    dom = installDom();
    fp = await import('../src/content-agent/mdlz-v2/fingerprint.js');
    exec = await import('../src/content-agent/mdlz-v2/executors.js');
    ({ RESULT, PAGE_LOCK } = await import('../src/content-agent/mdlz-v2/config.js'));
    ({ WIDGET } = fp);
});

after(() => dom?.uninstall());

beforeEach(() => {
    dom.document.body.children.forEach((c) => { c.parentNode = null; });
    dom.document.body.children = [];
    dom.document.activeElement = dom.document.body;
    globalThis.window[PAGE_LOCK] = null;
    // A refusal is true of a PAGE and lives on `window`; a fresh page is a fresh
    // catalogue, or one test's OPTION_NOT_FOUND answers the next test's search.
    exec.forgetRefusals();
    page = buildHostilePage(dom.document);
});

const CATALOGUE = ['Economics', 'Marketing', 'Marketing Analytics', 'Data Science'];

describe('searchSelect drives the single-select chip-search end to end', () => {
    test('it wears the SAME shape as Skills — routed by contract, not fingerprint', () => {
        page.addFieldOfStudy(CATALOGUE);
        // Identical DOM: the fingerprint calls it a multi-select, exactly as the
        // live probe found, which is why the plan MUST declare searchSelect.
        assert.equal(field('formField-fieldOfStudy').kind, WIDGET.SEARCH_MULTI);
    });

    test('one result commits on Enter alone', async () => {
        page.addFieldOfStudy(CATALOGUE);
        // "Economics" is the only row containing "economics" — one result.
        const r = await exec.runField(field('formField-fieldOfStudy'), 'Economics', fosCtx());
        assert.equal(r.result, RESULT.COMMITTED);
        assert.deepEqual(page.chipsOn('fieldOfStudy'), ['Economics']);
    });

    test('several results commit nothing on Enter — the EXACT row is clicked', async () => {
        page.addFieldOfStudy(CATALOGUE);
        // "marketing" matches both "Marketing" and "Marketing Analytics"; Enter
        // filters, and only the exact row may be picked.
        const r = await exec.runField(field('formField-fieldOfStudy'), 'Marketing', fosCtx());
        assert.equal(r.result, RESULT.COMMITTED);
        assert.deepEqual(page.chipsOn('fieldOfStudy'), ['Marketing'],
            'the exact row, never the longer near-match');
    });

    test('a term with no EXACT row is OPTION_NOT_FOUND — no free chip on a closed list', async () => {
        page.addFieldOfStudy(['Marketing Analytics', 'Digital Marketing', 'Data Science']);
        // "Marketing" filters to two rows, neither of which IS "Marketing". A
        // genuine miss re-searches once (the slow-server guard) and, finding
        // nothing new, concludes — a short searchMs keeps that second wait brief.
        const r = await exec.runField(field('formField-fieldOfStudy'), 'Marketing', { ...fosCtx(), searchMs: 400 });
        assert.equal(r.result, RESULT.OPTION_NOT_FOUND);
        assert.deepEqual(page.chipsOn('fieldOfStudy'), [], 'nothing was committed');
    });

    test('a new pick REPLACES the chip — single-select never accumulates', async () => {
        page.addFieldOfStudy(CATALOGUE);
        page.seedChip('fieldOfStudy', 'Data Science');   // a stale answer already there
        const r = await exec.runField(field('formField-fieldOfStudy'), 'Economics', fosCtx());
        assert.equal(r.result, RESULT.COMMITTED);
        assert.deepEqual(page.chipsOn('fieldOfStudy'), ['Economics'],
            'one chip, replaced — not two');
    });

    test('COMMITTED is read from the CHIP, so a list that stays open still succeeds', async () => {
        // The "timeout-despite-success" trap: if the proof were "the list closed"
        // a fast Enter-commit that left the list up would read as a failure. The
        // proof is the chip, so it does not.
        page.addFieldOfStudy(CATALOGUE, { keepOpenOnCommit: true });
        const r = await exec.runField(field('formField-fieldOfStudy'), 'Economics', fosCtx());
        assert.equal(r.result, RESULT.COMMITTED);
        assert.deepEqual(page.chipsOn('fieldOfStudy'), ['Economics']);
    });

    test('an already-correct field is SATISFIED with no search at all', async () => {
        page.addFieldOfStudy(CATALOGUE);
        page.seedChip('fieldOfStudy', 'Economics');
        const r = await exec.runField(field('formField-fieldOfStudy'), 'Economics', fosCtx());
        assert.equal(r.result, RESULT.SATISFIED);
        assert.deepEqual(page.chipsOn('fieldOfStudy'), ['Economics'], 'untouched');
    });

    test('a SLOW server does not cache a false OPTION_NOT_FOUND off the initial list', async () => {
        // The click opens an initial list (a decoy window that does NOT hold the
        // term); the server's filtered rows — which DO hold it — land 200ms later,
        // after the results have settled once. A reader that concluded
        // OPTION_NOT_FOUND from that first settle would cache a refusal for a term
        // the search was about to match. The commit must wait out the real result.
        page.addFieldOfStudy(CATALOGUE, {
            initialSet: ['Accounting', 'Biology', 'Chemistry'],   // decoy: no "Marketing"
            searchDelayMs: 200,
        });
        const r = await exec.runField(field('formField-fieldOfStudy'), 'Marketing', fosCtx());
        assert.equal(r.result, RESULT.COMMITTED, 'the slow filtered result is honoured, not the decoy');
        assert.deepEqual(page.chipsOn('fieldOfStudy'), ['Marketing']);
    });
});
