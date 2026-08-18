// The PwC education incident, as tests.
//
// MEASURED (PwC 715624WD, 2026-08-15): that tenant's education row has NO
// formField-schoolName — it renders the school-PICKER variant, formField-school
// ("School or University*", search-on-Enter), plus degree / fieldOfStudy /
// firstYearAttended / lastYearAttended. The v2 anchor hardcoded mdlz's free-text
// id, so PwC's rows were invisible: Add succeeded on every click while the row
// count read 0 forever. Ungoverned that was a 39-row runaway; with the add
// verified honestly it was an add-per-pass livelock that ran 12+ minutes with
// no escalation. Three fixes, each tested here:
//
//   1. the education anchor and keys read BOTH measured row shapes;
//   2. the school picker is answered as a LADDER (CV's own name, then
//      bracket-stripped, then Workday's own "School Not Listed" — never a
//      semantically-near school), and a committed catalogue spelling still
//      claims the row it sits in;
//   3. an Add that commits a row the planner cannot recognise is remembered and
//      DROPPED next pass — one blind add is the whole measurement — so the page
//      advances over a non-blocking gap instead of looping.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';

let dom;
let planner;
let executors;
let rowlib;
let v2;
let watchdog;
let SEL;
let RESULT;
let PAGE_LOCK;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 12)));

// One education entry, spelled the way CVs actually spell it — with the
// bracketed acronym a catalogue never holds.
const PWC_CV = {
    education: [{
        institution: 'Foreign Trade University (FTU)',
        degree: 'Bachelor of Business Administration',
        start_date: '2015-09',
        end_date: '2019-06',
    }],
};

before(async () => {
    console.log = () => { };
    // The PwC apply URL: tenant in the SUBDOMAIN, so isOwnedPage() says yes for
    // the tenant this whole file is about.
    dom = installDom({ href: 'https://pwc.wd3.myworkdayjobs.com/en-US/Global_Experienced_Careers/job/HCMC/x_715624WD/apply/applyManually' });
    planner = await import('../src/content-agent/mdlz-v2/planner.js');
    executors = await import('../src/content-agent/mdlz-v2/executors.js');
    rowlib = await import('../src/content-agent/mdlz-v2/row.js');
    v2 = await import('../src/content-agent/mdlz-v2/index.js');
    watchdog = await import('../src/content-agent/mdlz-v2/interaction-watchdog.js');
    ({ SEL, RESULT, PAGE_LOCK } = await import('../src/content-agent/mdlz-v2/config.js'));
    globalThis.chrome = { storage: { local: { get: (_k, cb) => cb({ copoMdlzV2: true }) } } };
});

after(() => dom?.uninstall());

beforeEach(() => {
    dom.document.body.children.forEach((c) => { c.parentNode = null; });
    dom.document.body.children = [];
    dom.document.activeElement = dom.document.body;
    globalThis.window[PAGE_LOCK] = null;
    watchdog.forgetInteractionStuck();
    // The anchor-blind memory lives on window for the page's lifetime — tests
    // must not inherit each other's blind sections.
    watchdog.forgetAnchorBlind();
});

const el = (tag, attrs = {}, parent = null) => {
    const n = dom.document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
};

/** The My Experience page id, so observePageState names the right page. */
const myExpPage = () => el('div', { 'data-automation-id': 'applyFlowMyExpPage' }, dom.document.body);

/** An Education section the way PwC renders it: heading, rows, one Add. */
function eduSection(page) {
    const box = el('div', {}, page);
    el('h3', {}, box).textContent = 'Education';
    return box;
}

/**
 * A PwC-shaped education row: the school PICKER (search input, no schoolName
 * anywhere), a degree listbox, and the two attendance-year listboxes.
 */
function pickerEduRow(section, { school = '' } = {}) {
    const row = el('div', {}, section);
    const wrap = el('div', { 'data-automation-id': 'formField-school' }, row);
    el('label', {}, wrap).textContent = 'School or University*';
    el('input', {
        type: 'text', placeholder: 'Search',
        'data-uxi-widget-type': 'selectinput', enterkeyhint: 'search',
    }, wrap);
    // A committed picker shows its answer as a chip, the catalogue's spelling.
    if (school) el('div', { 'data-automation-id': 'selectedItem' }, wrap).textContent = school;
    const listbox = (id, label) => {
        const w = el('div', { 'data-automation-id': id }, row);
        el('label', {}, w).textContent = label;
        el('button', { 'aria-haspopup': 'listbox' }, w).textContent = 'Select One';
        return w;
    };
    listbox('formField-degree', 'Degree');
    listbox('formField-firstYearAttended', 'First Year Attended');
    listbox('formField-lastYearAttended', 'Last Year Attended');
    return row;
}

