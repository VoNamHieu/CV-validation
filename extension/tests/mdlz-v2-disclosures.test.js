// P5 — Voluntary Disclosures. The page where being wrong is worst.
//
// One rule governs it: v2 never chooses a demographic value. Declining is the
// only answer that states nothing about a person, and the only substantive
// answer allowed is one the CANDIDATE already gave in their own profile. Where
// neither exists the field is left, and the review lists it.
//
// The wordings each cost a run. Mondelez offers Female / Male / "Not Specified"
// / Other; Visa says "Not Declared", and that phrasing alone stalled two runs.
// A VN ethnic-group catalogue carries no decline row at all — which is the case
// where leaving the field IS the right answer rather than a failure.
//
// And the consent boundary is policy.js's: the marketing exclusion is checked
// first and wins, so "receive marketing updates — I consent" can never be read
// as a required terms box.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';
import { GENDER_VISA, buildDisclosuresPage } from './harness/disclosures-page.js';

let dom;
let page;
let p5;
let RESULT;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 12)));
const run = (profile = {}, extra = {}) => p5.runDisclosuresPage({
    sleep, profile, cv: {}, commitMs: 900, stableMs: 120, advance: false, ...extra,
});

before(async () => {
    console.log = () => { };
    dom = installDom();
    p5 = await import('../src/content-agent/mdlz-v2/page-disclosures.js');
    ({ RESULT } = await import('../src/content-agent/mdlz-v2/config.js'));
});

after(() => dom?.uninstall());

beforeEach(() => {
    dom.document.body.children.forEach((c) => { c.parentNode = null; });
    dom.document.body.children = [];
    globalThis.window.__copoFillLock = null;
    globalThis.window.__copoNavLock = null;
    page = buildDisclosuresPage(dom.document);
});

describe('a silent profile declines, in whatever words the tenant uses', () => {
    test('Mondelez\'s "Not Specified" is found', async () => {
        await run({});
        assert.equal(page.picked()['formField-gender'], 'Not Specified');
    });

    test('and Visa\'s "Not Declared", the phrasing that stalled two runs', async () => {
        page = buildDisclosuresPage(dom.document, { genders: GENDER_VISA });
        dom.document.body.children[0].remove();

        await run({});
        assert.equal(page.picked()['formField-gender'], 'Not Declared');
    });

    test('the answer is marked as the agent\'s, because the user reads it at review', async () => {
        const r = await run({});
        const gender = r.report.answers.find((a) => a.field === 'formField-gender');
        assert.equal(gender.source, 'AGENT_DEFAULT');
    });
});

describe('the candidate\'s own statement is the only substantive answer', () => {
    test('a stated gender is used', async () => {
        // Tenants ask this as an administrative fact, and the profile carries
        // it. That is the person answering, not the agent choosing.
        await run({ gender: 'Female' });
        assert.equal(page.picked()['formField-gender'], 'Female');
    });

    test('and a stated ethnicity is used, on a catalogue that offers no decline', async () => {
        await run({ ethnicity: 'Kinh' });
        assert.equal(page.picked()['formField-ethnicity'], 'Kinh');
    });

    test('but v2 never picks one for them', async () => {
        // The catalogue has no decline row and the profile is silent. Every
        // remaining option states something about the person, so none of them
        // is an answer v2 may give.
        const r = await run({});
        assert.equal(page.picked()['formField-ethnicity'], undefined, 'nothing was chosen');
        const task = r.ledger.tasks.find((t) => t.id === 'formField-ethnicity');
        assert.ok([RESULT.SKIPPED_OPTIONAL, RESULT.USER_REQUIRED].includes(task.result), task.result);
    });

    test('and the belt holds even if a decline rung would have matched one', async () => {
        // "Other" is on Mondelez's gender list and reads like a neutral rung.
        // It is not: it states something. A pick that did not come from the
        // profile and looks substantive is refused whatever produced it.
        page = buildDisclosuresPage(dom.document, { genders: ['Female', 'Male', 'Other'] });
        dom.document.body.children[0].remove();

        const r = await run({});
        assert.equal(page.picked()['formField-gender'], undefined);
        assert.ok(r.gaps.some((g) => g.id === 'formField-gender'));
    });
});

