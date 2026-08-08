// The dry run: the instrument for first contact with a real application.
//
// Everything v2 knows was measured on a page nobody was applying to twice, and
// then proven against a harness built from those measurements — which is a good
// way to be right about what was measured and no way at all to find out what was
// not. Two assumptions in particular only a live page can settle: that
// `input.files.length` is what an attached résumé looks like, and that a
// section's Add button sits inside the container its rows live in (four are
// visible at once on this step, and the wrong one writes into another section).
//
// So the flag has a third setting, and this file's job is to prove that setting
// harmless: a dry run READS. If any test here can show it writing, the
// instrument is worse than not having one — the first thing it would damage is
// somebody's application.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';
import { DEGREES, LEVELS, buildHostilePage } from './harness/hostile-page.js';

let dom;
let page;
let v2;
let PAGE_LOCK;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 12)));

const CV = {
    experience: [
        { title: 'Product Owner', company: 'Acme', start_date: '2021-03', end_date: '2024-05', description: 'Owned the roadmap' },
        { title: 'Business Analyst', company: 'Globex', start_date: '2019-01', end_date: 'Present' },
    ],
    education: [{ institution: 'RMIT', degree: DEGREES[0] }],
    languages: [{ language: 'English', level: LEVELS[2] }],
    skills: ['Figma', 'SQL'],
};

const setFlag = (value) => {
    globalThis.chrome = { storage: { local: { get: (_k, cb) => cb({ copoMdlzV2: value }) } } };
};

const dryRun = () => v2.runMdlzV2({ cv: CV, sleep });

/** Everything a write would show up in. */
const snapshot = () => ({
    titles: page.workRows().map((r) => r.titleInput.value),
    dates: page.workRows().map((r) => r.start().month.getAttribute('aria-valuenow')),
    ticks: page.workRows().map((r) => r.box.checked),
    chips: page.chipsOn('skills'),
    degrees: page.eduRows().map((r) => r.degree.trigger.textContent),
    clicks: page.workRows().map((r) => r.start().icon.clickCount),
    rows: page.workRows().length,
    lists: page.openCount(),
    pickers: page.pickerOpen(),
    adds: page.ignoredAdds.length,
});

before(async () => {
    console.log = () => { };
    dom = installDom();
    v2 = await import('../src/content-agent/mdlz-v2/index.js');
    ({ PAGE_LOCK } = await import('../src/content-agent/mdlz-v2/config.js'));
});

after(() => dom?.uninstall());

beforeEach(() => {
    dom.document.body.children.forEach((c) => { c.parentNode = null; });
    dom.document.body.children = [];
    dom.document.activeElement = dom.document.body;
    globalThis.window[PAGE_LOCK] = null;
    page = buildHostilePage(dom.document);
    setFlag('dry');
});

describe('a dry run reads the page and changes nothing on it', () => {
    test('nothing is written, nothing is clicked, no row is added', async () => {
        page.addWorkRow({});
        page.addEducationRow({});
        page.addLanguageRow({});
        const before = snapshot();

        const r = await dryRun();

        assert.equal(r.took, false, 'a dry run never owns the page');
        assert.equal(r.dry, true);
        assert.deepEqual(snapshot(), before, 'the page must be exactly as it was found');
    });

    test('and v1 keeps the pass, exactly as it does today', async () => {
        page.addWorkRow({});
        const r = await dryRun();
        // took:false is what sends the router on to v1. A dry run that took the
        // page would leave the step unfilled by BOTH.
        assert.equal(r.took, false);
        assert.equal(globalThis.window[PAGE_LOCK], null, 'and it holds no lock on the way out');
    });

    test('the verdict is the controller\'s own, not a second opinion', async () => {
        page.addWorkRow({});
        page.addEducationRow({});
        page.addLanguageRow({});
        const dry = await dryRun();
        assert.equal(dry.preflight.verdict, 'WOULD TAKE');

        setFlag(true);
        const real = await v2.runMdlzV2({ cv: CV, sleep, addMs: 500 });
        assert.equal(real.took, true, 'what the dry run predicted is what the pass did');
    });

    test('a page it would decline says so, with the reason', async () => {
        page.addEducationRow({});
        page.addLanguageRow({});          // work has no rows → no Add it can identify
        const r = await dryRun();

        assert.equal(r.preflight.verdict, 'WOULD HAND BACK');
        assert.match(r.preflight.reason, /cannot finish work/);
    });
});