// ── the ladder and the year, as data ─────────────────────────────────────

describe('what the school picker is asked for', () => {
    test('the CV\'s own name, its bracket-stripped stem, then Workday\'s own escape — nothing else', () => {
        assert.deepEqual(
            planner.schoolLadder({ institution: 'Foreign Trade University (FTU)' }),
            ['Foreign Trade University (FTU)', 'Foreign Trade University', '=School Not Listed'],
        );
        // No bracket, no duplicate rung.
        assert.deepEqual(
            planner.schoolLadder({ institution: 'RMIT' }),
            ['RMIT', '=School Not Listed'],
        );
        // An entry with no school name still has the honest fallback.
        assert.deepEqual(planner.schoolLadder({}), ['=School Not Listed']);
    });

    test('field of study is the major — salvaged from a mis-slotted degree, never a qualification', () => {
        // MEASURED live: the extractor put the subject in `degree`.
        assert.equal(planner.fieldOfStudy({ degree: 'Marketing' }), 'Marketing',
            'a subject sitting in the degree key IS the major — the CV stated it');
        // Explicit keys always win.
        assert.equal(planner.fieldOfStudy({ field_of_study: 'Finance', degree: 'B.Sc' }), 'Finance');
        assert.equal(planner.fieldOfStudy({ major: 'Economics' }), 'Economics');
        // A real qualification is NOT a field of study — left for the candidate.
        assert.equal(planner.fieldOfStudy({ degree: 'B.B.A.' }), '');
        assert.equal(planner.fieldOfStudy({ degree: 'Bachelor of Science' }), '');
        assert.equal(planner.fieldOfStudy({ degree: 'Master of Arts' }), '');
        assert.equal(planner.fieldOfStudy({}), '');
        assert.equal(planner.isQualification('Marketing'), false);
        assert.equal(planner.isQualification('PhD'), true);
    });

    test('a CV date becomes the year a dropdown offers — and "Present" becomes nothing', () => {
        assert.equal(planner.yearOf('2015-09-01'), '2015');
        assert.equal(planner.yearOf('09/2019'), '2019');
        assert.equal(planner.yearOf('2019'), '2019', 'a bare year has no month, and must still be a year');
        assert.equal(planner.yearOf('Present'), '');
        assert.equal(planner.yearOf(''), '');
    });
});

// ── the planner, against the PwC row shape ───────────────────────────────

describe('the planner reads the picker variant', () => {
    test('an empty picker row is claimed and filled — never a reason to Add', () => {
        const page = myExpPage();
        pickerEduRow(eduSection(page));

        const { tasks } = planner.planStep(PWC_CV);
        assert.equal(tasks.filter((t) => t.kind === 'addRow').length, 0,
            'the row is on the page; PwC\'s livelock began with the planner not seeing it');

        const school = tasks.find((t) => t.field === 'formField-school');
        assert.ok(school, 'the picker is planned, as a ladder');
        assert.deepEqual(school.ladder,
            ['Foreign Trade University (FTU)', 'Foreign Trade University', '=School Not Listed']);
        assert.ok(!tasks.some((t) => t.field === 'formField-schoolName'),
            'the free-text variant does not render here, so it is not planned here');

        assert.equal(tasks.find((t) => t.field === 'formField-firstYearAttended')?.want, '2015');
        assert.equal(tasks.find((t) => t.field === 'formField-lastYearAttended')?.want, '2019');
        assert.ok(tasks.some((t) => t.field === 'formField-degree' && t.ladder?.length), 'degree stays a ladder');
    });

    test('the catalogue\'s spelling of the school still claims the row the entry put it in', () => {
        const page = myExpPage();
        const section = eduSection(page);
        // The picker committed the CATALOGUE's name — not the CV's "(FTU)" form.
        pickerEduRow(section, { school: 'Foreign Trade University' });

        const { tasks } = planner.planStep(PWC_CV);
        assert.equal(tasks.filter((t) => t.kind === 'addRow').length, 0,
            'a claimed row must never read as nobody\'s — that is the runaway');
        // And the entry's OTHER fields still resolve into that same row.
        const degree = tasks.find((t) => t.field === 'formField-degree');
        assert.ok(degree, 'degree is planned for the claimed row');
        const wrap = planner.resolveTarget(degree);
        assert.ok(wrap, 'mid-pass, degree finds its row through the catalogue spelling');
        assert.equal(wrap.getAttribute('data-automation-id'), 'formField-degree');
    });

    test('a committed "School Not Listed" is the fallback\'s own answer, and claims the row too', () => {
        const page = myExpPage();
        pickerEduRow(eduSection(page), { school: 'School Not Listed' });

        const { tasks } = planner.planStep(PWC_CV);
        assert.equal(tasks.filter((t) => t.kind === 'addRow').length, 0);
    });
});

