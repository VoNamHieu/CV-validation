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
