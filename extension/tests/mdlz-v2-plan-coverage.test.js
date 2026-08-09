// Every required field on a page v2 owns must be in that page's plan.
//
// This test exists because of a live run that ended "Stuck — blockers: How Did
// You Hear About Us?". The field is REQUIRED, it is in the recipe, v1 has filled
// it for months — and v2's My Information plan simply did not contain it. Twelve
// fields came back SATISFIED, the thirteenth was never planned, the page could
// never be finished, and because v2 owns the page v1 could not step in. The
// controller reported `gaps: 0` about a page it had made permanently stuck.
//
// The cause was not a missing measurement. It was that I built the plan from the
// field descriptors I remembered seeing and never diffed it against the source.
// So the diff is a test now: the recipe is the list, the plan is the claim, and
// the machine compares them.
//
// A field may be excluded only by NAME, here, with a reason — which makes every
// omission a deliberate line somebody wrote rather than something that fell out
// of a grep.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';

let dom;
let recipe;
let myInfoPlan;
let SECTIONS;

/**
 * Required fields v2 deliberately does not plan, and why.
 *
 * Empty is the healthy state. Anything added here is a decision on the record.
 */
const EXCLUDED = {
    // (none)
};

/** The automation id a recipe selector points at. */
const idOf = (selector) => (String(selector || '').match(/data-automation-id="([^"]+)"/) || [])[1] || null;

function requiredFieldsOf(stepName) {
    const wd = recipe.FALLBACK_RECIPES.find((r) => r.ats === 'workday');
    const step = wd.steps.find((s) => s.name === stepName);
    assert.ok(step, `the recipe has no step named "${stepName}"`);
    return (step.fields || [])
        .filter((f) => f.required)
        .map((f) => ({ label: f.label, id: idOf(f.selector), labelMatch: f.labelMatch }))
        .filter((f) => f.id);
}

before(async () => {
    console.log = () => { };
    dom = installDom();
    recipe = await import('../src/content-agent/recipe.js');
    ({ myInfoPlan } = await import('../src/content-agent/mdlz-v2/page-myinfo.js'));
    ({ SECTIONS } = await import('../src/content-agent/mdlz-v2/planner.js'));
});

describe('My Information plans every field the recipe marks required', () => {
    test('the diff is empty', () => {
        const required = requiredFieldsOf('My Information');
        assert.ok(required.length >= 8, `only found ${required.length} required fields — the extractor is wrong`);

        const planned = new Set(myInfoPlan({ fullName: 'Võ Nam Hiếu', phone: '07' }, {}).map((e) => e.id));
        const missing = required
            .filter((f) => !planned.has(f.id))
            .filter((f) => !EXCLUDED[f.id]);

        assert.deepEqual(missing.map((f) => `${f.label} (${f.id})`), [],
            'required on the page, absent from the plan — the page can never be finished');
    });

    test('and the plan does not name fields the page does not have', () => {
        // The other direction: a plan full of ids nobody renders wastes a pass
        // and hides what is really missing.
        const wd = recipe.FALLBACK_RECIPES.find((r) => r.ats === 'workday');
        const step = wd.steps.find((s) => s.name === 'My Information');
        const known = new Set((step.fields || []).map((f) => idOf(f.selector)).filter(Boolean));
        // The local-script pair is measured on dual-script tenants and carries
        // its own selector in the recipe; everything else must be known.
        const unknown = myInfoPlan({ fullName: 'Võ Nam Hiếu' }, {})
            .map((e) => e.id)
            .filter((id) => !known.has(id));
        assert.deepEqual(unknown, [], 'planned but not in the recipe for this step');
    });
});

describe('My Experience plans every field the recipe marks required', () => {
    test('the sections cover the required row fields', () => {
        const required = requiredFieldsOf('My Experience');
        const planned = new Set(SECTIONS.flatMap((spec) => spec.fields({}).map((f) => f.id).filter(Boolean)));
        // Skills is a page-level field rather than a row field, and the planner
        // adds it outside the section specs.
        planned.add('formField-skills');
        const missing = required.filter((f) => !planned.has(f.id) && !EXCLUDED[f.id]);
        assert.deepEqual(missing.map((f) => `${f.label} (${f.id})`), []);
    });
});
