// The CV the app really produces, planned by v2.
//
// The planner reads a CV. Which CV was, until this file existed, an assumption
// copied out of v1's `cvPath` strings — and a field name that drifts is the
// quietest failure this system can have: nothing throws, the plan is simply
// empty or wrong, and the pass reports "nothing planned for this page" on an
// application that needed filling.
//
// So the shapes below are taken from the app's own extraction schema
// (frontend/src/lib/cv-extraction-schema.ts and its normalisers), including the
// three details in it that would break a naive reader:
//
//   · dates are copied VERBATIM from the CV — "03/2021", "Jan 2021", "2021";
//   · an ongoing role has end_date "Hiện tại", not an empty string;
//   · education carries `institution` and `year`, never a `school` key, and no
//     field of study (which this tenant does not render either).

import { test, describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './harness/mini-dom.js';
import { buildHostilePage } from './harness/hostile-page.js';

let dom;
let page;
let planner;

/** Exactly the shape normalizeExperience/normalizeLanguages hand over. */
const CV = {
    name: 'Someone',
    summary: 'x',
    desired_job_title: 'Product Owner',
    skills: ['Product Roadmapping', 'SQL'],
    experience: [
        {
            title: 'Product Owner',
            company: 'Acme',
            start_date: '03/2021',
            end_date: 'Hiện tại',
            duration_months: 48,
            description: 'Owned the roadmap\nRan discovery',
        },
        {
            title: 'Business Analyst',
            company: 'Globex',
            start_date: 'Jan 2019',
            end_date: '02/2021',
            duration_months: 25,
            description: '',
        },
    ],
    education: [{ degree: 'Bachelor of Business Administration', institution: 'RMIT', year: '2018' }],
    // What a Vietnamese CV really arrives as: the mother tongue derived from the
    // CV's own language, English derived from a certificate, and the same
    // language written two ways.
    languages: [
        { language: 'English (IELTS 7.5)', level: '' },
        { language: 'Vietnamese', level: '' },
        { language: 'Tiếng Việt', level: 'Native' },
        { language: 'English', level: 'Fluent' },
    ],
    certifications: [], projects: [], awards: [], activities: [],
};

before(async () => {
    console.log = () => { };
    dom = installDom();
    planner = await import('../src/content-agent/mdlz-v2/planner.js');
});

after(() => dom?.uninstall());

beforeEach(() => {
    dom.document.body.children.forEach((c) => { c.parentNode = null; });
    dom.document.body.children = [];
    page = buildHostilePage(dom.document);
    page.addWorkRow({});
    page.addWorkRow({});
    page.addEducationRow({});
    page.addLanguageRow({});
    page.addLanguageRow({});
});

describe('the CV the app produces is the CV the planner reads', () => {
    test('every section of it turns into work', () => {
        const { tasks } = planner.planStep(CV);
        const ids = tasks.map((t) => t.id);
        assert.ok(ids.some((i) => i.startsWith('work[product owner@acme]')), ids.join('\n'));
        assert.ok(ids.some((i) => i.startsWith('education[rmit]')));
        assert.ok(ids.some((i) => i.startsWith('languages[english]')));
        assert.ok(ids.includes('skills'));
    });

    test('a verbatim CV date becomes a month and a year', () => {
        const { tasks } = planner.planStep(CV);
        const from = (key) => tasks.find((t) => t.rowKey === key && t.field === 'formField-startDate');
        // "03/2021" and "Jan 2019" are both shapes the extractor is told to copy
        // exactly as the CV wrote them.
        assert.deepEqual(from('product owner@acme').want, { month: 3, year: 2021 });
        assert.deepEqual(from('business analyst@globex').want, { month: 1, year: 2019 });
    });

    test('"Hiện tại" is the tick, not a date', () => {
        const { tasks } = planner.planStep(CV);
        const acme = tasks.filter((t) => t.rowKey === 'product owner@acme');
        assert.ok(acme.some((t) => t.field === 'formField-currentlyWorkHere' && t.want === true));
        assert.equal(acme.filter((t) => t.field === 'formField-endDate').length, 0,
            'To leaves the DOM when the box is ticked — planning it would plan a field that will not exist');
    });

    test('education is read by `institution`, and its year is not asked for', () => {
        const { tasks } = planner.planStep(CV);
        const edu = tasks.filter((t) => t.section === 'education');
        assert.deepEqual(edu.map((t) => t.field),
            ['formField-schoolName', 'formField-degree']);
        assert.equal(edu[0].want, 'RMIT');
        // This tenant renders no Field of Study and no graduation year — asking
        // for them would be asking for fields that are not there.
        assert.ok(!edu.some((t) => /year|fieldOfStudy/i.test(t.field)));
    });

    test('two spellings of one language are one row', () => {
        const { tasks } = planner.planStep(CV);
        const langs = tasks.filter((t) => t.section === 'languages' && t.field === 'formField-language');
        // Four entries, two languages. "Tiếng Việt"/"Vietnamese" and
        // "English"/"English (IELTS 7.5)" are the pairs behind the form that
        // ended up with three Vietnamese rows under a red duplicate error.
        assert.equal(langs.length, 2);
        // And the name asked of the form is the LANGUAGE, never the certificate:
        // the employer's catalogue holds "English", not "English (IELTS 7.5)",
        // and holds "Vietnamese", not "Tiếng Việt".
        assert.deepEqual(langs.map((t) => t.want), ['English', 'Vietnamese']);
    });

    test('and the row that states a level is the one that carries it', () => {
        const { tasks } = planner.planStep(CV);
        const overall = tasks.filter((t) => t.section === 'languages' && t.name === 'Overall');
        // The first spelling wins the NAME; the entry that states a level wins
        // the level. Dropping it would leave a required field empty because the
        // CV happened to say it twice.
        assert.deepEqual(overall.map((t) => t.want), ['Fluent', 'Native']);
    });

    test('a description with several bullets goes in whole', () => {
        const { tasks } = planner.planStep(CV);
        const desc = tasks.find((t) => t.field === 'formField-roleDescription');
        assert.equal(desc.want, 'Owned the roadmap\nRan discovery');
    });

    test('an empty description asks for nothing rather than writing nothing', () => {
        const { tasks, gaps } = planner.planStep(CV);
        const globex = tasks.filter((t) => t.rowKey === 'business analyst@globex');
        assert.equal(globex.filter((t) => t.field === 'formField-roleDescription').length, 0);
        // Optional and absent is not a gap worth reporting; required and absent is.
        assert.ok(!gaps.some((g) => g.field === 'formField-roleDescription'));
    });

    test('a CV that names only a year is reported, never guessed into a month', () => {
        const yearOnly = { ...CV, experience: [{ ...CV.experience[0], start_date: '2021', end_date: '' }] };
        const { tasks, gaps } = planner.planStep(yearOnly);
        assert.equal(tasks.filter((t) => t.field === 'formField-startDate').length, 0);
        // Workday requires From on a work row, so this row will stay incomplete —
        // and that is the honest outcome. Inventing "January" would put a date on
        // an application that the CV never claimed.
        assert.ok(gaps.some((g) => g.field === 'formField-startDate'));
    });

    test('a CV with nothing in a section plans nothing for it', () => {
        const { tasks } = planner.planStep({ experience: [], education: [], languages: [], skills: [] });
        assert.deepEqual(tasks, []);
    });
});
