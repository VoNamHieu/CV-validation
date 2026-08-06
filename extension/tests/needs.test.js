// The field-resolution pipeline: what a page needs, what answers it, and whether
// what is already filled agrees with the candidate.
//
// Every case here is taken from a real Mondelez application driven end to end
// (wd3.myworkdaysite.com/recruiting/mdlz/External), where Workday's own résumé
// parse filled NAME and PHONE and left every other required field blank.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildManifest, classifyField, canonicalValue, compareValues, selectorPhrase, summarizeGaps,
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

    test('no Vietnamese name in the CV → the optional local box stays empty', () => {
        // User rule 2026-08-04: "Vo" is the ENGLISH spelling — writing it into
        // "… - Vietnamese" claims a Vietnamese name the data does not hold.
        const d = { profile: { firstName: 'Hieu', lastName: 'Vo' } };
        const m = buildManifest([
            field({ label: 'Family Name - Vietnamese', required: false }),
            field({ label: 'Family Name - Western Script', selector: '#w' }),
        ], d);
        assert.ok(!m.fill.some(x => x.label === 'Family Name - Vietnamese'), 'optional local box must not be filled');
        assert.equal(m.fill.find(x => x.label === 'Family Name - Western Script')?.value, 'Vo');
    });

    test('…but a REQUIRED local box takes the English name instead', () => {
        const d = { profile: { lastName: 'Vo' } };
        const m = buildManifest([field({ label: 'Family Name - Vietnamese', required: true })], d);
        assert.equal(m.fill[0]?.value, 'Vo');
    });

    test('parser junk in an optional local box is CLEARED, not respected', () => {
        // Measured on Visa: the résumé parse put "Hieu (Charles)" in the
        // Vietnamese FAMILY box and "VO" in the GIVEN box — swapped, nickname
        // included. A scrambled name is worse than an empty optional box.
        const d = { profile: { firstName: 'Hieu', lastName: 'Vo' } };
        const m = buildManifest([
            field({ label: 'Family Name - Vietnamese', required: false, value: 'Hieu (Charles)' }),
            field({ label: 'Given Name(s) - Vietnamese', selector: '#g', required: false, value: 'VO' }),
        ], d);
        const clears = m.override.filter(o => o.value === '');
        assert.equal(clears.length, 2, 'both scrambled local boxes are cleared');
    });

    test('a real Vietnamese name fills the local box WITH its marks', () => {
        const d = { profile: { lastName: 'Võ' } };
        const m = buildManifest([field({ label: 'Family Name - Vietnamese', required: false })], d);
        assert.equal(m.fill[0]?.value, 'Võ');
    });

    test('the dual-script twin no longer blocks correcting a swapped name', () => {
        // keyCount is script-scoped: lastName appearing in BOTH halves is by
        // design, not ambiguity — the Western GIVEN box holding the family
        // name gets corrected from the profile.
        const d = { profile: { firstName: 'Hieu', lastName: 'Vo' } };
        const m = buildManifest([
            field({ label: 'Given Name(s) - Vietnamese', required: false }),
            field({ label: 'Given Name(s) - Western Script', selector: '#gw', value: 'Vo' }),
        ], d);
        const o = m.override.find(x => x.label === 'Given Name(s) - Western Script');
        assert.equal(o?.value, 'Hieu');
    });

    test('a shouting name is re-cased even though it is the same fact', () => {
        // User decision 2026-08-04: "VO" === "Vo" as a fact, but it raises
        // Workday's capitalization advisory on every single application.
        const d = { profile: { lastName: 'Vo' } };
        const m = buildManifest([field({ label: 'Family Name - Western Script', value: 'VO' })], d);
        const o = m.override.find(x => x.label === 'Family Name - Western Script');
        assert.equal(o?.value, 'Vo');
    });

    test('re-casing converges — a correct box fires nothing', () => {
        const d = { profile: { lastName: 'Vo' } };
        const m = buildManifest([field({ label: 'Family Name - Western Script', value: 'Vo' })], d);
        assert.equal(m.override.length, 0);
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
        const orphans = FIELD_PATTERNS.filter(p => !p.profileKey && !p.path && !p.derive).map(p => p.key);
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

// ── Measured on PwC (2026-08-05) ─────────────────────────────────────────────

describe('a screening question is not a job-title field', () => {
    // "position" names the title box on most ATSs — and it is also the word every
    // screening question uses for the job applied to. Three REQUIRED Yes/No
    // questions were classified as `currentTitle` and routed the profile's job
    // title, which no Yes/No list offers; only the model rescued them, at ~20s a
    // call, for answers the policy rules already hold.
    for (const label of [
        'Are you legally authorised to work in the country / territory in which the position is based?',
        'Do you now, or will you in the future, need PwC to sponsor your visa or work permit for the position you are applying for?',
        'I agree to have my personal data processed by PwC for the purpose of recruitment for this position.',
    ]) {
        test(`not a title field: ${label.slice(0, 48)}…`, () => {
            const p = classifyField({ label });
            assert.notEqual(p?.key, 'currentTitle');
        });
    }

    test('an actual title field still classifies', () => {
        assert.equal(classifyField({ label: 'Position' }).key, 'currentTitle');
        assert.equal(classifyField({ label: 'Current Job Title' }).key, 'currentTitle');
    });
});

describe('notice period and start date are the same commitment', () => {
    const inDays = (n) => {
        const d = new Date(Date.now() + n * 86400000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    test('a stored notice period answers the start date', () => {
        const v = canonicalValue(classifyField({ label: 'Earliest available start date' }),
            { profile: { noticePeriod: '30 days' } });
        assert.equal(v.value, inDays(30));
        assert.equal(v.source, SOURCE.PROFILE);
    });

    test('a stored start date answers "how much notice"', () => {
        const v = canonicalValue(classifyField({ label: 'How much notice are you required to give?' }),
            { profile: { availableStartDate: inDays(28) } });
        assert.equal(v.value, '1 months');
    });

    test('a date already past reads as immediate availability', () => {
        const v = canonicalValue(classifyField({ label: 'Notice period' }),
            { profile: { availableStartDate: inDays(-3) } });
        assert.equal(v.value, 'Immediately');
    });

    test('neither stored stays a gap — nobody can guess it', () => {
        assert.equal(canonicalValue(classifyField({ label: 'Notice period' }), { profile: {} }), null);
    });
});

// ── The personal-facts block (PwC Voluntary Disclosures, 2026-08-05) ────────
describe('personal facts the profile already holds are wired, not modelled', () => {
    test('Primary Nationality resolves from the profile — as the COUNTRY name', () => {
        // The profile stores the demonym ("Vietnamese"); every country dropdown
        // lists the country ("Vietnam"). No matcher tier bridges that reversal.
        const v = canonicalValue(classifyField({ label: 'Primary Nationality*' }),
            { profile: { nationality: 'Vietnamese' } });
        assert.deepEqual(v, { value: 'Vietnam', source: SOURCE.PROFILE });
    });

    test('Country of Birth is inferred for a Vietnamese candidate, and says so', () => {
        const v = canonicalValue(classifyField({ label: 'Country / Territory of Birth*' }),
            { profile: { nationality: 'Vietnamese' } });
        assert.deepEqual(v, { value: 'Vietnam', source: SOURCE.AGENT_DEFAULT });
    });

    test('…and is NOT invented for a candidate with no Vietnamese signal', () => {
        assert.equal(canonicalValue(classifyField({ label: 'Country / Territory of Birth*' }),
            { profile: {} }), null);
    });

    test('a profile synced by an OLD build (no nationality key) still resolves', () => {
        // The stored profile predates the key entirely — the VN-market
        // derivation answers, flagged as the agent's inference.
        const v = canonicalValue(classifyField({ label: 'Primary Nationality*' }),
            { profile: { addressProvince: 'Hà Nội' } });
        assert.deepEqual(v, { value: 'Vietnam', source: SOURCE.AGENT_DEFAULT });
    });

    test('Date of Birth and Marital Status read the profile keys that always existed', () => {
        assert.equal(classifyField({ label: 'Date of Birth*' })?.key, 'dateOfBirth');
        assert.equal(classifyField({ label: 'Marital Status*' })?.key, 'maritalStatus');
        const v = canonicalValue(classifyField({ label: 'Date of Birth*' }),
            { profile: { dateOfBirth: '1996-01-15' } });
        assert.equal(v.value, '1996-01-15');
    });
});

describe('a nickname never reaches a legal-name box', () => {
    test('a profile poisoned by a stale web-app sync still fills clean', () => {
        // Measured 2026-08-06: a production re-sync (old splitLegalName)
        // clobbered the profile with 'Hieu (Charles)' — and every fill layer
        // faithfully wrote the nickname into legal-name fields, where one
        // tenant's maxLength then chopped it to "Hieu (Char". The shape rule
        // is the single choke point all name fills share.
        const v = canonicalValue(classifyField({ label: 'Last Name' }),
            { profile: { lastName: 'Hieu (Charles)' } });
        assert.equal(v.value, 'Hieu');
    });
});

describe('a field whose label we could not read', () => {
    // Workday re-renders a section and, for that pass, the observer reports the
    // field with no label at all — measured on PwC, where a REQUIRED name box
    // came back as "?" in unfilledLabels, matched no pattern, belonged to no
    // layer, and ended the run. The id is stable while the label flickers.
    test('classifies from the selector when the label is missing', () => {
        const p = classifyField({ label: '', selector: '#name--legalName--lastNameLocal' });
        assert.equal(p?.key, 'lastName');
    });

    test('the label still wins when it is there', () => {
        // A selector that says one thing and a label that says another: the
        // label is what the human reading the form sees.
        const p = classifyField({ label: 'Email Address', selector: '#name--legalName--lastNameLocal' });
        assert.equal(p?.key, 'email');
    });

    test('an opaque id classifies as nothing rather than as something wrong', () => {
        assert.equal(classifyField({ label: '', selector: '#gwt-uid-42' }), null);
    });

    test('reads ids the way a person would', () => {
        assert.equal(selectorPhrase('[data-automation-id="formField-legalName--firstNameLocal"] input'),
            'data automation id form Field legal Name first Name Local input');
    });
});
