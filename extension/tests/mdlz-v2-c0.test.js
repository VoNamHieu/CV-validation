// C0 — the core underneath every page controller.
//
// Three things have to be true on all six pages before any of them can be
// ported, and each of them is a way the flow has already gone wrong:
//
//   WHICH PAGE. By the page's own id, because that id exists before any field
//   does. A recogniser that needs a field cannot see an empty draft — measured
//   on PwC's /apply flow, three bare sections and no formField, where the agent
//   advanced past an application with no work history in it.
//
//   SETTLED, AND EMPTY OR NOT. Two questions that one boolean answered badly.
//   A bare draft is READY; treating it as "not ready" parks a controller on a
//   page that was never going to change.
//
//   ONE OWNER. While v2 holds a page, nothing else may click on it — enforced
//   at the click choke point, not by asking each caller. And the negative that
//   makes the migration safe: on a page v2 owns, v1 never runs. Not on a
//   decline, and not on a crash.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';

let dom;
let pages;
let PAGE;
let READY;
let router;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 12)));

/** A page that renders only its own id — a draft nobody has touched. */
const renderPage = (automationId, extra = []) => {
    const root = dom.document.createElement('div');
    root.setAttribute('data-automation-id', automationId);
    dom.document.body.appendChild(root);
    for (const id of extra) {
        const f = dom.document.createElement('div');
        f.setAttribute('data-automation-id', id);
        root.appendChild(f);
    }
    return root;
};

before(async () => {
    console.log = () => { };
    dom = installDom();
    pages = await import('../src/content-agent/mdlz-v2/pages.js');
    ({ PAGE, READY } = pages);
    router = await import('../src/content-agent/mdlz-v2/../recipe-router.js').catch(() => null);
});

after(() => dom?.uninstall());

beforeEach(() => {
    dom.document.body.children.forEach((c) => { c.parentNode = null; });
    dom.document.body.children = [];
    pages.releasePage();
});

// ── which page ───────────────────────────────────────────────────────────

describe('all six pages are recognised, and recognised while empty', () => {
    const CASES = [
        ['applyFlowAutoFillPage', 'AUTOFILL'],
        ['applyFlowMyExpPage', 'MY_EXPERIENCE'],
        ['applyFlowPrimaryQuestionsPage', 'APPLICATION_QUESTIONS'],
        ['applyFlowVoluntaryDisclosuresPage', 'VOLUNTARY_DISCLOSURES'],
        ['applyFlowReviewPage', 'REVIEW'],
    ];
    for (const [id, expected] of CASES) {
        test(`${id} → ${expected}, with no field on it at all`, async () => {
            renderPage(id);
            const r = await pages.readiness({ sleep });
            assert.equal(r.page, PAGE[expected]);
            assert.equal(r.fields, 0, 'the point: nothing but the page id');
        });
    }

    test('My Information is recognised by its legal-name field', async () => {
        // The one page whose own id is not in the measured set; the field that
        // names it is (formField-legalName--firstName).
        renderPage('someOtherWrapper', ['formField-legalName--firstName']);
        const r = await pages.readiness({ sleep });
        assert.equal(r.page, PAGE.MY_INFORMATION);
    });

    test('a page nobody recognises is UNKNOWN, not guessed at', async () => {
        renderPage('somethingElseEntirely');
        const r = await pages.readiness({ sleep });
        assert.equal(r.page, PAGE.UNKNOWN);
    });
});

// ── readiness ────────────────────────────────────────────────────────────

describe('settled, and settled into what', () => {
    test('a bare draft is EMPTY_READY — a page, not a non-page', async () => {
        renderPage('applyFlowMyExpPage');
        const r = await pages.readiness({ sleep });
        assert.equal(r.state, READY.EMPTY_READY);
        assert.ok(pages.isReady(r));
    });

    test('a page with fields on it is POPULATED_READY', async () => {
        renderPage('applyFlowMyExpPage', ['formField-jobTitle', 'formField-companyName']);
        const r = await pages.readiness({ sleep });
        assert.equal(r.state, READY.POPULATED_READY);
        assert.equal(r.fields, 2);
    });

    test('a page still loading is HYDRATING, and is not ready', async () => {
        const root = renderPage('applyFlowMyExpPage');
        const spinner = dom.document.createElement('div');
        spinner.setAttribute('data-automation-id', 'loadingPanel');
        root.appendChild(spinner);

        const r = await pages.readiness({ sleep, budgetMs: 120 });
        assert.equal(r.state, READY.HYDRATING);
        assert.ok(!pages.isReady(r));
    });
});

