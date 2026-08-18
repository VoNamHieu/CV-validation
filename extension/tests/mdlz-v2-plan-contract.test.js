// The chip-search CONTRACT: who may drive a field the DOM cannot classify.
//
// Field of Study (single-select) and Skills (multi-select) render byte-identical
// chip-search DOM — probed side by side on the live tenant (R-172558 vs
// R-173186, 2026-08-13) — so the PLAN must declare each field's capability and
// cardinality, and the router refuses a chip-search field that arrives without
// one (CONTRACT_ERROR: developer-actionable, never shown as the candidate's
// gap). This suite is the "fires in CI first" half of that promise: a developer
// who forgets the declaration goes red here, before a run can ever hit it.
//
// The legal matrix, verbatim from the review that demanded it:
//   searchSelect + one            → legal
//   searchMulti  + many           → legal
//   searchMulti  + one            → ONLY with a documented contractException
//   anything else / undeclared    → refused

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';

let dom;
let planner;
let executors;
let myinfo;
let RESULT;
let WIDGET;

before(async () => {
    console.log = () => { };
    dom = installDom();
    planner = await import('../src/content-agent/mdlz-v2/planner.js');
    executors = await import('../src/content-agent/mdlz-v2/executors.js');
    myinfo = await import('../src/content-agent/mdlz-v2/page-myinfo.js');
    ({ RESULT } = await import('../src/content-agent/mdlz-v2/config.js'));
    ({ WIDGET } = await import('../src/content-agent/mdlz-v2/fingerprint.js'));
});

after(() => dom?.uninstall());

/** A fake chip-search fingerprint — the shape the router refuses to guess on. */
const chipField = (name = 'formField-x') => ({ kind: 'searchMulti', name });

const LEGAL = (decl) => executors.resolveCapability(chipField(), decl);

describe('the routing matrix — no default, no inference', () => {
    test('searchSelect + one is legal', () => {
        const r = LEGAL({ capability: 'searchSelect', cardinality: 'one' });
        assert.ok(r.cap, 'routes to an engine');
        assert.ok(!r.contractError);
    });

    test('searchMulti + many is legal', () => {
        const r = LEGAL({ capability: 'searchMulti', cardinality: 'many' });
        assert.ok(r.cap);
    });

    test('searchMulti + one is legal ONLY with a documented exception', () => {
        assert.ok(LEGAL({ capability: 'searchMulti', cardinality: 'one', contractException: 'measured-one-term-token-widget' }).cap);
        assert.ok(LEGAL({ capability: 'searchMulti', cardinality: 'one' }).contractError,
            'without the exception string it is refused');
    });

    test('an UNDECLARED chip-search field is refused — the forgotten-decl bug class', () => {
        const r = LEGAL(undefined);
        assert.ok(r.contractError);
        assert.equal(r.contractError.capability, '(missing)');
    });

    test('a mismatched pair is refused, both ways', () => {
        assert.ok(LEGAL({ capability: 'searchSelect', cardinality: 'many' }).contractError);
        assert.ok(LEGAL({ capability: 'searchMulti', cardinality: undefined }).contractError);
    });

    test('non-chip widgets are untouched by the contract', () => {
        const r = executors.resolveCapability({ kind: 'text', name: 'formField-city' }, undefined);
        assert.ok(r.cap, 'text routes with no declaration, as before');
    });
});

