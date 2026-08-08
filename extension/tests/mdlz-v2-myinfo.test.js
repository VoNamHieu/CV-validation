// P2 — My Information. Every assertion here is a measurement, or a defect that
// was paid for once already.
//
//   · Country RE-RENDERS the region and postal fields, so it goes first and
//     everything after it re-resolves its node.
//   · Province is TWO WIDGETS behind one automation id — a button listbox on
//     3M, a searchable input on Mondelez — which is why capability comes from
//     the shape and never from the field's name.
//   · The radio's input is invisible under a styled control. Clicking the input
//     clicks nothing; `.checked` set directly is a mutation that reports success
//     even when the policy refused; and "No" is a substring of "Not applicable".
//   · Country Phone Code commits as a CHIP. Typed and uncommitted, it reads
//     "0 items selected" and blocks Next silently.
//   · Postal is FIVE digits — Vietnam changed in 2018 and Workday validates it,
//     while a hard-coded legacy six survived 24 iterations of the field
//     refilling itself.
//   · And nothing writes to the email box.

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';
import { buildMyInfoPage } from './harness/myinfo-page.js';

let dom;
let page;
let p2;
let RESULT;

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 12)));

const PROFILE = {
    // firstName/lastName here are DELIBERATELY the wrong split — the shape a
    // stale web-app build writes. The agent re-derives from fullName.
    fullName: 'Võ Nam Hiếu', firstName: 'Nam Hiếu', lastName: 'Võ',
    phone: '0700000000', addressStreet: '12 Lý Thường Kiệt',
    addressDistrict: 'Hoàn Kiếm', addressProvince: 'Hà Nội', nationality: 'Vietnam',
};
const CV = { contact: {} };
const run = (extra = {}) => p2.runMyInfoPage({
    sleep, profile: PROFILE, cv: CV, commitMs: 900, stableMs: 120, advance: false, ...extra,
});

before(async () => {
    console.log = () => { };
    dom = installDom();
    p2 = await import('../src/content-agent/mdlz-v2/page-myinfo.js');
    ({ RESULT } = await import('../src/content-agent/mdlz-v2/config.js'));
});

after(() => dom?.uninstall());

beforeEach(() => {
    dom.document.body.children.forEach((c) => { c.parentNode = null; });
    dom.document.body.children = [];
    globalThis.window.__copoFillLock = null;
    globalThis.window.__copoNavLock = null;
    page = buildMyInfoPage(dom.document);
});

describe('the page is filled in the order the page requires', () => {
    test('Country comes before Province, because picking it replaces the fields', async () => {
        const r = await run();
        const order = r.ledger.tasks.map((t) => t.id);
        assert.ok(order.indexOf('formField-country') < order.indexOf('formField-countryRegion'));
        assert.ok(order.indexOf('formField-country') < order.indexOf('formField-postalCode'));
        assert.equal(page.rerenders(), 1, 'the harness really did replace them');
    });

    test('and the fields it replaced are still filled, because they are re-resolved', async () => {
        await run();
        // Holding a node from before the re-render is holding a corpse. Every
        // task looks its own field up at the moment it runs.
        assert.equal(page.addressLine1().value, '12 Lý Thường Kiệt');
        assert.equal(page.city().value, 'Hoàn Kiếm');
        assert.equal(page.postal().value, '10000');
    });

    test('the postal code is five digits', async () => {
        // Vietnam switched in 2018 (Hà Nội 10000) and Workday validates it. A
        // hard-coded legacy six outlived 24 iterations of this very field.
        await run();
        assert.match(page.postal().value, /^\d{5}$/);
    });
});

