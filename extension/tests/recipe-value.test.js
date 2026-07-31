// Reshaping a resolved value before it reaches the form.
//
// The web app normalises names when it BUILDS the profile, but that runs at sync
// time — a profile synced before that shipped still carries "HIEU (CHARLES)", and
// a user should not have to know that re-syncing is the fix.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_RECIPES } from '../src/content-agent/recipe.js';

describe('legal-name fields declare name normalisation', () => {
    const wd = FALLBACK_RECIPES.find(r => r.ats === 'workday');
    const mine = wd.steps.find(s => s.name === 'My Information');

    for (const label of ['First name', 'Last name']) {
        test(`${label} is normalised at fill time`, () => {
            // Without this the agent fills whatever the profile happens to hold,
            // and Workday raises "contains more than 2 capital letters" on every
            // application made from an ALL-CAPS CV.
            const f = mine.fields.find(x => x.label === label);
            assert.equal(f.normalize, 'name');
        });
    }

    test('no other field is reshaped', () => {
        // Postal code "100000" and the like must reach the form verbatim.
        const shaped = mine.fields.filter(f => f.normalize).map(f => f.label);
        assert.deepEqual(shaped, ['First name', 'Last name']);
    });
});

// ── My Experience: the block that ended the last full run ──────────────────
describe('work experience is fillable from the CV', () => {
    const wd = FALLBACK_RECIPES.find(r => r.ats === 'workday');
    const exp = wd.steps.find(s => s.name === 'My Experience');

    test('Job Title, Company and the dates all have fields', () => {
        // Measured: five required fields with no label the scanner could name, and
        // the planner then reported them as "not provided in the user profile"
        // while the CV held every one.
        const labels = exp.fields.map(f => f.label);
        for (const need of ['Job Title', 'Company', 'Work From']) {
            assert.ok(labels.includes(need), `${need} has no recipe field`);
        }
    });

    test('they read the CV, not the flat profile', () => {
        // experience[] is a list; the flat profile is one string per concept and
        // cannot express "the company for THIS role".
        for (const label of ['Job Title', 'Company', 'Work From', 'Work To']) {
            const f = exp.fields.find(x => x.label === label);
            assert.match(f.cvPath, /^experience\[0\]\./, `${label} must come from the CV`);
        }
    });

    test('dates are declared as dates', () => {
        // Workday splits a date into month + year inputs, so a plain text fill
        // enters half a date and leaves the step invalid.
        assert.equal(exp.fields.find(f => f.label === 'Work From').type, 'date');
        assert.equal(exp.fields.find(f => f.label === 'Work To').type, 'date');
    });

    test('only the start date is required', () => {
        // A current role has no end date, and demanding one would block the step
        // on a value that should not exist.
        assert.equal(exp.fields.find(f => f.label === 'Work From').required, true);
        assert.ok(!exp.fields.find(f => f.label === 'Work To').required);
    });
});
