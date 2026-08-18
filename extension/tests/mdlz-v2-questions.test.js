// P4 — Application Questions.
//
// MEASURED: every field on this step has a per-job dynamic automation id, so
// nothing can be selected by id and the question list changes with the posting.
// The controller discovers rather than plans, and the answers come from
// answers.js — the repo's answer policy, whose contract is the point: a rule can
// never introduce an option that is not on the page, and what it returns carries
// a `source` so the review shows the user which answers were the agent's.
//
// The three Mondelez asks on every job were measured on R-173278 with the
// phrasings used here. All three default "No", all three AGENT_DEFAULT, and the
// agent never submits — the user reads them at review.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';
import { buildQuestionsPage } from './harness/questions-page.js';

let dom;
let page;
let p4;
let RESULT;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 12)));
const PROFILE = { desiredSalary: '30,000,000 VND' };
const run = (extra = {}) => p4.runQuestionsPage({
    sleep, profile: PROFILE, cv: {}, commitMs: 900, stableMs: 120, advance: false, ...extra,
});

before(async () => {
    console.log = () => { };
    dom = installDom();
    p4 = await import('../src/content-agent/mdlz-v2/page-questions.js');
    ({ RESULT } = await import('../src/content-agent/mdlz-v2/config.js'));
});

after(() => dom?.uninstall());

beforeEach(() => {
    dom.document.body.children.forEach((c) => { c.parentNode = null; });
    dom.document.body.children = [];
    globalThis.window.__copoFillLock = null;
    globalThis.window.__copoNavLock = null;
    page = buildQuestionsPage(dom.document);
});

describe('the questions have no names, so they are found by what they ask', () => {
    test('the ids really are unguessable', () => {
        // Not a property of the harness: a property of the step. Any controller
        // holding an id from another job is holding nothing.
        const ids = page.ids();
        assert.equal(ids.length, 5);
        assert.ok(ids.every((id) => !/notice|salary|conflict|relative|visa/i.test(id)), ids.join(' '));
    });

    test('every question on the page is discovered by its text', async () => {
        const r = await run();
        assert.equal(r.ledger.tasks.length, 5);
    });
});

describe('the answers are the policy\'s, not this page\'s', () => {
    test('the three screening asks are answered No, and marked as the agent\'s', async () => {
        const r = await run();
        const committed = page.committed();

        assert.equal(committed['Do you have a conflict of interest with Mondelēz?'], 'No');
        assert.equal(committed['Do you have relatives currently employed by Mondelēz?'], 'No');
        assert.equal(committed['Will you now or in the future require Mondelēz to sponsor a work visa?'], 'No');
        // Every one of them is a claim ABOUT THE CANDIDATE, so the review has to
        // show whose answer it was. The agent never submits.
        const sources = r.report.answers.map((a) => a.source);
        assert.ok(sources.filter((s) => s === 'AGENT_DEFAULT').length >= 3, JSON.stringify(r.report.answers));
    });

    test('the profile beats the default when it holds one', async () => {
        // Resolution order is profile → default → offered-option fallback. A
        // candidate who does need sponsorship must not have it waived for them.
        await p4.runQuestionsPage({
            sleep, profile: { ...PROFILE, requiresSponsorship: 'Yes' }, cv: {}, advance: false, commitMs: 900,
        });
        assert.equal(page.committed()['Will you now or in the future require Mondelēz to sponsor a work visa?'], 'Yes');
    });

    test('the two text questions take their measured values', async () => {
        await run();
        assert.equal(page.notice.input.value, '30 days');
        // A free-text salary box gets the value verbatim; a numeric or VND box
        // would get digits, and "Negotiable" would step aside as a named gap.
        assert.equal(page.salary.input.value, '30,000,000 VND');
    });

    test('a question with no rule and no profile answer is LEFT, and reported', async () => {
        dom.document.body.children.forEach((c) => { c.parentNode = null; });
        dom.document.body.children = [];
        page = buildQuestionsPage(dom.document);
        // A question nothing in the policy speaks to.
        const odd = dom.document.createElement('div');
        odd.setAttribute('data-automation-id', 'formField-9ab3-c71');
        const label = dom.document.createElement('label');
        label.textContent = 'How many buttons are on this page?';
        odd.appendChild(label);
        const input = dom.document.createElement('input');
        input.setAttribute('type', 'text');
        odd.appendChild(input);
        page.page.appendChild(odd);

        const r = await run();
        assert.ok(r.gaps.some((g) => /how many buttons/i.test(g.question)));
        assert.equal(input.value, '', 'nothing invented into it');
    });
});

describe('the conditional branch', () => {
    test('answering No leaves the detail box absent', async () => {
        await run();
        assert.equal(page.conditional(), null);
    });

    test('and a Yes renders it, which the NEXT pass discovers', async () => {
        // The candidate answered Yes themselves on a draft they came back to —
        // which is the reason the question list is derived every pass rather
        // than planned once: answering one question renders another.
        page.answerAs(page.relatives, 'Yes');
        assert.ok(page.conditional(), 'the detail box is there now');

        const second = await run();
        assert.equal(second.ledger.tasks.length, 6, 'the new question was discovered, not planned around');
        // And the answer the candidate gave is left exactly as it was.
        assert.equal(page.committed()['Do you have relatives currently employed by Mondelēz?'], 'Yes');
    });
});

describe('leaving the page', () => {
    test('it does not leave while a question is unanswered', async () => {
        const odd = dom.document.createElement('div');
        odd.setAttribute('data-automation-id', 'formField-abc-1');
        const label = dom.document.createElement('label');
        label.textContent = 'Describe your favourite colour';
        odd.appendChild(label);
        odd.appendChild(dom.document.createElement('input'));
        page.page.appendChild(odd);

        const r = await p4.runQuestionsPage({ sleep, profile: PROFILE, cv: {}, commitMs: 900 });
        assert.equal(page.nav.clicks, 0);
        assert.equal(r.advanced, false);
    });

    test('a second pass answers nothing and then advances', async () => {
        await run();
        const quiet = await p4.runQuestionsPage({ sleep, profile: PROFILE, cv: {}, commitMs: 900 });

        assert.equal(quiet.report.filled, 0);
        assert.equal(quiet.advanced, true);
        assert.equal(page.nav.clicks, 1);
    });
});
