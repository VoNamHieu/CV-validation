// The gate for Milestone 2: no false verdict, on any widget, in any state.
//
// v1 could fill this form. What it could not do was say truthfully what it had
// done, and both directions of that were measured:
//
//   · a date the picker HAD committed came back as a failure, because the
//     verifier read `.value` — which a committed date leaves empty;
//   · a text field that was EMPTY came back as done, because the value survived
//     in `.value` for as long as it took to read it, and the next render put the
//     old one back.
//
// A run that cannot tell those apart cannot be trusted to stop, to retry, or to
// hand over. So the matrix below drives every capability through every state
// that has been seen on the live form, and compares the verdict against what the
// page itself says — never against what the executor believes.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';
import { DEGREES, buildHostilePage } from './harness/hostile-page.js';

let dom;
let page;
let fp;
let rowlib;
let exec;
let scheduler;
let RESULT;
let WIDGET;
let PAGE_LOCK;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 12)));
const ctx = () => ({ sleep, commitMs: 900, stableMs: 120 });

const field = (automationId) => fp.fingerprintOf(
    () => dom.document.querySelector(`[data-automation-id="${automationId}"]`),
    { name: automationId },
);
/** Takes the harness's row model or the container itself — both mean one row. */
const inRow = (row, automationId) => fp.fingerprintOf(
    () => rowlib.fieldIn(row.row || row, automationId), { name: automationId },
);

before(async () => {
    console.log = () => { };
    dom = installDom();
    fp = await import('../src/content-agent/mdlz-v2/fingerprint.js');
    rowlib = await import('../src/content-agent/mdlz-v2/row.js');
    exec = await import('../src/content-agent/mdlz-v2/executors.js');
    scheduler = await import('../src/content-agent/mdlz-v2/scheduler.js');
    ({ RESULT, PAGE_LOCK } = await import('../src/content-agent/mdlz-v2/config.js'));
    ({ WIDGET } = fp);
});

after(() => dom?.uninstall());

beforeEach(() => {
    dom.document.body.children.forEach((c) => { c.parentNode = null; });
    dom.document.body.children = [];
    dom.document.activeElement = dom.document.body;
    globalThis.window[PAGE_LOCK] = null;
    page = buildHostilePage(dom.document);
});

// ── capability comes from the shape ──────────────────────────────────────

describe('what a control IS, asked of the page and not of its name', () => {
    test('each widget on the step is recognised by what it holds', () => {
        const row = page.addWorkRow({ title: 'PO', company: 'Acme' });
        assert.equal(inRow(row, 'formField-jobTitle').kind, WIDGET.TEXT);
        assert.equal(inRow(row, 'formField-roleDescription').kind, WIDGET.TEXTAREA);
        assert.equal(inRow(row, 'formField-currentlyWorkHere').kind, WIDGET.CHECKBOX);
        assert.equal(inRow(row, 'formField-startDate').kind, WIDGET.DATE);
        assert.equal(field('formField-degree').kind, WIDGET.LISTBOX);
        assert.equal(field('formField-skills').kind, WIDGET.SEARCH_MULTI);
    });

    test('an EMPTY multi-select is still a multi-select', () => {
        // MEASURED on the live form (R-174102, My Experience, 2026-08-09):
        // Workday creates `selectedItemList` with the FIRST CHIP, so a chip-list
        // test can only ever recognise a multi-select that is already answered
        // — and Skills is empty every time, because being empty is why we are
        // there. Classified SEARCH_SINGLE, the executor typed all eight skills
        // into the box as one comma-joined string, nothing matched, and the
        // field burned OPEN_TIMEOUT ×3 at ~8s each on a widget that worked.
        const skills = field('formField-skills');
        assert.equal(skills.controls().chipList, null, 'no chip list until there is a chip');
        assert.equal(skills.kind, WIDGET.SEARCH_MULTI);
        // And the marker is what decides it, not the automation id: the next
        // tenant will call this field something else.
        const wrap = rowlib.fieldIn(page.page, 'formField-skills');
        wrap.setAttribute('data-automation-id', 'formField-someGuidNobodyPublished');
        assert.equal(fp.kindOf(wrap), WIDGET.SEARCH_MULTI);
    });

    test('a date is a date even though it is made of text inputs', () => {
        const row = page.addWorkRow({ title: 'PO', company: 'Acme' });
        const date = inRow(row, 'formField-startDate');
        // Two spinbuttons decide it, before any rule that would claim an input.
        // Getting this order wrong is how a date came to be typed into, which is
        // the one thing that has never once worked.
        assert.equal(date.kind, WIDGET.DATE);
        assert.equal(date.controls().spins.length, 2);
    });

    test('renaming the field does not change what the field is', () => {
        // The rule the whole layer rests on: a capability is resolved from the
        // shape found at runtime. The next tenant will call this something else.
        const row = page.addWorkRow({ title: 'PO', company: 'Acme' });
        const wrap = rowlib.fieldIn(row.row, 'formField-startDate');
        wrap.setAttribute('data-automation-id', 'formField-someGuidNobodyPublished');
        assert.equal(fp.kindOf(wrap), WIDGET.DATE);
    });
});

