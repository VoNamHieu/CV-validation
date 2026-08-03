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
    FIELD_PATTERNS, PROFILE_KEYS, SOURCE, VERDICT,
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

    test('a dual-script duplicate is the same concept', () => {
        // Measured on P&G VN: every Name/Address field rendered twice, as
        // "… - Vietnamese" and "… - Western Script", all REQUIRED. The suffix
        // must not hide the concept.
        assert.equal(classifyField({ label: 'Family Name - Vietnamese' }).key, 'lastName');
        assert.equal(classifyField({ label: 'Given Name(s) - Western Script' }).key, 'firstName');
        assert.equal(classifyField({ label: 'Intercalary (or Middle) Name - Vietnamese' }).key, 'middleName');
        assert.equal(classifyField({ label: 'Address Line 1 - Vietnamese' }).key, 'addressStreet');
        assert.equal(classifyField({ label: 'Address Line 2 - Vietnamese' }).key, 'addressStreet2');
        assert.equal(classifyField({ label: 'District or Town - Vietnamese' }).key, 'addressDistrict');
    });

    test('Tên đệm is the middle name, not the given name', () => {
        // "Tên đệm" CONTAINS "tên" — first-match order is what keeps the
        // middle name out of the given-name box.
        assert.equal(classifyField({ label: 'Tên đệm' }).key, 'middleName');
    });
});

