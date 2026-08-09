// The gate for Milestone 3: a second pass writes nothing, and no row is ever
// added twice.
//
// The incident this is built against: a form with three "Vietnamese" rows under
// a red "Duplicate language entries are not allowed." Two defects met there —
// a grow loop that read its work list ONCE and never recomputed it, and a
// planner that skipped empty rows entirely, so a blank already on the page
// counted for nothing and Add kept being clicked. Every test below is a way of
// asking whether either of those can happen again.
//
// The other half of M3 is the decision to TAKE the page. v2 owning a step it
// cannot finish would be worse than v1 owning it: the step would end unfilled
// with nobody left to fill it. So declining is tested as carefully as filling.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';
import { DEGREES, LEVELS, buildHostilePage } from './harness/hostile-page.js';

let dom;
let page;
let planner;
let rowlib;
let v2;
let RESULT;
let PAGE_LOCK;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 12)));
const WORK = '[data-automation-id="formField-jobTitle"]';
const LANG = '[data-automation-id="formField-language"]';

const CV = {
    experience: [
        { title: 'Product Owner', company: 'Acme', start_date: '2021-03', end_date: '2024-05', description: 'Owned the roadmap' },
        { title: 'Business Analyst', company: 'Globex', start_date: '2019-01', end_date: 'Present' },
    ],
    education: [{ institution: 'RMIT', degree: DEGREES[0] }],
    languages: [{ language: 'English', level: LEVELS[2] }, { language: 'English (IELTS 7.5)' }],
    skills: ['Figma', 'SQL'],
};

/** Run one pass of the controller, as the router would. */
// addMs is tight on purpose: an Add that never lands should fail this gate
// fast rather than sit out its full live-page budget three times over.
// advance:false — these tests are about what gets FILLED. Leaving the page
// mid-assertion would measure the wizard instead.
const pass = () => v2.runMdlzV2({ cv: CV, sleep, addMs: 500, advance: false });

/** Passes until nothing changes — the loop v1's caller already runs. */
async function settle(maxPasses = 8) {
    const seen = [];
    for (let i = 0; i < maxPasses; i++) {
        const r = await pass();
        seen.push(r);
        if (!r.took) break;
        const moved = r.ledger.tasks.some((t) => t.result === RESULT.COMMITTED);
        if (!moved) break;
    }
    return seen;
}

before(async () => {
    console.log = () => { };
    dom = installDom();
    planner = await import('../src/content-agent/mdlz-v2/planner.js');
    rowlib = await import('../src/content-agent/mdlz-v2/row.js');
    v2 = await import('../src/content-agent/mdlz-v2/index.js');
    ({ RESULT, PAGE_LOCK } = await import('../src/content-agent/mdlz-v2/config.js'));
    // The flag is off by default and read from chrome.storage; this is a page
    // where it has been turned on.
    globalThis.chrome = { storage: { local: { get: (_k, cb) => cb({ copoMdlzV2: true }) } } };
});

after(() => dom?.uninstall());

beforeEach(() => {
    dom.document.body.children.forEach((c) => { c.parentNode = null; });
    dom.document.body.children = [];
    dom.document.activeElement = dom.document.body;
    globalThis.window[PAGE_LOCK] = null;
    page = buildHostilePage(dom.document);
});

// ── the plan ─────────────────────────────────────────────────────────────