describe('a stated Vietnamese gender is spoken in the tenant\'s own words', () => {
    // The gap this closes: a VN candidate writes "Nam"/"Nữ", but a US-styled
    // list renders Male/Female — so their OWN answer used to fall through to a
    // decline. The value picked is always the tenant's rendered label, and it
    // stays PROFILE (their statement, translated), so the substantive belt
    // admits it. disclosureAnswer is pure, so these assert it directly.
    const MDLZ = ['Female', 'Male', 'Not Specified', 'Other'];
    const VN = ['Nam', 'Nữ', 'Không muốn trả lời'];

    test('Nam registers as this list\'s Male', () => {
        assert.deepEqual(p5.disclosureAnswer('gender', MDLZ, { gender: 'Nam' }),
            { value: 'Male', source: 'PROFILE' });
    });

    test('Nữ registers as Female', () => {
        assert.deepEqual(p5.disclosureAnswer('gender', MDLZ, { gender: 'Nữ' }),
            { value: 'Female', source: 'PROFILE' });
    });

    test('but on a VN list the tenant\'s own "Nam" is picked, not "Male"', () => {
        assert.deepEqual(p5.disclosureAnswer('gender', VN, { gender: 'Nam' }),
            { value: 'Nam', source: 'PROFILE' });
    });

    test('a male on a Man/Woman list picks Man — exact match, never Woman', () => {
        assert.deepEqual(p5.disclosureAnswer('gender', ['Man', 'Woman', 'Not Specified'], { gender: 'Nam' }),
            { value: 'Man', source: 'PROFILE' });
        assert.deepEqual(p5.disclosureAnswer('gender', ['Man', 'Woman', 'Not Specified'], { gender: 'Nữ' }),
            { value: 'Woman', source: 'PROFILE' });
    });

    test('the substring hazard is closed: a male on a Woman-only list declines', () => {
        // "woman".includes("man") — an includes() match would misgender. Exact
        // match means Nam finds nothing here and declines, never picks Woman.
        const r = p5.disclosureAnswer('gender', ['Woman', 'Not Specified'], { gender: 'Nam' });
        assert.equal(r.value, 'Not Specified');
    });

    test('an unrecognised value is never guessed — it declines', () => {
        // "Khác" is not a plain male/female; the ladder is empty, so it falls to
        // the decline rung rather than being mapped to Male/Female/Other.
        const r = p5.disclosureAnswer('gender', MDLZ, { gender: 'Khác' });
        assert.equal(r.value, 'Not Specified');
        assert.equal(r.source, 'AGENT_DEFAULT');
    });

    test('an empty gender does not translate — it declines', () => {
        assert.equal(p5.disclosureAnswer('gender', MDLZ, { gender: '' }).source, 'AGENT_DEFAULT');
    });

    test('ethnicity gets no ladder: Kinh matches Kinh, and nothing else is mapped', () => {
        assert.deepEqual(p5.disclosureAnswer('ethnicity', ['Kinh', 'Hoa', 'Tày'], { ethnicity: 'Kinh' }),
            { value: 'Kinh', source: 'PROFILE' });
        // A race-category list has no equivalent for Kinh and no decline row —
        // the field is left, exactly as before this change.
        assert.equal(p5.disclosureAnswer('ethnicity', ['Asian', 'White', 'Black'], { ethnicity: 'Kinh' }), null);
    });
});

describe('a stated ENGLISH gender never substring-collides', () => {
    // "male" is a substring of "female" and "man" of "woman". An includes()
    // match on the profile value misgenders a stated English gender, which the
    // Vietnamese-only tests missed. The direct match for gender is exact-only.
    test('Male picks Male, never Female', () => {
        assert.deepEqual(p5.disclosureAnswer('gender', ['Female', 'Male', 'Not Specified'], { gender: 'Male' }),
            { value: 'Male', source: 'PROFILE' });
    });

    test('Male on a Female-only list does NOT become Female — it declines', () => {
        const r = p5.disclosureAnswer('gender', ['Female', 'Not Specified'], { gender: 'Male' });
        assert.equal(r.value, 'Not Specified');
    });

    test('Man picks Man, never Woman', () => {
        assert.deepEqual(p5.disclosureAnswer('gender', ['Man', 'Woman', 'Not Specified'], { gender: 'Man' }),
            { value: 'Man', source: 'PROFILE' });
    });

    test('Man on a Woman-only list does NOT become Woman — it declines', () => {
        const r = p5.disclosureAnswer('gender', ['Woman', 'Not Specified'], { gender: 'Man' });
        assert.equal(r.value, 'Not Specified');
    });

    test('ethnicity KEEPS its substring pass — "Kinh" still finds "Kinh (Vietnam)"', () => {
        assert.deepEqual(p5.disclosureAnswer('ethnicity', ['Kinh (Vietnam)', 'Tày (Vietnam)'], { ethnicity: 'Kinh' }),
            { value: 'Kinh (Vietnam)', source: 'PROFILE' });
    });
});

describe('the consent boundary', () => {
    test('the terms box is ticked and the marketing box is not', async () => {
        await run({});
        assert.equal(page.terms.checked, true);
        // "receive marketing updates ... " reads as consent to anything that
        // checks consent first. The exclusion wins.
        assert.equal(page.marketing.checked, false);
    });

    test('the marketing box is reported as refused rather than silently skipped', async () => {
        const r = await run({});
        const task = r.ledger.tasks.find((t) => t.id === 'formField-marketingOptIn');
        assert.equal(task.result, RESULT.SKIPPED_OPTIONAL);
    });
});