describe('every measured chip-search field DECLARES its contract in the spec', () => {
    test('education: Field of Study is searchSelect/one', () => {
        const education = planner.SECTIONS.find((s) => s.name === 'education');
        const fields = education.fields({ field_of_study: 'Marketing', gpa: '3.6', institution: 'X' });
        const fos = fields.find((f) => f.id === 'formField-fieldOfStudy');
        assert.equal(fos.capability, 'searchSelect');
        assert.equal(fos.cardinality, 'one');
        assert.ok(fos.whenPresent, 'still absent on the executive pages');
        assert.ok(!fos.optional, 'required where it renders');
    });

    test('my information: countryPhoneCode is the documented searchMulti/one exception', () => {
        const fields = myinfo.myInfoPlan({}, {});
        const phone = fields.find((f) => f.id === 'formField-countryPhoneCode');
        assert.equal(phone.capability, 'searchMulti');
        assert.equal(phone.cardinality, 'one');
        assert.equal(phone.contractException, 'measured-one-term-token-widget');
    });

    test('no spec anywhere carries an ILLEGAL pair', () => {
        const declared = [];
        for (const s of planner.SECTIONS) {
            for (const f of s.fields({ field_of_study: 'x', gpa: '1', level: 'Fluent', language: 'English' })) {
                if (f.capability || f.cardinality) declared.push({ where: `${s.name}.${f.id || f.name}`, f });
            }
        }
        for (const f of myinfo.myInfoPlan({}, {})) {
            if (f.capability || f.cardinality) declared.push({ where: `myinfo.${f.id}`, f });
        }
        assert.ok(declared.length >= 2, 'the declarations exist to be checked');
        for (const { where, f } of declared) {
            const ok = (f.capability === 'searchSelect' && f.cardinality === 'one')
                || (f.capability === 'searchMulti' && f.cardinality === 'many')
                || (f.capability === 'searchMulti' && f.cardinality === 'one' && !!f.contractException);
            assert.ok(ok, `${where} declares an illegal pair: ${f.capability}/${f.cardinality}`);
        }
    });
});

describe('CONTRACT_ERROR is the developer\'s result, not the candidate\'s', () => {
    test('it exists, is semantic (no retry, no model), and its wording names the plan', async () => {
        const { SEMANTIC } = await import('../src/content-agent/mdlz-v2/config.js');
        assert.equal(RESULT.CONTRACT_ERROR, 'CONTRACT_ERROR');
        assert.ok(SEMANTIC.has(RESULT.CONTRACT_ERROR), 'never spends a retry, never reaches the model');
    });

    test('runField on an undeclared chip-search field returns it with dev-facing wording', async () => {
        const f = {
            kind: WIDGET.SEARCH_MULTI,
            name: 'formField-mystery',
            present: () => true,
            controls: () => ({ chips: [] }),
        };
        const r = await executors.runField(f, 'anything', { sleep: (ms) => new Promise((res) => setTimeout(res, Math.min(ms, 5))) });
        assert.equal(r.result, RESULT.CONTRACT_ERROR);
        assert.match(r.reason, /internal field contract/i);
        assert.doesNotMatch(r.reason, /CV|candidate/i, 'never words it as the candidate\'s gap');
    });
});

describe('searchSelect — the single-exact-chip invariant, pure parts', () => {
    const fWith = (chips) => ({
        kind: 'searchMulti', name: 'formField-fieldOfStudy',
        controls: () => ({ chips: chips.map((t) => ({ textContent: t })) }),
    });
    const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5)));

    test('satisfied: exactly one chip, fold-equal to the want', async () => {
        const decl = { capability: 'searchSelect', cardinality: 'one' };
        const { cap } = executors.resolveCapability(chipField(), decl);
        assert.equal(cap.satisfied(fWith(['Marketing']), 'Marketing'), true);
        assert.equal(cap.satisfied(fWith(['Marketing']), 'marketing  '), true);
        assert.equal(cap.satisfied(fWith(['Teaching English as a Second Language']), 'Marketing'), false);
        assert.equal(cap.satisfied(fWith(['Marketing', 'Economics']), 'Marketing'), false,
            'two chips on a single-select is never satisfied');
        assert.equal(cap.satisfied(fWith([]), 'Marketing'), false);
    });

    test('verify names the two-chip state — the proof searchMulti cannot give', async () => {
        const decl = { capability: 'searchSelect', cardinality: 'one' };
        const { cap } = executors.resolveCapability(chipField(), decl);
        const bad = await cap.verify(fWith(['Marketing', 'Economics']), 'Marketing', { sleep, commitMs: 20 });
        assert.equal(bad.result, RESULT.COMMIT_FAILED);
        assert.match(bad.reason, /holds 2 chips/);
        const good = await cap.verify(fWith(['Marketing']), 'Marketing', { sleep, commitMs: 20 });
        assert.equal(good.result, RESULT.COMMITTED);
    });
});
