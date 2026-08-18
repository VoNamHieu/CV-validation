// P6 — Review. The page with one button, and the button sends the application.
//
// Workday reuses `pageFooterNextButton` for Submit here (measured — it is the
// reason the agent's final-step handling exists), and the recipe also records a
// distinct `pageFooterSubmitButton`. Either ends the application, so the rule is
// not "avoid the submit button", it is DO NOT CLICK ON THIS PAGE.
//
// Three things enforce that, and this file checks all three: the navigation
// transaction refuses REVIEW by name, the controller never calls it, and owning
// the page means the click choke point refuses every caller that is not v2 — so
// v1, the generic recipe and the planner cannot click here either.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';

let dom;
let p6;
let pages;
let nav;
let NAV;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 12)));

const CV = {
    experience: [
        { title: 'Product Owner', company: 'Acme' },
        { title: 'Business Analyst', company: 'Globex' },
    ],
    education: [{ institution: 'RMIT', degree: 'B.B.A.' }],
    languages: [{ language: 'English' }, { language: 'Vietnamese' }],
};

/** A review page: headings in Workday's own words, and a Submit button. */
function buildReview({ work = 'Product Owner at Acme · Business Analyst at Globex',
    education = 'RMIT — B.B.A.', languages = 'English · Vietnamese',
    skills = 'Figma, SQL and 8 more', submitLabel = 'Submit' } = {}) {
    const el = (tag, attrs = {}, parent = null, text = '') => {
        const n = dom.document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
        if (text) n.textContent = text;
        if (parent) parent.appendChild(n);
        return n;
    };
    const page = el('div', { 'data-automation-id': 'applyFlowReviewPage' }, dom.document.body);
    const section = (title, body) => {
        const box = el('div', {}, page);
        el('h3', {}, box, title);
        el('div', {}, box, body);
        return box;
    };
    section('Work Experience', work);
    section('Education', education);
    section('Languages', languages);
    section('Skills', skills);
    const submit = el('button', { 'data-automation-id': 'pageFooterNextButton' }, page, submitLabel);
    const submit2 = el('button', { 'data-automation-id': 'pageFooterSubmitButton' }, page, 'Submit');
    return { page, submit, submit2 };
}

before(async () => {
    console.log = () => { };
    dom = installDom();
    p6 = await import('../src/content-agent/mdlz-v2/page-review.js');
    pages = await import('../src/content-agent/mdlz-v2/pages.js');
    ({ advance: nav, NAV } = await import('../src/content-agent/mdlz-v2/navigation.js'));
});

after(() => dom?.uninstall());

beforeEach(() => {
    dom.document.body.children.forEach((c) => { c.parentNode = null; });
    dom.document.body.children = [];
    globalThis.window.__copoNavLock = null;
    pages.releasePage();
});

describe('nothing on this page is clicked', () => {
    test('not the Next button, which here IS Submit', async () => {
        const page = buildReview();
        await p6.runReviewPage({ sleep, cv: CV });
        assert.equal(page.submit.clickCount, 0);
        assert.equal(page.submit2.clickCount, 0);
    });

    test('and the navigation transaction refuses this page by name', async () => {
        buildReview({ submitLabel: 'Save and Continue' });
        // Even mislabelled, and even asked directly: REVIEW is refused before
        // anything else is considered.
        const r = await nav({ sleep, verifyComplete: () => ({ complete: true }) });
        assert.equal(r.result, NAV.REFUSED_FINAL);
    });

    test('and while v2 holds it, nobody else may click either', async () => {
        buildReview();
        await pages.observePageState({ sleep });
        assert.equal(pages.pageOwner(), 'mdlz-v2');
        assert.equal(pages.mayActivate('recipe'), false);
        assert.equal(pages.mayActivate(undefined), false, 'the planner declares nothing, so it is refused');
    });
});

describe('what it reads', () => {
    test('the sections, in the words Workday gives them', async () => {
        buildReview();
        const r = await p6.runReviewPage({ sleep, cv: CV });
        assert.deepEqual(Object.keys(r.snapshot).sort(), ['education', 'languages', 'skills', 'work']);
        assert.match(r.snapshot.work.text, /Product Owner/);
    });

    test('a row the review does not show is reported', async () => {
        // The last chance to notice that a page three steps back did not take.
        buildReview({ work: 'Product Owner at Acme' });
        const r = await p6.runReviewPage({ sleep, cv: CV });
        assert.ok(r.gaps.some((g) => g.want === 'Business Analyst'), JSON.stringify(r.gaps));
    });

    test('a language missing from the summary is reported too', async () => {
        buildReview({ languages: 'English' });
        const r = await p6.runReviewPage({ sleep, cv: CV });
        assert.ok(r.gaps.some((g) => g.section === 'languages' && g.want === 'Vietnamese'));
    });

    test('a truncated list is reported as truncated, not expanded', async () => {
        // "and 8 more" is Workday shortening a list. The control that would
        // expand it has not been measured, and this is the page where an
        // unmeasured click submits.
        const page = buildReview();
        const r = await p6.runReviewPage({ sleep, cv: CV });
        assert.deepEqual(r.truncated, ['skills']);
        assert.equal(page.submit.clickCount, 0);
    });

    test('a complete review reports no gaps at all', async () => {
        buildReview();
        const r = await p6.runReviewPage({ sleep, cv: CV });
        assert.deepEqual(r.gaps, []);
    });
});

describe('what it reports', () => {
    test('filled is zero, and nothing says submitted', async () => {
        buildReview();
        const r = await p6.runReviewPage({ sleep, cv: CV });

        assert.equal(r.report.filled, 0);
        assert.equal(r.report.step, 'Review');
        assert.equal(r.report.handoff, 'awaiting user submit');
        // The one sentence a user reads before believing they are done must not
        // be able to say this was sent.
        assert.ok(!JSON.stringify(r.report).toLowerCase().includes('submitted'));
    });

    test('the review it hands over is the page\'s own summary, per section', async () => {
        buildReview();
        const r = await p6.runReviewPage({ sleep, cv: CV });
        assert.equal(r.report.review.education.heading, 'Education');
        assert.match(r.report.review.education.text, /RMIT/);
    });
});