describe('resolving from the candidate\'s own data', () => {
    test('the flat profile answers identity fields — names re-cased', () => {
        // The profile still carries the CV's shouting caps; filling "HIEU"
        // raises Workday's capitalization advisory on every application, so
        // name-classified fields normalise at resolve time (same rule the
        // recipe applies via `normalize: 'name'`).
        const v = canonicalValue(classifyField({ label: 'First Name' }), DATA);
        assert.deepEqual(v, { value: 'Hieu', source: SOURCE.PROFILE });
    });

    test('a middle name hides in the full name when first/last did not claim it', () => {
        // Profile shape after a "VO NAM HIEU" CV: firstName Hieu, lastName Vo
        // — the NAM in the middle vanished in the split, while P&G renders
        // "Intercalary (or Middle) Name" REQUIRED in both scripts.
        const d = { profile: { firstName: 'Hieu', lastName: 'Vo', fullName: 'Vo Nam Hieu' } };
        const v = canonicalValue(classifyField({ label: 'Intercalary (or Middle) Name - Western Script' }), d);
        assert.deepEqual(v, { value: 'Nam', source: SOURCE.PROFILE });
    });

    test('no middle name in the data answers nothing — never an invention', () => {
        const d = { profile: { firstName: 'Hieu', lastName: 'Vo', fullName: 'Hieu (Charles) Vo' } };
        assert.equal(canonicalValue(classifyField({ label: 'Middle Name' }), d), null);
    });

    test('a required address box falls back to the city, and says so', () => {
        // User decision: a CV that only names "Hà Nội" still answers a
        // required street box with that city rather than stalling the run.
        // AGENT_DEFAULT is what makes the review name it.
        const d = { profile: { addressStreet: '', addressProvince: 'Hà Nội' } };
        assert.deepEqual(
            canonicalValue(classifyField({ label: 'Address Line 1 - Vietnamese' }), d),
            { value: 'Hà Nội', source: SOURCE.AGENT_DEFAULT });
        assert.deepEqual(
            canonicalValue(classifyField({ label: 'Address Line 2' }), d),
            { value: 'Hà Nội', source: SOURCE.AGENT_DEFAULT });
        assert.deepEqual(
            canonicalValue(classifyField({ label: 'District or Town' }), d),
            { value: 'Hà Nội', source: SOURCE.AGENT_DEFAULT });
    });

    test('a dual-script pair splits one fact into two spellings', () => {
        // The "- Vietnamese" half keeps its diacritics; "- Western Script" is
        // the same fact romanized. And a PLAIN label is the western half too,
        // whenever its Vietnamese twin sits on the same page — P&G suffixes
        // only the local-script address boxes.
        const d = { profile: { lastName: 'Võ', addressStreet: 'Số 1 Phố Duy Tân' } };
        const m = buildManifest([
            field({ label: 'Family Name - Vietnamese' }),
            field({ label: 'Family Name - Western Script', selector: '#w' }),
            field({ label: 'Address Line 1 - Vietnamese', selector: '#av' }),
            field({ label: 'Address Line 1', selector: '#aw' }),
        ], d);
        const by = (l) => m.fill.find(x => x.label === l)?.value;
        assert.equal(by('Family Name - Vietnamese'), 'Võ');
        assert.equal(by('Family Name - Western Script'), 'Vo');
        assert.equal(by('Address Line 1 - Vietnamese'), 'Số 1 Phố Duy Tân');
        assert.equal(by('Address Line 1'), 'So 1 Pho Duy Tan');
    });

    test('a page without a Vietnamese twin passes values through untouched', () => {
        // Every other tenant: one "District or Town", diacritics intact.
        const d = { profile: { addressDistrict: 'Cầu Giấy' } };
        const m = buildManifest([field({ label: 'District or Town' })], d);
        assert.equal(m.fill[0].value, 'Cầu Giấy');
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

// ── the candidate's data is the source of truth ────────────────────────────
// They wrote and approved it; the ATS value is a machine's guess at a PDF. So a
// disagreement is CORRECTED — but only where the correction is certainly the
// right one, because the risk here is not that our data is wrong, it is that our
// comparison pointed at the wrong row.
describe('overriding a wrong parse', () => {
    const data = { profile: { currentTitle: 'Product Owner' }, cv: DATA.cv };

    test('a wrong single-valued field is corrected', () => {
        const m = buildManifest([field({ label: 'Job Title', value: 'Consultant' })], data);
        assert.equal(m.override.length, 1);
        assert.equal(m.override[0].value, 'Product Owner');
        assert.equal(m.override[0].actual, 'Consultant');
    });

    test('a correct value is left alone', () => {
        const m = buildManifest([field({ label: 'Job Title', value: 'Product Owner' })], data);
        assert.equal(m.override.length, 0);
    });

    test('a formatting difference is not a correction', () => {
        const m = buildManifest([field({ label: 'Job Title', value: 'product owner' })], data);
        assert.equal(m.override.length, 0, 'same fact, different case');
    });

    test('a REPEATED concept is reported, never overridden', () => {
        // Two "School or University" inputs means two education rows. Our data
        // always reads entry [0], so correcting would move the wrong school onto
        // the wrong line — a new error, introduced confidently.
        const m = buildManifest([
            field({ label: 'School or University', value: 'Some Other University' }),
            field({ label: 'School or University', value: 'Another Place', selector: '#y' }),
        ], DATA);
        assert.equal(m.override.length, 0);
        assert.ok(m.verify.some(v => v.verdict === VERDICT.MISMATCH), 'still surfaced for review');
    });

    test('a committed dropdown is reported, never overridden', () => {
        // Overwriting a select means deselecting first; a half-applied change to
        // a committed choice is worse than a flagged one.
        const m = buildManifest(
            [field({ label: 'Job Title', value: 'Consultant', componentType: 'custom-dropdown' })], data);
        assert.equal(m.override.length, 0);
        assert.ok(m.verify.some(v => v.verdict === VERDICT.MISMATCH));
    });
});

// ── the schema contract ────────────────────────────────────────────────────
describe('every profileKey a pattern reads actually exists', () => {
    test('no pattern names a field the schema does not define', () => {
        // A profileKey the schema never defines reads as undefined forever, which
        // is indistinguishable from "the user has not filled it in" — so the field
        // is reported as a gap the user has no way to close. Five keys were in
        // exactly that state until the schema caught up.
        const unknown = FIELD_PATTERNS
            .filter(p => p.profileKey && !PROFILE_KEYS.has(p.profileKey))
            .map(p => `${p.key} → profile.${p.profileKey}`);
        assert.deepEqual(unknown, [], 'add these to ExtensionProfile, or read them via cvPath');
    });

    test('every pattern can be answered from somewhere', () => {
        const orphans = FIELD_PATTERNS.filter(p => !p.profileKey && !p.path).map(p => p.key);
        assert.deepEqual(orphans, [], 'a pattern with no source can only ever be a gap');
    });
});

// ── requiredness comes from the page, never from config ────────────────────
describe('gaps follow the form, not a schema', () => {
    test('a field the page marks required becomes a gap; the same field optional does not', () => {
        // The same automation id is optional at one company and mandatory at the
        // next, so requiredness cannot live in shared per-ATS config. Measured on
        // Mondelez: My Experience marks six fields required that the recipe's
        // (3M-derived) list never mentioned.
        const asRequired = buildManifest([field({ label: 'Overall Result (GPA)', required: true })], DATA);
        assert.equal(asRequired.gaps.length, 1);

        const asOptional = buildManifest([field({ label: 'Overall Result (GPA)', required: false })], DATA);
        assert.equal(asOptional.gaps.length, 0, 'optional on this tenant → not a gap');
    });

    test('a field no pattern recognises is still reported when the page requires it', () => {
        // The point of scanning first: a concept nothing in our config has ever
        // seen still reaches the user by name instead of vanishing.
        const m = buildManifest([field({ label: 'Employee referral code', required: true })], DATA);
        assert.equal(m.gaps.length, 1);
        assert.equal(m.gaps[0].label, 'Employee referral code');
        assert.equal(m.gaps[0].key, null, 'unclassified, but not invisible');
    });
});
