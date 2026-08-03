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

    test('recognises a neutral placeholder as the decline option', () => {
        // Measured on Mondelez, where Gender is REQUIRED and the four options are
        // Female / Male / Not Specified / Other. Every phrasing the rule knew was
        // US-styled ("prefer not to say"), so nothing matched and the step could
        // not advance at all — on a field that does offer a way to say nothing.
        const a = resolveAnswer(q('Gender'), ['Female', 'Male', 'Not Specified', 'Other'], {});
        assert.equal(a.value, 'Not Specified');
    });

    test('"Other" is a statement, not a decline', () => {
        // The trap in the option list above: "Other" is the only one left if the
        // placeholder is missed, and picking it asserts something about the person.
        const a = resolveAnswer(q('Gender'), ['Female', 'Male', 'Other'], {});
        assert.equal(a, null);
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

describe('work authorization and sponsorship — home-market defaults', () => {
    // Formerly refused when the profile was silent. User decision 2026-08-02:
    // the product serves VN candidates on VN-located jobs, where "authorized:
    // yes / sponsorship: no" is simply true — and every default lands in the
    // review list before the user submits. REVISIT for abroad jobs.
    test('work authorization defaults to Yes when the profile is silent', () => {
        const a = resolveAnswer(q('Are you legally authorized to work in Vietnam?'), ['Yes', 'No'], {});
        assert.equal(a.value, 'Yes');
        assert.equal(a.source, ANSWER_SOURCE.AGENT_DEFAULT, 'a default is never dressed up as the user\'s own answer');
    });

    test('sponsorship defaults to No when the profile is silent', () => {
        const a = resolveAnswer(q('Will you require visa sponsorship?'), ['Yes', 'No'], {});
        assert.equal(a.value, 'No');
        assert.equal(a.source, ANSWER_SOURCE.AGENT_DEFAULT);
    });

    test('…and the profile still wins over the default when it has the data', () => {
        const a = resolveAnswer(q('Are you legally authorized to work?'), ['Yes', 'No'], { workAuthorized: true });
        assert.equal(a.value, 'Yes');
        assert.equal(a.source, ANSWER_SOURCE.PROFILE, 'the user\'s own answer is not an agent default');
    });
});

describe('acknowledgements', () => {
    // Mandatory to advance, so answered — the boundary is submission, and the
    // user reads the review before pressing it. Gating this behind a delegation
    // flag stopped the application one step short of that review.
    test('answered', () => {
        const a = resolveAnswer(q('I have read and understand the above'), ['Yes', 'No'], {});
        assert.equal(a.value, 'Yes');
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

describe('company-relationship questions default to No', () => {
    // User decision 2026-08-02: ties to the HIRING company (a covenant, stock,
    // sponsorship needs) default to "No" when nothing stored says otherwise —
    // this product's candidates left MNC employers and as a rule hold no such
    // ties. Every one is AGENT_DEFAULT, so the review names it before the user
    // submits; a candidate who DOES hold one corrects it there.
    const DEFAULT_NO = [
        ['Do you have an agreement or requirement with your current or previous employer '
            + '(e.g. non-compete agreement, or other restrictive covenant)?', 'restrictive_covenant'],
        ['Do you currently, or will you in the future, require Mondelēz to sponsor a work visa?',
            'sponsorship'],
        ['Do you own any stocks or shares in Mondelēz International?', 'company_ties'],
        ['Are you a shareholder or board member of the company?', 'company_ties'],
    ];

    for (const [label, kind] of DEFAULT_NO) {
        test(`${kind}: defaults to No`, () => {
            assert.equal(ruleFor(label)?.kind, kind, 'the rule must recognise the question by name');
            const a = resolveAnswer(q(label), ['Yes', 'No'], {});
            assert.equal(a.value, 'No');
            assert.equal(a.source, ANSWER_SOURCE.AGENT_DEFAULT, 'a default must surface in the review');
        });
    }

    test('"share your…" phrasing is a verb, not a shareholding question', () => {
        assert.equal(ruleFor('Would you like to share your salary expectations?')?.kind !== 'company_ties', true);
    });
});

describe('unknown questions', () => {
    test('no rule means no answer', () => {
        assert.equal(ruleFor('What is your favourite programming language?'), null);
        assert.equal(resolveAnswer(q('What is your favourite programming language?'), [], {}), null);
    });
});

// ── wording measured on real forms ─────────────────────────────────────────
describe('real-world phrasings', () => {
    test('Mondelez: "previously worked for this organization" resolves to No', () => {
        // Measured on wd3.myworkdaysite.com/recruiting/mdlz — a REQUIRED radio on
        // My Information, absent from the recipe, and missed by the first version
        // of this rule (which only knew "previously been employed"). A required
        // question with no answer is a step the agent cannot leave.
        const a = resolveAnswer(
            q('Have you previously worked for this organization? If Yes, please answer the questions below. If No, please continue to the next page.'),
            ['Yes', 'No'], {});
        assert.equal(a.value, 'No');
        assert.equal(a.kind, 'previous_employment');
    });
});

describe('grade is never inferred', () => {
    test('GPA is left to the candidate even with options offered', () => {
        // A degree is derivable from institution + subject + years. A grade is
        // not derivable from anything — a plausible number is a fabricated
        // academic record.
        assert.equal(resolveAnswer(q('Overall Result (GPA)'), [], {}), null);
        assert.equal(resolveAnswer(q('Điểm trung bình'), [], {}), null);
    });

    test('…but the profile answers it when the candidate supplied one', () => {
        const a = resolveAnswer(q('Overall Result (GPA)'), [], { gpa: '3.6' });
        assert.equal(a.value, '3.6');
        assert.equal(a.source, ANSWER_SOURCE.PROFILE);
    });
});