describe('the widgets, each recognised by its shape', () => {
    test('the western pair is re-derived, not taken from a profile that may be stale', async () => {
        await run();
        assert.equal(page.firstName.value, 'Hiếu');
        assert.equal(page.lastName.value, 'Võ Nam');
    });

    test('the radio is clicked by its LABEL, and verified by re-reading checked', async () => {
        const r = await run();
        const task = r.ledger.tasks.find((t) => t.id === 'formField-candidateIsPreviousWorker');

        assert.equal(task.result, RESULT.COMMITTED, JSON.stringify(task.notes));
        const chosen = page.radios.find((x) => x.input.checked);
        assert.equal(chosen.text, 'No');
        // "No" is inside "Not applicable" — an exact label has to win first.
        assert.equal(page.radios.find((x) => x.text === 'Not applicable').input.checked, false);
    });

    test('a searchable Province commits into its own box, with the list closed', async () => {
        const r = await run();
        const task = r.ledger.tasks.find((t) => t.id === 'formField-countryRegion');
        assert.equal(task.result, RESULT.COMMITTED, JSON.stringify(task.notes));
        assert.equal(page.province().value, 'Hà Nội');
    });

    test('the SAME field as a button listbox works too, without being told', async () => {
        // Two widgets, one automation id. Nothing about the field's NAME may
        // decide which — only what is on the page.
        page = buildMyInfoPage(dom.document, { provinceAs: 'button' });
        dom.document.body.children[0].remove();

        const r = await run();
        const task = r.ledger.tasks.find((t) => t.id === 'formField-countryRegion');
        assert.equal(task.result, RESULT.COMMITTED, JSON.stringify(task.notes));
        assert.equal(page.province().textContent, 'Hà Nội');
    });

    test('the phone code is not done until a chip exists', async () => {
        const r = await run();
        const task = r.ledger.tasks.find((t) => t.id === 'formField-countryPhoneCode');

        // Typed and uncommitted reads "0 items selected" and blocks Next
        // silently — the scanner cannot see that anything is wrong.
        assert.equal(task.result, RESULT.COMMITTED, JSON.stringify(task.notes));
        assert.deepEqual(page.chipsOnPhoneCode(), ['Vietnam (+84)']);
    });

    test('phone type takes the personal line by name, not the first Mobile listed', async () => {
        await run();
        // Measured options: "Mobile - Personal", "Mobile - Work", "Telephone -
        // Office", "Telephone - Personal". A bare "Mobile" substring-matches
        // whichever is first.
        assert.equal(page.phoneType.textContent, 'Mobile - Personal');
    });
});

describe('what it will not do', () => {
    test('it never writes to the email box', async () => {
        await run();
        assert.equal(page.emailWrites(), 0);
        assert.equal(page.email.value, 'someone@example.com');
    });

    test('a local-script pair is filled where it renders, and skipped where it does not', async () => {
        assert.equal(page.firstLocal, null, 'this tenant is single-script');
        const single = await run();
        assert.ok(!single.ledger.tasks.some((t) => t.id.includes('Local')), 'no task for a field that is not there');

        page = buildMyInfoPage(dom.document, { localNames: true });
        dom.document.body.children[0].remove();
        const dual = await run();
        // "Family Name - Vietnamese*" is REQUIRED where it renders, and the run
        // that left it died one field short of the step.
        //
        // The value is "Hiếu", not the profile's own "Nam Hiếu": the split is
        // RE-DERIVED from the full name rather than trusted, because a profile
        // is only as correct as the web-app build that wrote it and a stale one
        // re-poisoned this exact field three times in one day. "Võ Nam Hiếu" in
        // Vietnamese order gives Hiếu / Võ Nam.
        assert.equal(page.firstLocal.value, 'Hiếu');
        assert.ok(dual.ledger.tasks.some((t) => t.id === 'formField-legalName--firstNameLocal'));
    });

    test('a required answer nobody holds is a gap, not a guess', async () => {
        const r = await p2.runMyInfoPage({
            sleep, profile: { fullName: 'Võ Nam Hiếu' }, cv: { contact: {} }, advance: false, commitMs: 400,
        });
        // No phone in the profile and none in the CV: reported, never invented.
        assert.ok(r.gaps.some((g) => g.id === 'formField-phoneNumber'));
        assert.equal(page.phoneNumber.value, '');
    });

    test('and it does not leave a page with a gap on it', async () => {
        const r = await p2.runMyInfoPage({
            sleep, profile: { fullName: 'Võ Nam Hiếu' }, cv: { contact: {} }, commitMs: 400,
        });
        assert.equal(page.nav.clicks, 0);
        assert.equal(r.advanced, false);
    });
});

describe('a second pass writes nothing', () => {
    test('every field reads as already right, and then the page is left', async () => {
        await run();
        const quiet = await p2.runMyInfoPage({ sleep, profile: PROFILE, cv: CV, commitMs: 900 });

        const moved = quiet.ledger.tasks.filter((t) => ![RESULT.SATISFIED, RESULT.SKIPPED_OPTIONAL].includes(t.result));
        assert.deepEqual(moved.map((t) => `${t.id}:${t.result}`), []);
        assert.equal(quiet.report.filled, 0);
        assert.equal(quiet.advanced, true, 'a quiet pass is the one that advances');
        assert.equal(page.nav.clicks, 1);
    });
});