describe('the plan is derived from the page, every time it is asked', () => {
    test('an empty row is where the next entry goes — not a reason to add one', () => {
        page.addWorkRow({});
        page.addWorkRow({});                       // two blanks, two jobs
        const { tasks } = planner.planStep(CV);

        assert.equal(tasks.filter((t) => t.kind === 'addRow' && t.section === 'work').length, 0,
            'a blank row is somewhere to put an entry, not nothing');
        // Both entries were placed, each into its own blank.
        assert.deepEqual(
            [...new Set(tasks.filter((t) => t.section === 'work').map((t) => t.rowKey))],
            ['product owner@acme', 'business analyst@globex'],
        );
    });

    test('one blank and two jobs is one Add — and only one', () => {
        page.addWorkRow({});
        const { tasks } = planner.planStep(CV);

        // The blank takes the first entry; the second needs a row that does not
        // exist yet. What must never happen is an Add for BOTH — that is the
        // shape that filled a section to its cap with blanks.
        assert.equal(tasks.filter((t) => t.kind === 'addRow' && t.section === 'work').length, 1);
        assert.ok(tasks.some((t) => t.rowKey === 'product owner@acme'),
            'the blank is used, not skipped');
    });

    test('a row that already holds an entry is claimed by what it says', () => {
        page.addWorkRow({ title: 'Business Analyst', company: 'Globex' });
        page.addWorkRow({ title: 'Product Owner', company: 'Acme' });

        // Page order is BA then PO; CV order is PO then BA. An index would put
        // each entry into the other's row.
        const { tasks } = planner.planStep(CV);
        const dates = tasks.filter((t) => t.field === 'formField-startDate');
        assert.deepEqual(dates.map((t) => t.rowKey), ['product owner@acme', 'business analyst@globex']);
    });

    test('a section it can name by its heading is addable even with no rows', () => {
        // "Work Experience" is Workday's own string for this section, from the
        // language bundle the apply flow loads. It is what tells one of the four
        // Add buttons from the next when no row exists yet.
        const { tasks, gaps } = planner.planStep(CV);       // no rows on the page at all
        const add = tasks.find((t) => t.kind === 'addRow' && t.section === 'work');
        assert.ok(add, 'the section is identifiable');
        assert.equal(add.via, 'heading');
        assert.deepEqual(gaps.filter((g) => /add button/.test(g.why)), []);
    });

    test('the heading strategy can be switched off from a console', () => {
        // It is grounded in Workday's own copy and has never met a real page.
        // If a live run puts a row in the wrong section, this is how it gets
        // turned off — without a rebuild, and without giving up the sections
        // that already have rows to be found through.
        const { tasks, gaps } = planner.planStep(CV, { addVia: 'rows' });
        assert.equal(tasks.filter((t) => t.kind === 'addRow').length, 0);
        assert.ok(gaps.some((g) => g.section === 'work' && /add button/.test(g.why)));
    });

    test('a section it can name NEITHER way is declared, not guessed at', () => {
        // No rows and no heading: nothing on the page says which button belongs
        // to Work Experience, and clicking the wrong one writes a job into
        // Education.
        dom.document.body.children.forEach((c) => { c.parentNode = null; });
        dom.document.body.children = [];
        page = buildHostilePage(dom.document, { headings: false });

        const { tasks, gaps } = planner.planStep(CV);
        assert.equal(tasks.filter((t) => t.kind === 'addRow' && t.section === 'work').length, 0);
        assert.ok(gaps.some((g) => g.section === 'work' && /add button/.test(g.why)));
    });

    test('one row per language, whatever the CV called it', () => {
        page.addLanguageRow({});
        const { tasks } = planner.planStep(CV);
        const langs = tasks.filter((t) => t.section === 'languages' && t.field === 'formField-language');
        // "English" and "English (IELTS 7.5)" are one language. Two rows for it
        // is the red "Duplicate language entries are not allowed."
        assert.equal(langs.length, 1);
        assert.equal(langs[0].want, 'English');
    });

    test('a current role plans the tick and no To at all', () => {
        page.addWorkRow({});
        page.addWorkRow({});
        const { tasks } = planner.planStep(CV);
        const ba = tasks.filter((t) => t.rowKey === 'business analyst@globex');
        assert.ok(ba.some((t) => t.field === 'formField-currentlyWorkHere'));
        assert.equal(ba.filter((t) => t.field === 'formField-endDate').length, 0);
    });

    test('a CV date becomes a month and a year, or nothing at all', () => {
        assert.deepEqual(planner.monthYear('2021-03'), { month: 3, year: 2021 });
        assert.deepEqual(planner.monthYear('2019-01-15'), { month: 1, year: 2019 });
        assert.deepEqual(planner.monthYear('March 2021'), { month: 3, year: 2021 });
        assert.equal(planner.monthYear('Present'), null);
        assert.equal(planner.monthYear('hiện tại'), null);
        assert.equal(planner.monthYear(''), null);
    });
});

// ── THE GATE ─────────────────────────────────────────────────────────────