// ── the add, verified honestly ───────────────────────────────────────────

describe('an Add is proven by growth the planner can and cannot see', () => {
    /** An Add button whose click really adds — what it adds is the test's choice. */
    function addButton(section, make) {
        const btn = el('button', { 'data-automation-id': 'add-button' }, section);
        btn.textContent = 'Add Another';
        btn.addEventListener('click', () => setTimeout(make, 2));
        return btn;
    }

    test('a row the anchor recognises commits, and is not anchor-blind', async () => {
        const page = myExpPage();
        const section = eduSection(page);
        const btn = addButton(section, () => pickerEduRow(section));

        const r = await executors.addRow(btn, { sleep, anchor: SEL.row.schoolName, budgetMs: 300 });
        assert.equal(r.result, RESULT.COMMITTED);
        assert.equal(r.rows, 1, 'the compound anchor sees the picker row');
        assert.ok(!r.anchorBlind);
    });

    test('a panel of UNKNOWN fields still commits — flagged anchor-blind, never re-clicked into a runaway', async () => {
        const page = myExpPage();
        const section = eduSection(page);
        // A third tenant variant nobody has measured: real fields, foreign ids.
        const btn = addButton(section, () => {
            const row = el('div', {}, section);
            const w = el('div', { 'data-automation-id': 'formField-institutionRef' }, row);
            el('input', { type: 'text' }, w);
        });

        const r = await executors.addRow(btn, { sleep, anchor: SEL.row.schoolName, budgetMs: 300 });
        assert.equal(r.result, RESULT.COMMITTED, 'the click DID work — calling it a timeout re-arms it forever');
        assert.equal(r.anchorBlind, true, 'and the escalation signal says the row is unrecognisable');
    });

    test('an Add that truly does nothing is still a timeout', async () => {
        const page = myExpPage();
        const section = eduSection(page);
        const btn = addButton(section, () => { });

        const r = await executors.addRow(btn, { sleep, anchor: SEL.row.schoolName, budgetMs: 120 });
        assert.equal(r.result, RESULT.OPEN_TIMEOUT);
    });
});

// ── the escalation: one blind add, then drop and move on ─────────────────

describe('a blind add is dropped, not repeated', () => {
    const pass = () => v2.runMdlzV2({ cv: PWC_CV, sleep, addMs: 300, advance: false });

    test('pass one adds and learns; pass two drops the add and completes over the gap', async () => {
        const page = myExpPage();
        const section = eduSection(page);
        const btn = el('button', { 'data-automation-id': 'add-button' }, section);
        btn.textContent = 'Add Another';
        // The unmeasured variant: the Add works, the row is unrecognisable.
        btn.addEventListener('click', () => setTimeout(() => {
            const row = el('div', {}, section);
            const w = el('div', { 'data-automation-id': 'formField-institutionRef' }, row);
            el('input', { type: 'text' }, w);
        }, 2));

        const first = await pass();
        assert.equal(first.took, true);
        const add = first.ledger.tasks.find((t) => t.id === 'education.add');
        assert.equal(add?.result, RESULT.COMMITTED, 'the add itself worked');

        const second = await pass();
        assert.equal(second.took, true);
        assert.equal(second.ledger.tasks.length, 0,
            'the add is NOT re-armed — re-arming every pass was the measured livelock');
        const gap = second.gaps.find((g) => g.section === 'education' && g.dropped);
        assert.ok(gap, 'the section is carried as a gap the review can name');
        assert.equal(v2.pageComplete(second.ledger, second.gaps).complete, true,
            'a dropped gap does not hold the page — Workday\'s own validation is the arbiter now');

        // The runaway proof: however many passes ran, exactly ONE panel exists.
        assert.equal(dom.document.querySelectorAll('[data-automation-id="formField-institutionRef"]').length, 1);
    });
});
