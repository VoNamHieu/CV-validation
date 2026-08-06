// The agent's own name split — the layer that stops trusting the web app.
//
// Every measured poisoning came the same way: a production build running the
// OLD rule ("the last token is the given name") rewrote the profile on a CV
// edit, and the family name went into the given-name box of a real
// application. The web app is fixed but not deployed, and even once it is, a
// profile synced before the deploy stays wrong forever. So the agent re-derives
// from the name itself, right where a run begins.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isLegalNameLabel, splitLegalName, repairProfileNames } from '../src/content-agent/dom.js';

describe('splitting a name the agent can settle', () => {
    test('Vietnamese order — family name first', () => {
        assert.deepEqual(splitLegalName('Võ Nam Hiếu'), { firstName: 'Hiếu', lastName: 'Võ Nam' });
    });

    test('western order — a known VN family name at the END', () => {
        assert.deepEqual(splitLegalName('HIEU VO'), { firstName: 'Hieu', lastName: 'Vo' });
    });

    test('a parenthesised nickname never survives the split', () => {
        // The exact string production produced, and the exact swap it caused.
        assert.deepEqual(splitLegalName('HIEU (CHARLES) VO'), { firstName: 'Hieu', lastName: 'Vo' });
    });

    test('both ends plausible keeps the Vietnamese reading', () => {
        assert.deepEqual(splitLegalName('Nguyen Van Le'), { firstName: 'Le', lastName: 'Nguyen Van' });
    });

    test('a name it cannot settle yields, rather than guessing', () => {
        assert.equal(splitLegalName('Hieu'), null);          // one token
        assert.equal(splitLegalName('John Smith'), null);    // no VN family name at either end
        assert.equal(splitLegalName(''), null);
    });
});

describe('repairing a poisoned profile', () => {
    test('the swap measured on 2026-08-06 is corrected', () => {
        const poisoned = { fullName: 'HIEU (CHARLES) VO', firstName: 'Vo', lastName: 'Hieu', email: 'a@b.com' };
        const fixed = repairProfileNames(poisoned);
        assert.equal(fixed.firstName, 'Hieu');
        assert.equal(fixed.lastName, 'Vo');
        assert.equal(fixed.email, 'a@b.com', 'every other key survives untouched');
    });

    test('a correct profile is returned UNCHANGED — identity, not a copy', () => {
        // Callers compare by identity to decide whether to trace a repair.
        const good = { fullName: 'Hieu Vo', firstName: 'Hieu', lastName: 'Vo' };
        assert.equal(repairProfileNames(good), good);
    });

    test('no fullName means nothing to verify against', () => {
        const p = { firstName: 'Vo', lastName: 'Hieu' };
        assert.equal(repairProfileNames(p), p);
    });

    test('a name the splitter cannot settle leaves the profile alone', () => {
        const p = { fullName: 'John Smith', firstName: 'John', lastName: 'Smith' };
        assert.equal(repairProfileNames(p), p);
    });

    test('repair is idempotent', () => {
        const poisoned = { fullName: 'HIEU (CHARLES) VO', firstName: 'Vo', lastName: 'Hieu' };
        const once = repairProfileNames(poisoned);
        assert.equal(repairProfileNames(once), once);
    });
});


describe('a legal-name box is never rerouted to a picker', () => {
    // Mondelez, 2026-08-06: a stray popup's rows counted as probe evidence and
    // the plain First-name input was ruled a combobox — three listbox-timeouts
    // on a field a keyboard fills, run dead. The probe evidence is now scoped
    // to owned options; this predicate is the belt on top of that fix.
    test('every spelling of a name field is recognised', () => {
        for (const l of ['First name', 'Last name', 'Given Name(s) - Western Script*',
            'Family Name - Vietnamese*', 'Middle Name', 'Legal Name', 'Họ', 'Tên', 'Tên đệm']) {
            assert.ok(isLegalNameLabel(l), l);
        }
    });

    test('fields that merely contain "name" are not swept in', () => {
        for (const l of ['Username', 'Company Name', 'School Name', 'How did you hear', 'City or Ward']) {
            assert.ok(!isLegalNameLabel(l), l);
        }
    });
});
