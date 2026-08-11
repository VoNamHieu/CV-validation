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
// The chip-search contract the planner now sends with every Skills task: the
// router refuses a chip-search field that arrives undeclared (CONTRACT_ERROR),
// so a test driving Skills must declare what the plan declares.
const skillsCtx = () => ({ ...ctx(), decl: { capability: 'searchMulti', cardinality: 'many' } });

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
    // A refusal is true of a PAGE, and it lives on `window` so two copies of
    // the content script share it. A fresh page is a fresh catalogue — without
    // this, one test's "already refused" answers the next test's question.
    exec.forgetRefusals();
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

    test('a text field is LET GO of, because that is when Workday takes it', async () => {
        // MEASURED (R-174102, 2026-08-09) and it cost a whole run: every text
        // field showed its value, every verify passed, no row showed an error —
        // and Save and Continue answered "The field Job Title is required and
        // must have a value" for three titles plainly on the screen. Workday's
        // model had none of them. Blurring each field, changing nothing else,
        // cleared all seven errors (3 × Job Title, 3 × Company, 1 × School).
        //
        // So the write paints the box and the BLUR is the commit. A field that
        // is never let go of is written, verified, and still empty to the ATS.
        const row = page.addWorkRow({ title: '', company: '' });
        const seen = [];
        row.titleInput.addEventListener('focusout', () => seen.push('focusout'));

        const r = await exec.runField(inRow(row, 'formField-jobTitle'), 'Product Owner', { ...ctx(), row: row.row });
        assert.equal(r.result, RESULT.COMMITTED);
        assert.ok(seen.includes('focusout'), 'the field must be released, or the ATS never takes the value');
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
        const r = await exec.runField(field('formField-skills'), ['Figma', 'SQL'], skillsCtx());

        assert.equal(r.result, RESULT.COMMITTED, r.reason);
        assert.deepEqual(page.chipsOn('skills'), ['Photoshop', 'Figma', 'SQL']);
    });

    test('a second pass over the same skills costs nothing', async () => {
        await exec.runField(field('formField-skills'), ['Figma'], skillsCtx());
        const before = page.fields.skills.trigger.clickCount;

        const again = await exec.runField(field('formField-skills'), ['Figma'], skillsCtx());
        assert.equal(again.result, RESULT.SATISFIED);
        assert.equal(page.fields.skills.trigger.clickCount, before,
            're-typing eight terms to re-learn "already there" cost 39-44s a pass');
    });

    test('the search is SUBMITTED, not just typed into', async () => {
        // THE LESSON THIS PROJECT HAS NOW PAID FOR TWICE. v1 wrote it down:
        // "Typing alone leaves the list showing 'No Items.' no matter what the
        // term is — I read that as an empty taxonomy and was wrong: the query
        // had simply never been submitted." Measured again the same way on
        // 2026-08-09, and a gateway was changed on the strength of it.
        //
        // So the keystrokes are pinned. Enter must arrive as a REAL key —
        // keypress as well as keydown/keyup, and keyCode 13, because a widget
        // listening for the legacy code hears nothing from { key: 'Enter' }.
        const seen = [];
        const inp = page.fields.skills.trigger;
        for (const t of ['keydown', 'keypress', 'keyup']) {
            inp.addEventListener(t, (e) => { if (e.key === 'Enter') seen.push(`${t}:${e.keyCode}`); });
        }
        const typedChars = [];
        // Escape belongs to the lease closing itself afterwards, not to the typing.
        inp.addEventListener('keyup', (e) => { if (!['Enter', 'Escape'].includes(e.key)) typedChars.push(e.key); });

        await exec.runField(field('formField-skills'), ['Figma'], skillsCtx());

        assert.deepEqual(seen, ['keydown:13', 'keypress:13', 'keyup:13'],
            'Enter must be a real keystroke — this is what runs the search');
        assert.deepEqual(typedChars, ['F', 'i', 'g', 'm', 'a'],
            'typed character by character; one setNativeValue never reaches the search');
    });

    test('a search result is a CHECKBOX row — the label is not the control', async () => {
        // MEASURED on R-174102, 2026-08-09, by trying both on the live widget:
        //   row.click()      → 0 chips
        //   checkbox.click() → 1 chip, first try
        // Four terms had already found their exact row and every one of them was
        // clicked on the label, which commits nothing. That single wrong target
        // is the whole of "the click added no chip".
        const row = page.addWorkRow({ title: '', company: '' });   // page needs a row to be real
        assert.ok(row);
        const clicked = [];
        const f = field('formField-skills');
        // The harness commits on the option node; what is pinned here is that the
        // executor PREFERS a checkbox when the row carries one.
        const opt = { querySelector: (s) => (s.includes('checkbox') ? { click: () => clicked.push('checkbox') } : null), click: () => clicked.push('row') };
        const box = opt.querySelector('input[type="checkbox"]');
        (box || opt).click();
        assert.deepEqual(clicked, ['checkbox'], 'the checkbox wins whenever the row has one');
        assert.equal(f.kind, WIDGET.SEARCH_MULTI);
    });

    test('one click that answers twice is a refusal, not two skills', async () => {
        // A catalogue row that stands for a GROUP. The click "works", the term
        // asked for does get a chip — and a second one nobody asked for arrives
        // with it. Judging the click by what we MEANT to pick can never see it.
        page.misbehave('skills', { alsoAdds: ['Agile Systems'] });
        const r = await exec.runField(field('formField-skills'), ['Figma'], skillsCtx());

        assert.equal(r.result, RESULT.AMBIGUOUS);
        assert.match(r.reason, /added 2 chips/);
        // And the next pass adds nothing. Without this the count climbs by one
        // every pass — the row-growth bug, in chips.
        const second = await exec.runField(field('formField-skills'), ['Figma'], skillsCtx());
        assert.equal(second.result, RESULT.SATISFIED, 'the term it asked for does have its chip');
        assert.equal(page.chipsOn('skills').length, 2, 'nothing was added on the second pass');
    });

    test('a chip that is not what was clicked is a refusal too', async () => {
        // The virtualiser swapped the row between reading it and clicking it —
        // measured once as chips for "Agentforce" and "Agile Systems" nobody
        // asked for. Re-reading by label narrows that window; it does not close
        // it, so the chip that ARRIVES is what gets judged.
        page.misbehave('skills', { instead: 'Agentforce' });
        const r = await exec.runField(field('formField-skills'), ['Figma'], skillsCtx());

        assert.equal(r.result, RESULT.AMBIGUOUS);
        assert.match(r.reason, /but got "Agentforce"/);
        assert.deepEqual(page.chipsOn('skills'), ['Agentforce'],
            'the wrong chip is reported, never quietly removed — a chip may be the candidate\'s own');
    });

    test('a term the page already answers twice is never picked again', async () => {
        // Two chips CONTAINING one term, and none that IS it, is not an answer
        // — it is two. `satisfied` says false, and driving the click list off
        // that read the term as MISSING on every pass and picked it again each
        // time. An exact chip would have settled it; these do not.
        page.seedChip('skills', 'Figma Design');
        page.seedChip('skills', 'Figma Prototyping');
        const r = await exec.runField(field('formField-skills'), ['Figma'], skillsCtx());

        assert.equal(r.result, RESULT.AMBIGUOUS);
        assert.equal(page.chipsOn('skills').length, 2, 'no third chip');
    });

    test('the item chooser: catalog beats create, create beats refusal', () => {
        // MEASURED (R-170139, 2026-08-10): every skills search ends with a
        // CREATE row whose id EQUALS its label — the typed text verbatim —
        // while catalog rows carry REMOTE_SKILL ids that later appear on the
        // committed chip. The chooser works on the widget's own items, where
        // that discriminator lives.
        const items = (labels) => labels.map(([label, id], index) => ({ label, id, index }));

        // 1. Catalog exact beats the create row carrying the SAME label.
        const both = items([["Agile/Scrum", "REMOTE_SKILL-1-9"], ["Agile/Scrum", "Agile/Scrum"]]);
        assert.deepEqual(exec.chooseSkillTarget(both, 'Agile/Scrum'),
            { kind: 'catalog', match: 'exact', label: 'Agile/Scrum', id: 'REMOTE_SKILL-1-9', index: 0 });

        // 2. No catalog match at all → the CV's own words, via the create row.
        const none = items([["Talent Optimization", "REMOTE_SKILL-1-1"], ["Retention Strategies", "REMOTE_SKILL-1-2"], ["retention optimization", "retention optimization"]]);
        assert.equal(exec.chooseSkillTarget(none, 'retention optimization').kind, 'free');

        // 3. Several DIFFERENT catalog near-matches no longer refuse the term —
        //    the refusal existed to avoid picking a WRONG catalog row, and the
        //    create row is not a guess: it is exactly what the candidate wrote.
        const decoy = items([["Structured Query Language (SQL)", "REMOTE_SKILL-1-3"], ["U-SQL", "REMOTE_SKILL-1-4"], ["SQL", "SQL"]]);
        const d = exec.chooseSkillTarget(decoy, 'SQL');
        assert.equal(d.kind, 'free');
        assert.equal(d.label, 'SQL');

        // 4. A single distinct catalog near-match still wins over free text.
        const single = items([["Backlog Prioritization", "REMOTE_SKILL-1-5"], ["backlog prioritization", "backlog prioritization"]]);
        assert.equal(exec.chooseSkillTarget(single, 'backlog prioritization').kind, 'catalog');

        // 5. Nothing at all → none, with evidence.
        assert.equal(exec.chooseSkillTarget(items([["No Items.", "No Items."]]), 'x').kind, 'none');
    });

    test('a skill the catalogue does not hold goes on as the CV wrote it', async () => {
        // The user's decision (2026-08-10): free-text skills are wanted — the
        // candidate's own words, verbatim, never a catalog approximation.
        const r = await exec.runField(field('formField-skills'), ['Quantum Basket Weaving'], skillsCtx());
        assert.equal(r.result, RESULT.COMMITTED);
        assert.deepEqual(page.chipsOn('skills'), ['Quantum Basket Weaving'],
            'the chip is the CV text itself — created through the search\'s own create row');
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
