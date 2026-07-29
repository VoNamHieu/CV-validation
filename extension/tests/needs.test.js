// The field-resolution pipeline: what a page needs, what answers it, and whether
// what is already filled agrees with the candidate.
//
// Every case here is taken from a real Mondelez application driven end to end
// (wd3.myworkdaysite.com/recruiting/mdlz/External), where Workday's own résumé
// parse filled NAME and PHONE and left every other required field blank.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildManifest, classifyField, canonicalValue, compareValues, summarizeGaps,
    SOURCE, VERDICT,
} from '../src/content-agent/needs.js';

const DATA = {
    profile: { firstName: 'HIEU', lastName: 'VO', phone: '0705439825', email: 'a@b.com' },
    cv: {
        education: [{ institution: 'University of Illinois at Urbana-Champaign', degree: 'Marketing' }],
        languages: [{ language: 'English', level: 'Fluent' }],
        experience: [{ company: 'XGX', title: 'Product Manager' }],
    },
};
const field = (o) => ({ selector: '#x', value: '', required: true, ...o });

describe('classifying what a field asks for', () => {
    test('recognises the concept behind different wordings', () => {
        assert.equal(classifyField({ label: 'School or University' }).key, 'school');
        assert.equal(classifyField({ label: 'Field of Study' }).key, 'fieldOfStudy');
        assert.equal(classifyField({ label: 'Overall Result (GPA)' }).key, 'gpa');
        assert.equal(classifyField({ label: 'Số điện thoại' }).key, 'phone');
    });

    test('an unrecognised field is null rather than a wrong guess', () => {
        assert.equal(classifyField({ label: 'Favourite colour' }), null);
        assert.equal(classifyField({}), null);
    });
});

describe('resolving from the candidate\'s own data', () => {
    test('the flat profile answers identity fields', () => {
        const v = canonicalValue(classifyField({ label: 'First Name' }), DATA);
        assert.deepEqual(v, { value: 'HIEU', source: SOURCE.PROFILE });
    });

    test('the structured CV answers what the flat profile cannot hold', () => {
        // The exact gap measured on Mondelez: School and Field of Study are
        // required, the parse left both blank, and the flat profile has no key
        // for either.
        assert.equal(canonicalValue(classifyField({ label: 'School or University' }), DATA).value,
            'University of Illinois at Urbana-Champaign');
        assert.equal(canonicalValue(classifyField({ label: 'Field of Study' }), DATA).source, SOURCE.CV);
    });
});

describe('validating what the ATS already filled', () => {
    test('identical values match', () => {
        assert.equal(compareValues('Product Owner', 'Product Owner'), VERDICT.MATCH);
    });

    test('formatting differences are not disagreements', () => {
        assert.equal(compareValues('Hà Nội', 'ha noi'), VERDICT.NORMALIZED);
        assert.equal(compareValues('OCG Consulting', 'OCG'), VERDICT.NORMALIZED,
            'a truncated parse is the same fact written shorter');
    });

    test('a genuinely different value is a MISMATCH', () => {
        // The case the recipe could never see: it treats any non-empty value as
        // finished, so a parser that read "Consultant" for "Product Owner" was
        // left standing and the application went out with the mistake in it.
        assert.equal(compareValues('Product Owner', 'Consultant'), VERDICT.MISMATCH);
    });

    test('nothing to compare against is not a mismatch', () => {
        assert.equal(compareValues(null, 'Consultant'), VERDICT.UNVERIFIABLE);
        assert.equal(compareValues('Product Owner', ''), VERDICT.UNVERIFIABLE);
    });
});

describe('one pass over a page', () => {
    const FIELDS = [
        field({ label: 'First Name', value: 'HIEU' }),                    // parsed, agrees
        field({ label: 'Job Title', value: 'Consultant' }),               // parsed, WRONG
        field({ label: 'School or University' }),                         // empty, CV answers
        field({ label: 'Overall Result (GPA)' }),                         // empty, only the user knows
        field({ label: 'Have you previously worked for this organization?', options: [{ text: 'Yes' }, { text: 'No' }] }),
        field({ label: 'Degree', options: [{ text: 'B.S. - Bachelor of Science or equivalent' }] }),
    ];
    const m = buildManifest(FIELDS, { ...DATA, profile: { ...DATA.profile, currentTitle: 'Product Owner' } });

    test('fills what the candidate\'s data answers', () => {
        const keys = m.fill.map(f => f.key);
        assert.ok(keys.includes('school'), 'from the structured CV');
        assert.ok(keys.includes('previous_employment'), 'from a deterministic rule');
    });

    test('flags what the ATS got wrong instead of leaving it', () => {
        const bad = m.verify.find(v => v.verdict === VERDICT.MISMATCH);
        assert.equal(bad.expected, 'Product Owner');
        assert.equal(bad.actual, 'Consultant');
    });

    test('separates gaps the user must answer from gaps worth inferring', () => {
        const s = summarizeGaps(m);
        assert.ok(s.userOnly.includes('gpa'), 'no evidence implies a grade');
        assert.ok(s.inferable.includes('degree'),
            'a qualification IS derivable from institution + subject, so the planner may try');
    });

    test('the summary names mismatches for the review, not just a count', () => {
        const s = summarizeGaps(m);
        assert.equal(s.mismatches.length, 1);
        assert.equal(s.mismatches[0].expected, 'Product Owner');
    });
});