describe('leaving the page', () => {
    test('an optional demographic left blank does not hold the page', async () => {
        // The VN catalogue case: ethnicity is left, and the page still advances
        // — it is optional, and the correct outcome is a blank field.
        //
        // Two passes, because a page is only left from one that had nothing to
        // do: the first fills, the second finds everything already right and
        // leaves on the strength of what the PAGE says rather than what we just
        // wrote.
        await run({});
        const r = await p5.runDisclosuresPage({ sleep, profile: {}, cv: {}, commitMs: 900 });
        assert.equal(r.advanced, true, JSON.stringify(r.navigation));
        assert.equal(page.nav.clicks, 1);
    });

    test('but a REQUIRED gender nobody can answer does hold it', async () => {
        page = buildDisclosuresPage(dom.document, { genders: ['Female', 'Male', 'Other'] });
        dom.document.body.children[0].remove();

        await run({});
        const r = await p5.runDisclosuresPage({ sleep, profile: {}, cv: {}, commitMs: 900 });
        assert.equal(r.advanced, false);
        assert.equal(page.nav.clicks, 0, 'the user decides this one, at the review');
    });

    test('a second pass changes nothing', async () => {
        await run({ gender: 'Female' });
        const quiet = await run({ gender: 'Female' });
        assert.equal(quiet.report.filled, 0);
        assert.equal(page.picked()['formField-gender'], 'Female');
    });
});

describe('the Date of Birth — segmented, required, and never guessed', () => {
    test('parseDob splits only what it can read unambiguously', () => {
        const p = (s) => p5.parseDob(s);
        assert.deepEqual(p('1998-07-22'), { year: 1998, month: 7, day: 22 }, 'ISO');
        assert.deepEqual(p('2000/3/15'), { year: 2000, month: 3, day: 15 }, 'year-first slashes');
        assert.deepEqual(p('22/07/1998'), { year: 1998, month: 7, day: 22 }, 'D/M/Y: 22 can only be a day');
        assert.deepEqual(p('07/22/1998'), { year: 1998, month: 7, day: 22 }, 'M/D/Y: 22 can only be a day');
        assert.equal(p('03/04/2000'), null, 'both parts ≤ 12 is ambiguous — never guessed');
        assert.equal(p('2000-13-40'), null, 'out of range is not a date');
        assert.equal(p(''), null);
        assert.equal(p('sometime in 1998'), null);
    });

    test('an unambiguous profile date fills all three segments', async () => {
        page = buildDisclosuresPage(dom.document, { dob: true });
        dom.document.body.children[0].remove();

        const r = await run({ dateOfBirth: '1998-07-22' });
        assert.equal(page.dob.month.getAttribute('aria-valuenow'), '7');
        assert.equal(page.dob.day.getAttribute('aria-valuenow'), '22');
        assert.equal(page.dob.year.getAttribute('aria-valuenow'), '1998');
        const task = r.ledger.tasks.find((t) => t.id === 'formField-dateOfBirth');
        assert.equal(task.result, RESULT.COMMITTED);
    });

    test('a DOB already on the draft is the candidate\'s and is never overwritten', async () => {
        page = buildDisclosuresPage(dom.document, { dob: { month: 3, day: 15, year: 2000 } });
        dom.document.body.children[0].remove();

        // A DIFFERENT date in the profile must not disturb what the draft holds.
        const r = await run({ dateOfBirth: '1998-07-22' });
        assert.equal(page.dob.month.getAttribute('aria-valuenow'), '3', 'their own March stays');
        assert.equal(page.dob.year.getAttribute('aria-valuenow'), '2000');
        const task = r.ledger.tasks.find((t) => t.id === 'formField-dateOfBirth');
        assert.equal(task.result, RESULT.SATISFIED);
    });

    test('a missing or ambiguous DOB is a gap the candidate fills, NOT the loop v1 spun', async () => {
        page = buildDisclosuresPage(dom.document, { dob: true });
        dom.document.body.children[0].remove();

        const r = await run({ dateOfBirth: '03/04/2000' });   // ambiguous — refused, not guessed
        assert.ok(!page.dob.month.getAttribute('aria-valuenow'), 'nothing is written');
        const task = r.ledger.tasks.find((t) => t.id === 'formField-dateOfBirth');
        assert.equal(task.result, RESULT.USER_REQUIRED);
        assert.ok(r.gaps.some((g) => g.id === 'formField-dateOfBirth'), 'surfaced at the review');
    });
});