// ── the row is the owner ─────────────────────────────────────────────────

describe('a repeating section is owned by rows, not by labels', () => {
    test('three rows, one of them current, and To is not where an index says', () => {
        page.addWorkRow({ title: 'PO', company: 'Acme' });
        page.addWorkRow({ title: 'BA', company: 'Globex', current: true });
        page.addWorkRow({ title: 'Intern', company: 'Initech' });

        const rows = rowlib.rowsOf('[data-automation-id="formField-jobTitle"]');
        assert.equal(rows.length, 3);

        // The measured shape: 3 boxes over 2 To's. checkbox[2] and endDate[2]
        // are different rows, so any page-wide index pairing is already wrong.
        const boxes = dom.document.querySelectorAll('[data-automation-id="formField-currentlyWorkHere"]').length;
        const ends = dom.document.querySelectorAll('[data-automation-id="formField-endDate"]').length;
        assert.equal(boxes, 3);
        assert.equal(ends, 2);

        assert.equal(rowlib.fieldIn(rows[1], 'formField-endDate'), null, 'the current role has no To');
        assert.ok(rowlib.fieldIn(rows[2], 'formField-endDate'), 'the last row still has one');
    });

    test('a row is found again by what it says, not by where it was', () => {
        page.addWorkRow({ title: 'PO', company: 'Acme' });
        const target = page.addWorkRow({ title: 'BA', company: 'Globex' });

        const key = rowlib.keyOfWorkRow(target.row);
        assert.equal(key, 'BA@Globex');

        // A row inserted ABOVE is exactly what a re-render can do; an index would
        // now point at somebody else.
        page.addWorkRow({ title: 'CTO', company: 'Zzz' });
        const found = rowlib.findRow('[data-automation-id="formField-jobTitle"]', key);
        assert.equal(found, target.row);
    });

    test('an error belongs to the row that is showing it', () => {
        const first = page.addWorkRow({ title: 'PO', company: 'Acme' });
        const second = page.addWorkRow({ title: 'BA', company: 'Globex' });
        second.raiseError();

        // Workday says only "The field From is required"; the container is the
        // only thing that says which From. Counting page-wide is what made one
        // bad row report as three.
        assert.deepEqual(rowlib.errorsIn(first.row), []);
        assert.deepEqual(rowlib.errorsIn(second.row), ['The field From is required']);
    });

    test('the proficiency with no id is reached by its label, inside its row', () => {
        const row = page.addWorkRow({ title: 'PO', company: 'Acme' });
        // Overall carries a per-tenant GUID on the live form — nothing stable to
        // select page-wide, and a page-wide button search finds the row above.
        const wrap = rowlib.fieldIn(row.row, 'formField-roleDescription');
        wrap.setAttribute('data-automation-id', 'formField-8f2c1e04');
        const label = dom.document.createElement('label');
        label.textContent = 'Overall';
        wrap.appendChild(label);

        assert.equal(rowlib.fieldByLabel(row.row, /overall/i), wrap);
        assert.equal(rowlib.fieldByLabel(row.row, /nothing here/i), null);
    });
});

// ── THE GATE ─────────────────────────────────────────────────────────────

