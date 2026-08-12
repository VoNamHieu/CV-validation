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
let isForgiven;
let isPageBlockingTask;
let DEVELOPER_FATAL;
let watchdog;

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
    ({ RESULT, PAGE_LOCK, isForgiven, isPageBlockingTask, DEVELOPER_FATAL } = await import('../src/content-agent/mdlz-v2/config.js'));
    watchdog = await import('../src/content-agent/mdlz-v2/interaction-watchdog.js');
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
    watchdog.forgetInteractionStuck();   // the interaction stuck-counts live on window; no bleed between tests
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

    test('the optional Skills chip-search task DECLARES its contract (searchMulti/many)', () => {
        // The plan-contract suite only checks fields that ALREADY carry a
        // declaration, and Skills is appended OUTSIDE planner.SECTIONS — so
        // deleting its capability/cardinality would leave that suite green while
        // the run CONTRACT_ERRORs at the executor (Skills is optional, and an
        // optional CONTRACT_ERROR used to be silently forgiven). Assert the real
        // planStep() task, so a lost declaration goes RED here.
        const { tasks } = planner.planStep(CV);
        const skills = tasks.find((t) => t.id === 'skills');
        assert.ok(skills, 'Skills is planned when its field renders and the CV has skills');
        assert.equal(skills.capability, 'searchMulti');
        assert.equal(skills.cardinality, 'many');
        assert.equal(skills.optional, true, 'and it stays optional — the guard must hold on an optional field');
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

    test('a row that already holds the answer is not a row to add to', () => {
        // THE ROW-GROWTH BUG, as a plan question.
        //
        // MEASURED (R-174102, 2026-08-09): a committed Language row shows
        // "English" on its button while its hidden input holds the OPTION'S
        // GUID. Read the input and every committed row keys the same, matches
        // no entry, and never looks like the language it plainly holds — so the
        // planner asks for another row, on every pass, forever. Three
        // "Vietnamese" rows and a fresh blank behind each one.
        page.addLanguageRow({ language: 'English' });
        const guid = page.langRows()[0].language.guid.value;
        assert.match(guid, /^[0-9a-f]{32}$/, 'the fixture must carry the GUID the real page does');

        const { tasks } = planner.planStep(CV);
        assert.equal(tasks.filter((t) => t.kind === 'addRow' && t.section === 'languages').length, 0,
            'the English row is already there — adding another is the growth');
        // And it is recognised as ALREADY holding English, not merely as a spare
        // blank that happens to be free.
        const row = page.langRows()[0].row;
        assert.equal(rowlib.valueIn(row, 'formField-language'), 'English');
    });

    test('a field of study is not a qualification, and defaults to a bachelor', () => {
        // THE MEASURED DEFECT (R-174102, 2026-08-09): Degree was sent
        // `e.degree`, which held "Marketing" — the field of STUDY. The
        // catalogue has no such row, so a REQUIRED field refused itself
        // USER_REQUIRED every pass and held the whole application on the page.
        const ladder = planner.degreeLadder({ degree: 'Marketing' });
        assert.deepEqual(ladder, ['Bachelor of Arts', 'Bachelor of Science', 'Bachelor']);
        // "ma" lives inside "marketing" — an unanchored rung reads a marketing
        // degree as a Master of Arts, which is a qualification nobody claimed.
        assert.ok(!ladder.some((r) => /master/i.test(r)));
    });

    test('a qualification the CV states outright wins over the default', () => {
        const say = (degree) => planner.degreeLadder({ degree })[0];
        assert.equal(say('MS in Computer Science'), 'Master of Science');
        assert.equal(say('M.S.'), 'Master of Science');
        assert.equal(say('MBA'), 'Master of Business Administration');
        assert.equal(say('PhD in Economics'), 'Doctor of Philosophy');
        // Vietnamese names level and field as one phrase — and the field alone
        // decides neither of these two.
        assert.equal(say('Thạc sĩ Quản trị Kinh doanh'), 'Master of Business Administration');
        assert.equal(say('Cử nhân Quản trị Kinh doanh'), 'Bachelor of Business Administration');
        assert.equal(say('Kỹ sư Xây dựng'), 'Bachelor of Engineering');
        assert.equal(say('Bachelor of Engineering'), 'Bachelor of Engineering');
        assert.equal(say('B.A. English'), 'Bachelor of Arts');
        // Nothing stated at all is still a bachelor — the row exists, so the
        // candidate has a degree; only its level is unsaid.
        assert.equal(say(''), 'Bachelor of Arts');
    });

    test('a mother tongue falls to the top rung a three-level scale offers', () => {
        // MEASURED (R-174102, 2026-08-09): the Overall catalogue is exactly
        // `1 - Beginner`, `2 - Intermediate`, `3 - Fluent`. The CV wrote the
        // candidate's Vietnamese as "Native", which matched nothing and refused
        // itself USER_REQUIRED — while English ("Fluent") committed first try.
        const native = planner.proficiencyLadder('Native');
        assert.equal(native[0], 'Native', 'the CV\'s own word is always tried first');
        assert.ok(native.includes('Fluent'), 'a scale with no Native row must still take a mother tongue');
        // Nothing is stretched upward.
        const mid = planner.proficiencyLadder('Intermediate');
        assert.ok(!mid.some((r) => /fluent|advanced/i.test(r)));
        assert.ok(planner.proficiencyLadder('B2').includes('Intermediate'));
        assert.ok(planner.proficiencyLadder('Sơ cấp').includes('Beginner'));
        // A level the CV never stated stays the candidate's to answer.
        assert.equal(planner.proficiencyLadder(''), null);
    });

    test('the fluent tick keys off the same tiers as Overall, and only those', () => {
        // "I am fluent in this language." shipped as "No" beside an Overall of
        // "3 - Fluent" on every application until 2026-08-10 (user-caught on
        // R-172396's review): the box was never planned, by v1 or v2. It is
        // planned from the SAME tiers that put Overall at Fluent, so one row
        // cannot carry two answers about the same fluency.
        page.addLanguageRow({});
        const { tasks } = planner.planStep(CV);
        const tick = tasks.find((t) => t.field === 'formField-native');
        assert.ok(tick, 'a fluent-tier level must plan the tick');
        assert.equal(tick.want, true);

        // Below the fluent tier nothing is planned — unticked is then the
        // truth, and a tick already on the page is never removed.
        const mid = planner.planStep({ languages: [{ language: 'French', level: 'Intermediate' }] });
        assert.ok(!mid.tasks.some((t) => t.field === 'formField-native'));

        assert.equal(planner.speaksFluently('Native'), true);
        assert.equal(planner.speaksFluently('tiếng mẹ đẻ'), true);
        assert.equal(planner.speaksFluently('C1'), true);
        assert.equal(planner.speaksFluently('B2'), false);
        assert.equal(planner.speaksFluently(''), false);
    });

    test('the degree task carries a ladder, and is not mistaken for a gap', () => {
        page.addEducationRow({});
        const { tasks, gaps } = planner.planStep(CV);
        const degree = tasks.find((t) => t.field === 'formField-degree');
        assert.ok(degree, 'degree must be planned even though it has no single want');
        assert.ok(Array.isArray(degree.ladder) && degree.ladder.length);
        assert.ok(!gaps.some((g) => g.field === 'formField-degree'));
    });

    test('GPA is planned only where the intern page renders it, from the CV alone', () => {
        // Measured R-172558 (Marketing Intern, 2026-08-11): "Overall Result
        // (GPA)" is required on the intern Education block and absent on the
        // executive one the flow was built against. v2 was blind to it, reported
        // 0 gaps, and tried to Save an invalid page — the whole intern run
        // stalled there. `whenPresent` is the isolation: nothing plans on a page
        // that does not render the field.

        // Executive shape — no GPA field on the row → no task, no gap, even with
        // a gpa in the CV. This is the proof the addition cannot touch it.
        page.addEducationRow({});
        const exec = planner.planStep({ education: [{ institution: 'RMIT', gpa: '3.6' }] });
        assert.ok(!exec.tasks.some((t) => t.field === 'formField-gradeAverage'));
        assert.ok(!exec.gaps.some((g) => g.field === 'formField-gradeAverage' || /gpa|overall result/i.test(g.field || '')));

        // Intern shape — the field renders, and the CV's gpa fills it.
        page = buildHostilePage(dom.document);
        page.addEducationRow({ school: 'RMIT', withGpa: true });
        const intern = planner.planStep({ education: [{ institution: 'RMIT', gpa: '3.6' }] });
        const gpa = intern.tasks.find((t) => t.field === 'formField-gradeAverage');
        assert.ok(gpa, 'GPA must be planned where the page renders it');
        assert.equal(gpa.want, '3.6');

        // Rendered but the CV has no gpa → a gap the candidate fills, never a
        // silent skip (never an invented number).
        page = buildHostilePage(dom.document);
        page.addEducationRow({ school: 'RMIT', withGpa: true });
        const noGpa = planner.planStep({ education: [{ institution: 'RMIT' }] });
        assert.ok(!noGpa.tasks.some((t) => t.field === 'formField-gradeAverage'));
        assert.ok(noGpa.gaps.some((g) => g.field === 'formField-gradeAverage'),
            'a required GPA with nothing in the CV is a gap, not a skipped field');
    });

    test('a comma inside brackets does not split a skill', () => {
        // MEASURED on R-174102, 2026-08-09: the CV's "unit economics (CPI, CAC,
        // LTV)" reached the form as three searches — `unit economics (CPI`,
        // `CAC`, `LTV)`. v1 carries the same rule and the reason: one such
        // fragment WAS found in a taxonomy and got added, so a piece of a phrase
        // became a claim on a real application.
        assert.deepEqual(
            planner.normaliseSkills(['unit economics (CPI, CAC, LTV)', 'Figma']),
            ['unit economics (CPI, CAC, LTV)', 'Figma']);
        // Separators OUTSIDE brackets still separate.
        assert.deepEqual(planner.normaliseSkills('SQL, Figma; Python'), ['SQL', 'Figma', 'Python']);
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

    test('it attaches the résumé itself instead of waiting for a v1 that is locked out', async () => {
        // MEASURED 2026-08-09, live on R-174102 — and it was a DEADLOCK, not a
        // decline. v2 owned My Experience and stood down every pass ("résumé
        // not attached yet — v1 owns the upload") while routeAfterV2 refuses v1
        // on every page v2 owns. So the only code that could attach the file
        // was never allowed to run: seven iterations, five of them identical,
        // then the loop gave up with "v2 owns this page and recorded nothing".
        //
        // What is pinned here is that v2 TAKES the page. A page whose owner
        // will not act and whose fallback may not is not a slow page, it is a
        // stopped one, and no widget has to be broken for that to happen.
        page.addWorkRow({});
        const input = dom.document.createElement('input');
        input.setAttribute('data-automation-id', 'file-upload-input-ref');
        input.setAttribute('type', 'file');
        input.files = [];                              // nothing attached yet
        page.page.appendChild(input);

        const r = await v2.runMdlzV2({ cv: CV, sleep });
        assert.equal(r.took, true, 'the page v2 owns is the page v2 must act on');
        assert.equal(r.pageIsV2Owned, true);
        // No CV was handed in, so the honest outcome is a NAMED gap — the stuck
        // detector reads `v2.gaps`, and an empty one is exactly what printed
        // "recorded nothing" about a page whose problem was perfectly sayable.
        assert.match(r.reason, /no CV file/);
        assert.equal(r.gaps.length, 1);
        assert.match(r.gaps[0].field, /Resume/);
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

    test('an optional field the catalogue cannot answer does not hold the page', async () => {
        // MEASURED (R-174102, 2026-08-09): this tenant's Skills catalogue
        // answers "No Items." to every term — "Sales" included, typed on a real
        // keyboard — and Workday renders the field "Type to Add Skills" with no
        // required marker. An application must not sit forever on a field the
        // employer did not ask for and the catalogue cannot satisfy.
        const ledger = {
            tasks: [
                { id: 'work[x].formField-jobTitle', result: RESULT.COMMITTED },
                { id: 'skills', optional: true, result: RESULT.OPTION_NOT_FOUND },
            ],
        };
        assert.equal(v2.pageComplete(ledger, []).complete, true);

        // But only for a SEMANTIC refusal. Optional and merely blocked may well
        // succeed next pass, and leaving on that is leaving early.
        const blocked = { tasks: [{ id: 'skills', optional: true, result: RESULT.BLOCKED_BY_POPUP }] };
        assert.equal(v2.pageComplete(blocked, []).complete, false);
        // And a REQUIRED field refused the same way still stops everything.
        const required = { tasks: [{ id: 'degree', optional: false, result: RESULT.OPTION_NOT_FOUND }] };
        assert.equal(v2.pageComplete(required, []).complete, false);
    });

    test('a CONTRACT_ERROR is NEVER forgiven — not even on an optional field', () => {
        // The one SEMANTIC outcome that is the DEVELOPER'S bug, not the
        // candidate's data. Skills is optional AND chip-search, so if its plan
        // ever loses its capability/cardinality declaration the executor returns
        // CONTRACT_ERROR — and forgiving that (as "just an optional field") would
        // advance the page in silence, the exact thing the guard exists to stop.
        const optionalContract = { tasks: [{ id: 'skills', optional: true, result: RESULT.CONTRACT_ERROR }] };
        assert.equal(v2.pageComplete(optionalContract, []).complete, false,
            'an optional chip-search field with no contract must BLOCK, not advance');
    });

    test('a page finished except for an unanswerable optional field still leaves', async () => {
        // MEASURED (R-174102, 2026-08-09): every field correct, no errors on
        // the form, and the run sat on the page for twelve identical
        // iterations. Skills was the only task not SATISFIED — optional, and
        // unsatisfiable on any pass because the catalogue answers "No Items."
        // to everything. The gate that decides whether to TRY advancing was
        // stricter than the check that decides whether the page is DONE, so the
        // page was never offered to the one that would have passed it.
        page.addWorkRow({ title: 'Product Owner', company: 'Acme' });
        page.addWorkRow({ title: 'Business Analyst', company: 'Globex' });
        page.addEducationRow({});
        page.addLanguageRow({});
        await settle();
        const before = page.nav.clicks;

        // A last pass on a page that is now entirely satisfied except Skills,
        // which this tenant's catalogue cannot answer.
        const r = await v2.runMdlzV2({ cv: CV, sleep, addMs: 500 });
        const skills = r.ledger?.tasks.find((t) => t.id === 'skills');
        assert.ok(skills, 'skills is planned');
        assert.equal(skills.optional, true, 'and it is optional — the employer did not ask for it');
        assert.ok(page.nav.clicks > before || r.navigation, 'the page must be offered to the advance check');
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

describe('the canonical task-status predicates — one question, one answer', () => {
    test('isForgiven: optional semantic miss yes, developer-fatal and required no', () => {
        assert.equal(isForgiven({ optional: true, result: RESULT.OPTION_NOT_FOUND }), true);
        assert.equal(isForgiven({ optional: true, result: RESULT.CONTRACT_ERROR }), false,
            'a contract bug is never an optional field to skip');
        assert.equal(isForgiven({ optional: false, result: RESULT.OPTION_NOT_FOUND }), false);
        assert.equal(isForgiven({ optional: true, result: RESULT.BLOCKED_BY_POPUP }), false,
            'an interaction state is retryable, not forgiven');
        assert.equal(isForgiven({ optional: true, result: RESULT.SATISFIED }), false);
    });

    test('isPageBlockingTask: the same verdict pageComplete, blockersFrom and the escalation share', () => {
        // developer-fatal always blocks, even optional
        assert.equal(isPageBlockingTask({ optional: true, result: RESULT.CONTRACT_ERROR }), true);
        // an optional forgivable miss never blocks — must not bump the streak
        assert.equal(isPageBlockingTask({ optional: true, result: RESULT.OPTION_NOT_FOUND }), false);
        // a required terminal failure blocks
        assert.equal(isPageBlockingTask({ optional: false, result: RESULT.USER_REQUIRED }), true);
        // a still-working / satisfied / retryable task does not block
        assert.equal(isPageBlockingTask({ result: RESULT.SATISFIED }), false);
        assert.equal(isPageBlockingTask({ result: RESULT.COMMITTED }), false);
        assert.equal(isPageBlockingTask({ result: RESULT.WAITING_HYDRATION }), false);
        assert.ok(DEVELOPER_FATAL.has(RESULT.CONTRACT_ERROR));
    });

    test('SKIPPED_OPTIONAL is a considered skip — always done, never blocking', () => {
        // the watchdog's downgrade for an optional widget that would never work
        assert.equal(isForgiven({ result: RESULT.SKIPPED_OPTIONAL }), true);
        assert.equal(isPageBlockingTask({ result: RESULT.SKIPPED_OPTIONAL }), false);
    });
});

describe('the multi-pass interaction watchdog — a stuck widget is resolved, not looped', () => {
    const ledgerOf = (tasks) => ({ tasks });

    test('an OPTIONAL widget stuck in interaction 3 passes RUNNING is skipped — not before', () => {
        const store = {};
        const mk = () => ledgerOf([{ id: 'skills', optional: true, result: RESULT.OPEN_TIMEOUT }]);
        const l1 = mk(); watchdog.interactionWatchdog(l1, 'MY_EXPERIENCE', store);
        assert.equal(l1.tasks[0].result, RESULT.OPEN_TIMEOUT, 'pass 1: left to retry (may work next pass)');
        const l2 = mk(); watchdog.interactionWatchdog(l2, 'MY_EXPERIENCE', store);
        assert.equal(l2.tasks[0].result, RESULT.OPEN_TIMEOUT, 'pass 2: still retrying');
        const l3 = mk(); const skipped = watchdog.interactionWatchdog(l3, 'MY_EXPERIENCE', store);
        assert.equal(l3.tasks[0].result, RESULT.SKIPPED_OPTIONAL, 'pass 3: resolved');
        assert.deepEqual(skipped, ['skills']);
        // and now the page can complete OVER it, instead of looping to the cap
        assert.equal(v2.pageComplete(l3, []).complete, true);
    });

    test('a REQUIRED widget stuck the same way is NEVER skipped — the outer loop escalates it', () => {
        const store = {};
        for (let i = 0; i < 5; i++) {
            const l = ledgerOf([{ id: 'degree', optional: false, result: RESULT.OPEN_TIMEOUT }]);
            watchdog.interactionWatchdog(l, 'MY_EXPERIENCE', store);
            assert.equal(l.tasks[0].result, RESULT.OPEN_TIMEOUT, `pass ${i + 1}: required stays interaction`);
        }
    });

    test('a settled pass in between RESETS the count — only CONSECUTIVE stuck passes resolve', () => {
        const store = {};
        watchdog.interactionWatchdog(ledgerOf([{ id: 'skills', optional: true, result: RESULT.OPEN_TIMEOUT }]), 'P', store);
        watchdog.interactionWatchdog(ledgerOf([{ id: 'skills', optional: true, result: RESULT.OPEN_TIMEOUT }]), 'P', store);
        watchdog.interactionWatchdog(ledgerOf([{ id: 'skills', optional: true, result: RESULT.SATISFIED }]), 'P', store);   // worked → reset
        const l = ledgerOf([{ id: 'skills', optional: true, result: RESULT.OPEN_TIMEOUT }]);
        watchdog.interactionWatchdog(l, 'P', store);
        assert.equal(l.tasks[0].result, RESULT.OPEN_TIMEOUT, 'one stuck pass after a reset, not three');
    });

    test('every interaction state counts toward the budget', () => {
        for (const r of [RESULT.OPEN_TIMEOUT, RESULT.WAITING_HYDRATION, RESULT.BLOCKED_BY_POPUP]) {
            const store = {};
            let last;
            for (let i = 0; i < 3; i++) {
                last = ledgerOf([{ id: 'x', optional: true, result: r }]);
                watchdog.interactionWatchdog(last, 'P', store);
            }
            assert.equal(last.tasks[0].result, RESULT.SKIPPED_OPTIONAL, `${r} resolves after 3 passes`);
        }
    });

    test('two fields are counted independently', () => {
        const store = {};
        // one field stuck all three passes; another stuck only the last
        for (let i = 0; i < 3; i++) {
            watchdog.interactionWatchdog(ledgerOf([{ id: 'skills', optional: true, result: RESULT.OPEN_TIMEOUT }]), 'P', store);
        }
        const l = ledgerOf([
            { id: 'skills', optional: true, result: RESULT.OPEN_TIMEOUT },
            { id: 'other', optional: true, result: RESULT.OPEN_TIMEOUT },
        ]);
        watchdog.interactionWatchdog(l, 'P', store);
        assert.equal(l.tasks[0].result, RESULT.SKIPPED_OPTIONAL, 'the long-stuck one resolves');
        assert.equal(l.tasks[1].result, RESULT.OPEN_TIMEOUT, 'the freshly-stuck one is still retrying');
    });

    test('a task ABSENT from a pass has its streak DROPPED — not carried across the gap', () => {
        // The bug: reset only fired when the task reappeared SETTLED. A task that
        // vanished from the plan for a pass (page did not render/plan it) kept its
        // count, so "fail ×2, gone, fail ×1" wrongly counted as the third strike.
        const store = {};
        const stuck = () => ledgerOf([{ id: 'skills', optional: true, result: RESULT.OPEN_TIMEOUT }]);
        watchdog.interactionWatchdog(stuck(), 'MY_EXPERIENCE', store);   // 1
        watchdog.interactionWatchdog(stuck(), 'MY_EXPERIENCE', store);   // 2
        // a pass where Skills was not even planned (absent from the ledger)
        watchdog.interactionWatchdog(ledgerOf([{ id: 'jobTitle', result: RESULT.SATISFIED }]), 'MY_EXPERIENCE', store);
        assert.equal(store['MY_EXPERIENCE::skills'], undefined, 'the absent task is dropped, not held at 2');
        const back = stuck();
        watchdog.interactionWatchdog(back, 'MY_EXPERIENCE', store);
        assert.equal(back.tasks[0].result, RESULT.OPEN_TIMEOUT, 'one stuck pass after the gap — its FIRST, not its third');
    });

    test('leaving the page and returning starts the streak over', () => {
        // forgetInteractionStuck() is what observePageState calls on a page-NAME
        // change; without it a return to My Experience would resume a stale streak.
        watchdog.forgetInteractionStuck();
        const stuck = () => ledgerOf([{ id: 'skills', optional: true, result: RESULT.OPEN_TIMEOUT }]);
        watchdog.interactionWatchdog(stuck(), 'MY_EXPERIENCE', watchdog.interactionStore());
        watchdog.interactionWatchdog(stuck(), 'MY_EXPERIENCE', watchdog.interactionStore());   // count 2 — one away from skip
        watchdog.forgetInteractionStuck();   // ← navigation away, then back
        const back = stuck();
        watchdog.interactionWatchdog(back, 'MY_EXPERIENCE', watchdog.interactionStore());
        assert.equal(back.tasks[0].result, RESULT.OPEN_TIMEOUT, 'the return is a fresh streak, not resumed at 2');
    });

    test('a new application in the same tab does not inherit the old run\'s streak', () => {
        // Same mechanism: the page name changes on the way to the new
        // application's My Experience, clearing the window store.
        watchdog.forgetInteractionStuck();
        const stuck = () => ledgerOf([{ id: 'skills', optional: true, result: RESULT.OPEN_TIMEOUT }]);
        watchdog.interactionWatchdog(stuck(), 'MY_EXPERIENCE', watchdog.interactionStore());
        watchdog.interactionWatchdog(stuck(), 'MY_EXPERIENCE', watchdog.interactionStore());   // application A: count 2
        watchdog.forgetInteractionStuck();   // ← A finished / navigated away
        const appB = stuck();
        watchdog.interactionWatchdog(appB, 'MY_EXPERIENCE', watchdog.interactionStore());
        assert.equal(appB.tasks[0].result, RESULT.OPEN_TIMEOUT, 'application B starts from zero');
    });
});
