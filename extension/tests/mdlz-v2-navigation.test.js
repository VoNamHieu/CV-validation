// C3 — the only action on this flow that cannot be undone from inside it.
//
// Everything else can be re-read, re-verified, corrected next pass. A page you
// have left is gone, and on the last page it is an application somebody sent.
// So the four rules are tested as rules, not as behaviour that happens to hold:
//
//   never twice        — a double advance skips a page nobody will ever see
//   never mid-render   — Workday renders My Experience at 4 fields, then at 38
//   never by URL       — the URL moves once in the entire flow, then never
//   never Submit       — Review reuses pageFooterNextButton for it

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';
import { buildHostilePage } from './harness/hostile-page.js';

let dom;
let page;
let nav;
let NAV;
let pages;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 12)));
const complete = () => ({ complete: true });

before(async () => {
    console.log = () => { };
    dom = installDom();
    ({ advance: nav, NAV } = await import('../src/content-agent/mdlz-v2/navigation.js'));
    pages = await import('../src/content-agent/mdlz-v2/pages.js');
});

after(() => dom?.uninstall());

beforeEach(() => {
    dom.document.body.children.forEach((c) => { c.parentNode = null; });
    dom.document.body.children = [];
    globalThis.window.__copoNavLock = null;
    pages.releasePage();
    page = buildHostilePage(dom.document);
});

describe('leaving a page is one transaction', () => {
    test('it clicks once, waits for the old page to go, and hands over a ready one', async () => {
        const r = await nav({ sleep, verifyComplete: complete });

        assert.equal(r.result, NAV.ADVANCED, r.reason || '');
        assert.equal(r.from, 'MY_EXPERIENCE');
        assert.equal(r.to, 'APPLICATION_QUESTIONS');
        assert.equal(page.nav.clicks, 1, 'exactly one press');
        // And the page it handed over is settled, not the spinner the wizard
        // renders first.
        assert.notEqual(r.ready.state, 'HYDRATING');
    });

    test('the old page being gone is what proves it moved — not the URL', async () => {
        // The URL never changes in this flow after the first step, so it cannot
        // answer "did we leave". The page NODE can.
        const before = dom.document.location?.href;
        const r = await nav({ sleep, verifyComplete: complete });
        assert.equal(r.result, NAV.ADVANCED);
        assert.equal(dom.document.location?.href, before, 'nothing about the URL moved');
        assert.equal(dom.document.querySelectorAll('[data-automation-id="applyFlowMyExpPage"]').length, 0);
    });

    test('a second advance while one is in flight is refused, not queued', async () => {
        // Two callers reach this — the loop and a debug step — and they have
        // collided before. A double advance skips a whole page.
        const [a, b] = await Promise.all([
            nav({ sleep, verifyComplete: complete }),
            nav({ sleep, verifyComplete: complete }),
        ]);
        const outcomes = [a.result, b.result].sort();
        assert.deepEqual(outcomes, [NAV.ADVANCED, NAV.BUSY].sort());
        assert.equal(page.nav.clicks, 1, 'the page was pressed once, whatever the callers did');
    });
});

describe('the four refusals', () => {
    test('it does not leave a page that says it is not finished', async () => {
        const r = await nav({ sleep, verifyComplete: () => ({ complete: false, reason: 'From is empty' }) });
        assert.equal(r.result, NAV.INCOMPLETE);
        assert.equal(page.nav.clicks, 0, 'the button is not pressed to find out');
        assert.match(r.reason, /From is empty/);
    });

    test('and it treats a page that says nothing as not ready to leave', async () => {
        const r = await nav({ sleep, verifyComplete: () => ({}) });
        assert.equal(r.result, NAV.INCOMPLETE);
        assert.equal(page.nav.clicks, 0);
    });

    test('it does not leave mid-render', async () => {
        const spinner = dom.document.createElement('div');
        spinner.setAttribute('data-automation-id', 'loadingPanel');
        page.page.appendChild(spinner);

        const r = await nav({ sleep, verifyComplete: complete, settleMs: 120 });
        assert.equal(r.result, NAV.NOT_SETTLED);
        assert.equal(page.nav.clicks, 0);
    });

    test('it does not press Next on the review page', async () => {
        dom.document.body.children.forEach((c) => { c.parentNode = null; });
        dom.document.body.children = [];
        const review = dom.document.createElement('div');
        review.setAttribute('data-automation-id', 'applyFlowReviewPage');
        dom.document.body.appendChild(review);
        const btn = dom.document.createElement('button');
        btn.setAttribute('data-automation-id', 'pageFooterNextButton');
        btn.textContent = 'Submit';
        review.appendChild(btn);

        const r = await nav({ sleep, verifyComplete: complete });
        assert.equal(r.result, NAV.REFUSED_FINAL);
        assert.equal(btn.clickCount, 0, 'the application is not sent by an agent');
    });

    test('and it stops at a button that says Submit even on another page', async () => {
        // Belt and braces: the page check is the rule, the label is the backstop
        // for a page shape nobody has measured yet.
        page = buildHostilePage(dom.document, { nextLabel: 'Submit' });
        dom.document.body.children[0].remove();          // keep only the new page
        const r = await nav({ sleep, verifyComplete: complete });
        assert.equal(r.result, NAV.REFUSED_FINAL);
    });

    test('a list left open over the button blocks the advance instead of missing it', async () => {
        // A click aimed at a covered control hit-tests as the cover, and the page
        // simply does not move — which reads as "advance failed" for a reason
        // that has nothing to do with the page.
        page.wedgeOpenList(4);
        const r = await nav({ sleep, verifyComplete: complete, sweepMs: 300 });
        assert.equal(r.result, NAV.BLOCKED_BY_POPUP);
        assert.equal(page.nav.clicks, 0);
    });
});

describe('when the page answers instead of moving', () => {
    test('validation errors come back as the reason, not as a mystery', async () => {
        // The page that refuses to be left: the click lands, nothing navigates,
        // and the form says why. Reporting that as "timeout" would send the next
        // pass looking for a page that never went anywhere.
        page = buildHostilePage(dom.document, { blockAdvance: true });
        dom.document.body.children[0].remove();

        const r = await nav({ sleep, verifyComplete: complete, budgetMs: 400 });
        assert.equal(r.result, NAV.TIMEOUT);
        assert.deepEqual(r.errors, ['The field From is required']);
        assert.equal(page.nav.clicks, 1, 'once — it does not keep pressing');
    });
});
