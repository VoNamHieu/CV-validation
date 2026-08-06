// Reshaping a resolved value before it reaches the form.
//
// The web app normalises names when it BUILDS the profile, but that runs at sync
// time — a profile synced before that shipped still carries "HIEU (CHARLES)", and
// a user should not have to know that re-syncing is the fix.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_RECIPES, degreeLadder, levelLadder } from '../src/content-agent/recipe.js';

describe('legal-name fields declare name normalisation', () => {
    const wd = FALLBACK_RECIPES.find(r => r.ats === 'workday');
    const mine = wd.steps.find(s => s.name === 'My Information');

    // The local-script pair carries the SAME name on a dual-script tenant, so it
    // takes the same casing rule — a name is not spelled differently because the
    // box next to it is labelled "- Vietnamese".
    for (const label of ['First name', 'Last name', 'First name (local)', 'Last name (local)']) {
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
        assert.deepEqual(shaped, ['First name', 'Last name', 'First name (local)', 'Last name (local)']);
    });

    test('the local-script pair is owned by the recipe, not left to label reading', () => {
        // The run that ended NEED_HUMAN did so on "Family Name - Vietnamese*":
        // the recipe had no selector for it, so it belonged to whichever layer
        // could read its label — and on the pass that mattered, none could.
        for (const label of ['First name (local)', 'Last name (local)']) {
            const f = mine.fields.find(x => x.label === label);
            assert.ok(/Local/.test(f.selector), `${label} must target the *Local input`);
            assert.ok(!f.required, `${label} is absent on single-script tenants — it must not block them`);
        }
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
            assert.ok(f.selector && !f.labelMatch, `${label} has a measured id — a label guess is not good enough`);
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

// ── a value the field cannot take is worse than none ───────────────────────
describe('Degree refuses a subject', () => {
    const wd = FALLBACK_RECIPES.find(r => r.ats === 'workday');
    const degree = wd.steps.find(s => s.name === 'My Experience').fields
        .find(f => f.label === 'Degree');

    test('it declares what it can accept', () => {
        // A degree dropdown lists QUALIFICATIONS. CVs write the SUBJECT on the
        // same line, so highestDegree arrives as "Marketing" and the search cannot
        // succeed — at ten seconds an iteration, every iteration, before reporting
        // option-not-found. Empty leaves a gap the review names instead.
        assert.equal(degree.accept, 'qualification');
    });

    test('the gate is at FILL time, not only at sync time', () => {
        // The web app applies the same rule when it builds the profile, but that
        // runs at sync — a profile synced before it shipped still says
        // "Marketing", and "re-sync from the web app" is not a fix a user should
        // have to know about.
        assert.equal(degree.profileKey, 'highestDegree');
    });
});

// ── the case no string rule can serve ──────────────────────────────────────
describe('Degree falls back to inference', () => {
    const wd = FALLBACK_RECIPES.find(r => r.ats === 'workday');
    const degree = wd.steps.find(s => s.name === 'My Experience').fields
        .find(f => f.label === 'Degree');

    test('it is allowed to be inferred', () => {
        // A Vietnamese CV says "Cử nhân Marketing" and the dropdown offers B.S. /
        // B.B.A. / L.L.B. and sixteen more. Matching "Bachelor" hits eleven of
        // them; picking the first invents a discipline. The model chooses, from
        // the options actually on screen, given the education.
        assert.equal(degree.infer, true);
    });

    test('inference does not replace the accept gate', () => {
        // Both, in order: a value that IS a qualification is used as-is, and only
        // an unusable one reaches the model. The gate is what stops "Marketing"
        // being searched for in a list of qualifications.
        assert.equal(degree.accept, 'qualification');
    });
});

// ── the rest of My Experience ──────────────────────────────────────────────
describe('languages and skills', () => {
    const wd = FALLBACK_RECIPES.find(r => r.ats === 'workday');
    const exp = wd.steps.find(s => s.name === 'My Experience');
    const by = (l) => exp.fields.find(f => f.label === l);

    test('both language fields exist and are required', () => {
        // Measured on Mondelez: Language and "Overall" (proficiency) both block
        // the step, and neither had a recipe field.
        assert.equal(by('Language').required, true);
        assert.equal(by('Language level').required, true);
    });

    test('only the GUID field is addressed by label', () => {
        // Language has a stable id, measured. "Overall" does not — its id is a
        // per-tenant GUID, so a selector would work on one company only.
        assert.equal(by('Language level').labelMatch, 'overall');
        assert.ok(!by('Language level').selector, 'a GUID selector would work on one tenant only');
        assert.match(by('Language').selector, /formField-language/);
    });

    test('skills is a search field, not a text field', () => {
        // Workday's Skills refuses free text: typing leaves the box empty, and the
        // value exists only once a search RESULT is clicked.
        assert.equal(by('Skills').type, 'search-multi');
        assert.equal(typeof by('Skills').max, 'number', 'a long skills list must not be typed in full');
        assert.match(by('Skills').selector, /formField-skills/, 'measured id, not a label guess');
    });

    test('skills is not required', () => {
        // It is genuinely optional on this form, and a skill the employer's
        // taxonomy does not contain must not become a blocker.
        assert.ok(!by('Skills').required);
    });
});

// ── a section that starts empty ────────────────────────────────────────────
describe('repeating sections are created before they are filled', () => {
    const wd = FALLBACK_RECIPES.find(r => r.ats === 'workday');
    const exp = wd.steps.find(s => s.name === 'My Experience');

    test('Work Experience is ensured', () => {
        // Measured on two jobs at the SAME company: one rendered Job Title,
        // Company and the dates, the other rendered an Add button and nothing
        // else, because Workday's résumé parse had created a row on the first and
        // not the second. The recipe cannot fill a row that does not exist, and it
        // cannot assume either shape.
        assert.deepEqual(exp.ensureSections, ['Work Experience', 'Education', 'Languages']);
    });

    test('the fields it unlocks are declared', () => {
        const labels = exp.fields.map(f => f.label);
        for (const need of ['Job Title', 'Company', 'Work From']) {
            assert.ok(labels.includes(need), `${need} is what ensuring the section is FOR`);
        }
    });
});

// ── the level a form actually offers ───────────────────────────────────────
describe('language proficiency maps onto the offered rungs', () => {
    const wd = FALLBACK_RECIPES.find(r => r.ats === 'workday');
    const level = wd.steps.find(s => s.name === 'My Experience').fields
        .find(f => f.label === 'Language level');

    test('the ladder is sliced from the candidate\'s OWN level at fill time', () => {
        // A static Native-first list overclaimed for anyone below Native: an
        // Advanced speaker whose exact rung was absent fell UP to Native.
        // `levelLadder: true` makes the executor build the ladder from the
        // row's own level instead.
        assert.equal(level.levelLadder, true);
        assert.equal(level.valuePriority, undefined);
    });

    test('the ladder only ever steps DOWN', () => {
        // A native speaker is fluent, so falling to Fluent claims nothing
        // extra. The reverse — promoting anyone to a rung above their own —
        // would be a lie, whatever the form offers.
        assert.deepEqual(levelLadder('Native'),
            ['Native', 'Fluent', 'Advanced', 'Intermediate', 'Beginner']);
        assert.deepEqual(levelLadder('Advanced'),
            ['Advanced', 'Intermediate', 'Beginner'],
            'measured 3-rung form (Beginner/Intermediate/Fluent): Advanced falls to Intermediate, never up to Fluent');
        assert.deepEqual(levelLadder('nonsense'),
            ['Fluent', 'Advanced', 'Intermediate', 'Beginner'],
            'unknown level starts at Fluent, never claims Native');
    });
});

describe('the degree LEVEL is derivable without a model', () => {
    // The Degree field lived on inference alone: correct when the model
    // answered ("asked: 42 → Bachelor Degree"), red when it returned nothing —
    // same tenant, same field, six hours apart. The level the CV itself states
    // now tries deterministically first; the model stays as the last net.
    test('free-text CV degrees resolve to generic level phrasings', () => {
        assert.deepEqual(degreeLadder('Bachelor of Science in Marketing')[0], "Bachelor's Degree");
        assert.deepEqual(degreeLadder('Cử nhân Công nghệ thông tin')[0], "Bachelor's Degree");
        assert.deepEqual(degreeLadder('MBA')[0], "Master's Degree");
        assert.deepEqual(degreeLadder('Tiến sĩ Kinh tế')[0], 'Doctorate Degree');
    });

    test('no level stated → no rungs, the field falls through to infer', () => {
        assert.deepEqual(degreeLadder('Marketing'), []);
        assert.deepEqual(degreeLadder(''), []);
    });

    test('rungs are LEVELS only — no rung ever claims a discipline', () => {
        for (const level of ['Bachelor of Arts', 'Thạc sĩ Luật', 'PhD in Physics']) {
            for (const rung of degreeLadder(level)) {
                assert.ok(!/\b(science|arts|law|business|engineering)\b/i.test(rung),
                    `rung "${rung}" claims a discipline`);
            }
        }
    });
});


describe('the empty My Experience page is still My Experience', () => {
    // PwC's /apply flow (no résumé autofill) renders three bare sections and
    // three Add buttons — not one formField. The step used to detect by
    // formField-degree alone, matched nothing, and the agent advanced past an
    // application with no work history at all.
    const step = FALLBACK_RECIPES.workday.steps.find(s => s.name === 'My Experience');

    test('detect covers both the filled and the empty shape', () => {
        assert.ok(step.detect.includes('formField-degree'));
        assert.ok(step.detect.includes('myExperiencePage'));
    });

});
