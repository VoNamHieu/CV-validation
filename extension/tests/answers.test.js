// Answer Policy — what the agent answers when the profile has nothing.
//
// These questions are the ones that used to end a run: the planner was told
// "not in profile → NEED_HUMAN", so a required disclosure stopped the
// application short of the review page the user was going to check anyway.
// The rules here are what let it finish, and the line they must not cross is
// inventing a fact about the candidate.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolveAnswer, ruleFor, ANSWER_SOURCE } from '../src/content-agent/answers.js';

const q = (label) => ({ label, questionText: label });

describe('demographic / EEO self-identification', () => {
    const declineOptions = ['Yes', 'No', "I don't wish to answer"];

    for (const label of [
        'Please self-identify your gender',
        'Voluntary Self-Identification of Disability',
        'Are you a protected veteran?',
        'Race / Ethnicity',
    ]) {
        test(`declines: ${label}`, () => {
            const a = resolveAnswer(q(label), declineOptions, {});
            assert.equal(a.value, "I don't wish to answer");
            assert.equal(a.source, ANSWER_SOURCE.AGENT_DEFAULT);
        });
    }

    test('never picks an actual demographic value', () => {
        // The dangerous failure: answering the question rather than declining it.
        const a = resolveAnswer(q('Gender'), ['Male', 'Female', 'Prefer not to say'], {});
        assert.equal(a.value, 'Prefer not to say');
    });

    test('with no decline option offered, it answers nothing', () => {
        const a = resolveAnswer(q('Gender'), ['Male', 'Female'], {});
        assert.equal(a, null, 'better an empty field the review names than a guess');
    });
});

describe('screening questions with a safe default', () => {
    test('current employee → No', () => {
        assert.equal(resolveAnswer(q('Are you a current employee?'), ['Yes', 'No'], {}).value, 'No');
    });
    test('previously employed → No', () => {
        assert.equal(resolveAnswer(q('Have you previously been employed by us?'), ['Yes', 'No'], {}).value, 'No');
    });
    test('conflict of interest → No', () => {
        assert.equal(
            resolveAnswer(q('Do you have a relative who works here?'), ['Yes', 'No'], {}).value, 'No');
    });
    test('exact match beats substring — "No" must not resolve to "Not applicable"', () => {
        const a = resolveAnswer(q('Are you a current employee?'), ['Not applicable', 'Yes', 'No'], {});
        assert.equal(a.value, 'No');
    });
});

describe('the two we refuse to guess', () => {
    // A wrong answer here is a material misstatement on a real application, and
    // unlike a demographic question there is no neutral option that says nothing.
    test('work authorization is left to the user when the profile is silent', () => {
        assert.equal(resolveAnswer(q('Are you legally authorized to work in the US?'), ['Yes', 'No'], {}), null);
    });

    test('sponsorship is left to the user when the profile is silent', () => {
        assert.equal(resolveAnswer(q('Will you require visa sponsorship?'), ['Yes', 'No'], {}), null);
    });

    test('…but the profile answers them when it has the data', () => {
        const a = resolveAnswer(q('Are you legally authorized to work?'), ['Yes', 'No'], { workAuthorized: true });
        assert.equal(a.value, 'Yes');
        assert.equal(a.source, ANSWER_SOURCE.PROFILE, 'the user\'s own answer is not an agent default');
    });
});

describe('acknowledgements need the delegation', () => {
    const label = 'I have read and understand the above';
    test('answered when the batch modal granted it', () => {
        const a = resolveAnswer(q(label), ['Yes', 'No'], {}, { consentDelegated: true });
        assert.equal(a.value, 'Yes');
    });
    test('left alone when it did not', () => {
        assert.equal(resolveAnswer(q(label), ['Yes', 'No'], {}, { consentDelegated: false }), null);
    });
});

describe('source question', () => {
    test('prefers the company website ladder over anything naming a person', () => {
        const a = resolveAnswer(
            q('How did you hear about us?'),
            ['Employee Referral', 'Recruiter', 'Job Fair', 'Company Website', 'University'],
            {});
        assert.equal(a.value, 'Company Website');
    });

    test('walks down the ladder when the exact rung is absent', () => {
        const a = resolveAnswer(q('How did you hear about us?'), ['Employee Referral', 'Online'], {});
        assert.equal(a.value, 'Online');
    });

    test('answers nothing rather than naming a referrer who does not exist', () => {
        assert.equal(
            resolveAnswer(q('How did you hear about us?'), ['Employee Referral', 'Recruiter'], {}),
            null);
    });
});

describe('unknown questions', () => {
    test('no rule means no answer', () => {
        assert.equal(ruleFor('What is your favourite programming language?'), null);
        assert.equal(resolveAnswer(q('What is your favourite programming language?'), [], {}), null);
    });
});