// ── ownership ────────────────────────────────────────────────────────────

describe('one owner per page, enforced rather than requested', () => {
    test('v2 claims a page in its set and nothing else may click there', async () => {
        renderPage('applyFlowMyExpPage');
        await pages.observePageState({ sleep });

        assert.equal(pages.pageOwner(), 'mdlz-v2');
        assert.equal(pages.mayActivate('mdlz-v2'), true, 'v2 may act on its own page');
        assert.equal(pages.mayActivate('recipe'), false, 'the v1 recipe may not');
        assert.equal(pages.mayActivate(undefined), false, 'and neither may the planner, which declares nothing');
    });

    test('a page outside the set is left alone entirely', async () => {
        renderPage('applyFlowPrimaryQuestionsPage');
        const state = await pages.observePageState({ sleep });

        assert.equal(state.owner, 'v1');
        assert.equal(pages.pageOwner(), null);
        assert.equal(pages.mayActivate('recipe'), true, 'v1 owns the pages v2 has not been ported to');
    });

    test('the claim dies when the wizard moves on', async () => {
        renderPage('applyFlowMyExpPage');
        await pages.observePageState({ sleep });
        assert.equal(pages.pageOwner(), 'mdlz-v2');

        // Advance: the page is now Questions, and nobody released the claim.
        dom.document.body.children.forEach((c) => { c.parentNode = null; });
        dom.document.body.children = [];
        renderPage('applyFlowPrimaryQuestionsPage');

        // A claim naming a page that is no longer on screen is not a claim. The
        // alternative — a stale claim that keeps refusing clicks — leaves the
        // page with NO owner, which is worse than the collision it prevents.
        assert.equal(pages.pageOwner(), null);
        assert.equal(pages.mayActivate('recipe'), true);
    });

    test('not even the advance button — v2 leaves its own pages now', async () => {
        renderPage('applyFlowMyExpPage');
        await pages.observePageState({ sleep });

        const next = dom.document.createElement('button');
        next.setAttribute('data-automation-id', 'pageFooterNextButton');
        dom.document.body.appendChild(next);

        // There was an exception here while v2 could fill a page but not leave
        // one. C3 ended it: a page v2 owns and does not advance is a page v2
        // says is unfinished, and pressing Next on it produces the validation
        // wall that v1 would then have to read as ours.
        assert.equal(pages.mayActivate('recipe', next), false);
        assert.equal(pages.mayActivate('mdlz-v2', next), true);
    });
});

// ── the negative that makes the migration safe ───────────────────────────

describe('on a page v2 owns, v1 never runs', () => {
    const route = (...args) => router.routeAfterV2(...args);

    test('a page v2 took is v2\'s result', () => {
        const r = route({ took: true, pageIsV2Owned: true, report: { matched: true, filled: 3 } });
        assert.equal(r.useV1, false);
        assert.equal(r.result.filled, 3);
    });

    test('a page v2 owns but DECLINED is still not v1\'s', () => {
        // "Declined" on an owned page means not ready or not answerable yet. It
        // has never meant "free for somebody else".
        const r = route({ took: false, pageIsV2Owned: true, reason: 'page still settling' });
        assert.equal(r.useV1, false);
        assert.equal(r.result.deferred, true);
        assert.equal(r.result.filled, 0);
    });

    test('a page v2 CRASHED on is not handed over either', () => {
        // Handing over a half-written widget puts two owners on it, each
        // verifying against state the other left behind.
        const r = route({ pageIsV2Owned: true }, new Error('boom'));
        assert.equal(r.useV1, false);
        assert.match(r.result.error, /mdlz-v2: boom/);
    });

    test('a page v2 does not own goes to v1, crash or no crash', () => {
        assert.equal(route({ took: false, pageIsV2Owned: false, reason: 'v2 does not own REVIEW' }).useV1, true);
        assert.equal(route({ pageIsV2Owned: false }, new Error('boom')).useV1, true);
    });
});