describe('MILESTONE 3 GATE — a second pass writes nothing', () => {
    /** A page shaped like a fresh draft: one blank row per repeating section. */
    const draft = () => {
        page.addWorkRow({});
        page.addEducationRow({});
        page.addLanguageRow({});
    };

    test('the step is filled, and filled once', async () => {
        draft();
        const passes = await settle();

        const rows = rowlib.rowsOf(WORK);
        assert.equal(rows.length, 2, 'two jobs, two rows — no more');
        assert.equal(rowlib.valueIn(rows[0], 'formField-jobTitle'), 'Product Owner');
        assert.equal(rowlib.valueIn(rows[1], 'formField-jobTitle'), 'Business Analyst');
        assert.deepEqual(page.chipsOn('skills'), ['Figma', 'SQL']);
        assert.ok(passes.length >= 2, 'adding a row costs a pass, by design');
    });

    test('and the pass after that writes nothing at all', async () => {
        draft();
        await settle();

        const quiet = await pass();
        assert.equal(quiet.took, true, 'v2 still owns the page');
        const moved = quiet.ledger.tasks.filter((t) => t.result !== RESULT.SATISFIED);
        assert.deepEqual(moved.map((t) => `${t.id}:${t.result}`), [],
            'every field should read as already right');
        assert.equal(quiet.report.filled, 0);
    });

    test('and no section grows a row it did not need', async () => {
        draft();
        await settle();
        const before = rowlib.rowsOf(WORK).length;

        await pass();
        await pass();

        assert.equal(rowlib.rowsOf(WORK).length, before, 'the duplicate-row bug, in one assertion');
        assert.equal(rowlib.rowsOf(LANG).length, 1);
    });

    test('the row an Add produced is the row the next pass fills', async () => {
        draft();
        await settle();

        // Nothing was written into the blank the Add left behind, and nothing
        // was written twice: each row holds its own entry, whole.
        const rows = rowlib.rowsOf(WORK);
        assert.equal(rowlib.valueIn(rows[1], 'formField-companyName'), 'Globex');
        assert.equal(rows[1].querySelectorAll('[data-automation-id="formField-endDate"]').length, 0,
            'the current role has no To — and the tick is what removed it');
    });

    test('every date went in through the picker, and reads back from the page', async () => {
        draft();
        await settle();

        const first = page.workRows()[0];
        assert.equal(first.start().month.getAttribute('aria-valuenow'), '3');
        assert.equal(first.start().year.getAttribute('aria-valuenow'), '2021');
        assert.deepEqual(page.dateKeys, [], 'no key was ever sent to a date section');
        assert.deepEqual(page.dateWrites, []);
    });

    test('the page is left clear — no list, no calendar, nothing owed', async () => {
        draft();
        const passes = await settle();
        for (const p of passes.filter((x) => x.took)) {
            assert.equal(p.ledger.leaks, 0, `${p.report.step} leaked a popup`);
            assert.ok(p.ledger.clean);
        }
        assert.equal(page.openCount(), 0);
        assert.equal(page.pickerOpen(), 0);
    });

    test('a pass that finds everything already right is the one that advances', async () => {
        // Filling and then advancing in one breath means leaving on the strength
        // of what we just wrote. This leaves on the strength of what the page
        // says — the same check the second-pass gate makes.
        draft();
        await settle();
        const moved = await v2.runMdlzV2({ cv: CV, sleep, addMs: 500 });

        assert.equal(moved.report.filled, 0, 'nothing left to do');
        assert.equal(moved.navigation.result, 'ADVANCED', JSON.stringify(moved.navigation?.reason || ''));
        assert.equal(moved.report.advancedTo, 'APPLICATION_QUESTIONS');
        assert.equal(page.nav.clicks, 1);
    });

    test('an Add that hit-tested into thin air is retried, not reported as done', async () => {
        draft();
        await settle();
        // The measured failure: a click aimed below the fold hit-tests as
        // whatever covers that point, and no row appears. The harness ignores
        // any Add that was not scrolled to first — so an empty list here is the
        // proof the executor scrolls.
        assert.deepEqual(page.ignoredAdds, []);
    });
});

// ── the decision to take the page ────────────────────────────────────────

describe('v2 takes a step it can finish, and hands back one it cannot', () => {
    test('it declines a step that is not v2\'s at all', async () => {
        // A page nothing recognises. Naming a real step here makes the test
        // expire the day that step is ported — My Information and then
        // Application Questions both did exactly that.
        dom.document.body.children.forEach((c) => { c.parentNode = null; });
        dom.document.body.children = [];
        const other = dom.document.createElement('div');
        other.setAttribute('data-automation-id', 'someStepNobodyHasMeasured');
        dom.document.body.appendChild(other);

        const r = await v2.runMdlzV2({ cv: CV, sleep });
        assert.equal(r.took, false);
        assert.match(r.reason, /does not own/);
    });

    test('it declines while the résumé is still v1\'s to upload', async () => {
        page.addWorkRow({});
        const input = dom.document.createElement('input');
        input.setAttribute('data-automation-id', 'file-upload-input-ref');
        input.setAttribute('type', 'file');
        input.files = [];                              // nothing attached yet
        page.page.appendChild(input);

        const r = await v2.runMdlzV2({ cv: CV, sleep });
        assert.equal(r.took, false);
        assert.match(r.reason, /résumé/);
    });

    test('it declines a section whose Add button it cannot tell from the others', async () => {
        // Education and Languages have rows; Work has neither a row nor a
        // heading, so there is no way to say which of the three Add buttons is
        // its own.
        dom.document.body.children.forEach((c) => { c.parentNode = null; });
        dom.document.body.children = [];
        page = buildHostilePage(dom.document, { headings: false });
        page.addEducationRow({});
        page.addLanguageRow({});

        const r = await v2.runMdlzV2({ cv: CV, sleep });
        assert.equal(r.took, false);
        assert.match(r.reason, /cannot finish work/);
    });

    test('it does not take a page it has nothing to do on', async () => {
        page.addWorkRow({});
        const r = await v2.runMdlzV2({ cv: { experience: [] }, sleep });
        assert.equal(r.took, false);
        assert.match(r.reason, /nothing planned/);
    });

    test('the report it hands back is the shape v1\'s caller reads', async () => {
        page.addWorkRow({});
        page.addEducationRow({});
        page.addLanguageRow({});
        const r = await pass();

        assert.equal(r.took, true);
        assert.equal(r.report.matched, true);
        assert.equal(r.report.step, 'My Experience');
        assert.equal(typeof r.report.filled, 'number');
        assert.ok(Array.isArray(r.report.answers));
    });
});