describe('MILESTONE 2 GATE — the verdict matches the page, in both directions', () => {
    test('a committed date reports COMMITTED although .value is empty', async () => {
        const row = page.addWorkRow({ title: 'PO', company: 'Acme' });
        const date = inRow(row, 'formField-startDate');

        const r = await exec.runField(date, { month: 5, year: 2024 }, { ...ctx(), row: row.row });

        assert.equal(r.result, RESULT.COMMITTED, r.reason);
        // The trap, held open: the page really does read empty here, and the
        // date really is committed. A verifier reading .value fails this.
        assert.equal(row.start().month.value, '');
        assert.equal(row.start().month.getAttribute('aria-valuenow'), '5');
        assert.equal(row.start().year.getAttribute('aria-valuenow'), '2024');
    });

    test('and it was never typed into — the picker is the only way in', async () => {
        const row = page.addWorkRow({ title: 'PO', company: 'Acme' });
        await exec.runField(inRow(row, 'formField-startDate'), { month: 11, year: 2019 }, { ...ctx(), row: row.row });

        // Synthetic typing writes NOTHING into a date section (value stays "",
        // aria-valuenow stays null). An executor that tries is not unlucky.
        assert.deepEqual(page.dateKeys, []);
        assert.deepEqual(page.dateWrites, []);
        assert.equal(page.pickerOpen(), 0, 'the panel must not be left over the page');
    });

    test('a date already right is left alone', async () => {
        const row = page.addWorkRow({ title: 'PO', company: 'Acme' });
        row.start().month.setAttribute('aria-valuenow', '3');
        row.start().year.setAttribute('aria-valuenow', '2020');

        const r = await exec.runField(inRow(row, 'formField-startDate'), { month: 3, year: 2020 }, ctx());
        assert.equal(r.result, RESULT.SATISFIED);
        assert.equal(row.start().icon.clickCount, 0, 'a satisfied field costs no clicks');
    });

    test('a value the page hands back reports COMMIT_FAILED, not done', async () => {
        // The other false verdict: React-controlled, so the write lands and the
        // next render puts the old text back. v1 read it in between and called
        // the field filled.
        const row = page.addWorkRow({ title: '', company: 'Acme', revertsTitle: true });
        const r = await exec.runField(inRow(row, 'formField-jobTitle'), 'Product Owner', { ...ctx(), row: row.row });

        assert.equal(r.result, RESULT.COMMIT_FAILED);
        assert.match(r.reason, /did not stick|never read back/);
        assert.equal(row.titleInput.value, '');
    });

    test('an ordinary text field reports what actually happened', async () => {
        const row = page.addWorkRow({ title: '', company: '' });
        const r = await exec.runField(inRow(row, 'formField-jobTitle'), 'Product Owner', { ...ctx(), row: row.row });
        assert.equal(r.result, RESULT.COMMITTED);
        assert.equal(row.titleInput.value, 'Product Owner');
    });

    test('a tick with the row still complaining is not a commit', async () => {
        const row = page.addWorkRow({ title: 'PO', company: 'Acme' });
        row.raiseError('The field From is required');

        const r = await exec.runField(inRow(row, 'formField-currentlyWorkHere'), true, { ...ctx(), row: row.row });

        // Measured on the language rows: Workday swallows a tick during
        // re-hydration and leaves the error standing. `checked` alone lies.
        assert.equal(row.box.checked, true);
        assert.equal(r.result, RESULT.COMMIT_FAILED);
        assert.match(r.reason, /row error/);
    });

    test('the same tick, on a clean row, is a commit', async () => {
        const row = page.addWorkRow({ title: 'PO', company: 'Acme' });
        const r = await exec.runField(inRow(row, 'formField-currentlyWorkHere'), true, { ...ctx(), row: row.row });
        assert.equal(r.result, RESULT.COMMITTED);
        assert.equal(row.box.checked, true);
    });

    test('a listbox commits the option it was asked for', async () => {
        const r = await exec.runField(field('formField-degree'), DEGREES[1], ctx());
        assert.equal(r.result, RESULT.COMMITTED, r.reason);
        assert.equal(page.fields.degree.trigger.textContent, DEGREES[1]);
    });

    test('a term with several answers commits nothing at all', async () => {
        // "Bachelor" is three degrees on this catalogue. Picking one puts a
        // qualification on a real application that its owner never claimed.
        const r = await exec.runField(field('formField-degree'), 'Bachelor', ctx());
        assert.equal(r.result, RESULT.AMBIGUOUS);
        assert.equal(page.fields.degree.trigger.textContent, 'Select One');
    });

    test('skills adds what is missing, keeps what was already there', async () => {
        page.seedChip('skills', 'Photoshop');            // the candidate's own, from another form
        const r = await exec.runField(field('formField-skills'), ['Figma', 'SQL'], ctx());

        assert.equal(r.result, RESULT.COMMITTED, r.reason);
        assert.deepEqual(page.chipsOn('skills'), ['Photoshop', 'Figma', 'SQL']);
    });

    test('a second pass over the same skills costs nothing', async () => {
        await exec.runField(field('formField-skills'), ['Figma'], ctx());
        const before = page.fields.skills.trigger.clickCount;

        const again = await exec.runField(field('formField-skills'), ['Figma'], ctx());
        assert.equal(again.result, RESULT.SATISFIED);
        assert.equal(page.fields.skills.trigger.clickCount, before,
            're-typing eight terms to re-learn "already there" cost 39-44s a pass');
    });

    test('a widget with no handler asks for a human instead of improvising', async () => {
        const wrap = dom.document.createElement('div');
        wrap.setAttribute('data-automation-id', 'formField-somethingNew');
        page.page.appendChild(wrap);

        const r = await exec.runField(field('formField-somethingNew'), 'anything', ctx());
        assert.equal(r.result, RESULT.USER_REQUIRED);
        assert.equal(wrap.children.length, 0, 'nothing was written into a control we do not understand');
    });
});

// ── the field layer, under the scheduler ─────────────────────────────────

describe('a row filled end to end leaves the page clear', () => {
    test('three widgets, three verdicts, no popup and no panel left behind', async () => {
        const row = page.addWorkRow({ title: '', company: '' });
        const shared = { ...ctx(), row: row.row };

        const ledger = await scheduler.runSequential([
            { id: 'title', run: () => exec.runField(inRow(row, 'formField-jobTitle'), 'Product Owner', shared) },
            { id: 'from', run: () => exec.runField(inRow(row, 'formField-startDate'), { month: 5, year: 2024 }, shared) },
            { id: 'degree', run: () => exec.runField(field('formField-degree'), DEGREES[0], shared) },
        ], { sleep });

        assert.deepEqual(ledger.tasks.map((t) => t.result),
            [RESULT.COMMITTED, RESULT.COMMITTED, RESULT.COMMITTED]);
        assert.equal(ledger.leaks, 0, 'a field that opened something must close it');
        assert.ok(ledger.clean, 'no list and no calendar panel may outlive the run');
        assert.equal(page.pickerOpen(), 0);
    });
});