describe('the report answers the two questions only a live page can', () => {
    test('the résumé signal is reported in full, not as a boolean', async () => {
        page.addWorkRow({});
        const input = dom.document.createElement('input');
        input.setAttribute('data-automation-id', 'file-upload-input-ref');
        input.setAttribute('type', 'file');
        input.files = [];
        page.page.appendChild(input);

        const r = await dryRun();
        // `attached` is what the take decision uses; the rest is what says
        // whether that reading means anything on this page at all.
        assert.equal(r.preflight.resume.present, true);
        assert.equal(r.preflight.resume.files, 0);
        assert.equal(r.preflight.resume.attached, false);
        assert.equal(r.preflight.resume.hasFilesApi, true);
    });

    test('an input with no .files at all is named as a signal to re-measure', async () => {
        page.addWorkRow({});
        const input = dom.document.createElement('input');
        input.setAttribute('data-automation-id', 'file-upload-input-ref');
        input.setAttribute('type', 'file');
        page.page.appendChild(input);                 // no `files` property

        const r = await dryRun();
        assert.equal(r.preflight.resume.hasFilesApi, false);
        assert.match(r.preflight.resume.note, /re-measur/);
    });

    test('each section reports its rows and whether its own Add was found', async () => {
        page.addWorkRow({});
        page.addEducationRow({});

        const r = await dryRun();
        const work = r.preflight.sections.find((s) => s.section === 'work');
        const langs = r.preflight.sections.find((s) => s.section === 'languages');

        assert.equal(work.rows, 1);
        assert.equal(work.entries, 2);
        assert.equal(work.addFound, true);
        assert.equal(work.addIsScopedToSection, true);
        // Languages has no row, so nothing says which of the Add buttons is its
        // own — the exact condition that must never be guessed past.
        assert.equal(langs.rows, 0);
        assert.equal(langs.addFound, false);
        assert.equal(r.preflight.addButtonsOnPage, 3, 'all three are on the page, and that is the problem');
    });
});

describe('the field table is what gets pasted back', () => {
    test('every planned field carries its widget, its value and what would go in', async () => {
        page.addWorkRow({ title: 'Product Owner', company: 'Acme' });
        page.addEducationRow({});
        page.addLanguageRow({});

        const r = await dryRun();
        const byId = (part) => r.preflight.fields.find((f) => f.id.includes(part));

        const title = byId('jobTitle');
        assert.equal(title.kind, 'text');
        assert.equal(title.now, 'Product Owner');
        assert.equal(title.satisfied, true, 'a field already right is reported as such');

        const from = byId('startDate');
        assert.equal(from.kind, 'date');
        assert.equal(from.now, '—/—', 'an empty date reads from aria-valuenow, not .value');
        assert.equal(from.want, '3/2021');
        assert.equal(from.satisfied, false);

        const skills = byId('skills');
        assert.equal(skills.kind, 'searchMulti');
        assert.equal(skills.now, '(no chips)');
        assert.equal(skills.want, 'Figma | SQL');
    });

    test('a widget v2 has no capability for is named, not improvised on', async () => {
        page.addWorkRow({ title: 'Product Owner', company: 'Acme' });
        page.addEducationRow({});
        page.addLanguageRow({});
        // A control shaped like nothing v2 knows, where a real field should be.
        const wrap = page.workRows()[0].row.querySelector('[data-automation-id="formField-roleDescription"]');
        wrap.children.forEach((c) => { c.parentNode = null; });
        wrap.children = [];

        const r = await dryRun();
        const desc = r.preflight.fields.find((f) => f.id.includes('roleDescription'));
        assert.equal(desc.kind, 'unknown');
        assert.equal(desc.capable, false);
    });

    test('it can be asked for on demand, without waiting for a pass', () => {
        // The measurement worth having is the one somebody takes at the moment
        // the page looks wrong — not the one the loop happens to come round to.
        assert.equal(typeof globalThis.copoMdlzPreflight, 'function');
    });
});
