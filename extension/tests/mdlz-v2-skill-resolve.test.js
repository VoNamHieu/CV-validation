// resolveSkillToMdlz turns a CV skill into the term the widget should commit:
// the catalogue's own row wherever the catalogue has the skill (structured data
// beats free text), the candidate's verbatim create row where it does not, and
// a flag only when the endpoint offers neither. Position in the results gates
// NOTHING — an unrenderable row is committed by data (the fiber onSelect
// fallback, measured 4/4 on 2026-08-13), so the resolver is purely about
// QUALITY: which term, not whether it can be reached.
//
// The two safety rails these freeze: a dead endpoint keeps the CV's term (no
// regression), and a taxonomy guess is only trusted once skillsearch confirms
// the catalogue actually holds it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    resolveSkillToMdlz, resolveSkillWants, SKILL_TAXONOMY,
} from '../src/content-agent/mdlz-v2/skill-resolve.js';
import { readSkillsOnSelect } from '../src/content-agent/mdlz-v2/executors.js';

// fetchSkillOptions' shape: {label, id, index}. Catalog id ≠ label; create id = label.
const cat = (label, i) => ({ label, id: `REMOTE_SKILL-1-${i}`, index: i });
const create = (label, i) => ({ label, id: label, index: i });
const fold = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// A fake skillsearch: a table of folded-probe → rows. An absent probe answers
// null, exactly as the real fetcher does on a failed/aborted request.
const endpoint = (table) => async (probe) => {
    const rows = table[fold(probe)];
    return rows === undefined ? null : rows;
};

describe('resolveSkillToMdlz — one skill to the term the widget should commit', () => {
    test('the CV already wrote the catalogue word → direct, at the catalogue spelling', async () => {
        const fetchOptions = endpoint({ 'financial modeling': [cat('Financial Modeling', 0), cat('Investment Modeling', 1)] });
        const r = await resolveSkillToMdlz('financial modeling', { fetchOptions });
        assert.equal(r.status, 'ok');
        assert.equal(r.via, 'direct');
        assert.equal(r.canonical, 'Financial Modeling');   // the tenant's own casing
    });

    test('an exact catalog row counts WHEREVER skillsearch ranked it', async () => {
        // At index 2 — outside any painted window on a hidden tab. Irrelevant:
        // the engine commits it by data if the click cannot reach it.
        const rows = [cat('A', 0), cat('B', 1), cat('Cohort Analysis', 2)];
        const fetchOptions = endpoint({ 'cohort analysis': rows });
        const r = await resolveSkillToMdlz('cohort analysis', { fetchOptions });
        assert.equal(r.status, 'ok');
        assert.equal(r.via, 'direct');
        assert.equal(r.canonical, 'Cohort Analysis');
    });

    test('a CV phrasing maps through the taxonomy to a verified canonical skill', async () => {
        // "unit economics" is NOT a catalog skill; taxonomy → Customer Lifetime Value.
        const fetchOptions = endpoint({
            'unit economics': [cat('It Economics', 0), cat('Financial Economics', 1), create('unit economics', 15)],
            'customer lifetime value': [cat('Customer Lifetime Value', 0)],
        });
        const r = await resolveSkillToMdlz('unit economics', { fetchOptions });
        assert.equal(r.status, 'ok');
        assert.equal(r.via, 'taxonomy');
        assert.equal(r.canonical, 'Customer Lifetime Value');
    });

    test('an unconfirmed taxonomy guess falls through to the create row, never commits blind', async () => {
        // The map says "Pricing Strategies" but this tenant does not carry it —
        // the candidate's own words go on instead of a guessed catalogue term.
        const rawRows = Array.from({ length: 15 }, (_, i) => cat(`Pricing ${i}`, i));
        rawRows.push(create('pricing strategy', 15));
        const fetchOptions = endpoint({
            'pricing strategy': rawRows,
            'pricing strategies': [cat('Something Else', 0)],   // NOT an exact match
        });
        const r = await resolveSkillToMdlz('pricing strategy', { fetchOptions, taxonomy: { 'pricing strategy': ['Pricing Strategies'] } });
        assert.equal(r.status, 'ok');
        assert.equal(r.via, 'create');
        assert.equal(r.canonical, 'pricing strategy');
    });

    test('a genuinely custom skill goes on verbatim via its create row — tail position and all', async () => {
        const rows = Array.from({ length: 15 }, (_, i) => cat(`Neg ${i}`, i));
        rows.push(create('negotiation copo', 15));          // create row LAST = position 16
        const fetchOptions = endpoint({ 'negotiation copo': rows });
        const r = await resolveSkillToMdlz('Negotiation Copo', { fetchOptions });
        assert.equal(r.status, 'ok');
        assert.equal(r.via, 'create');
        assert.equal(r.canonical, 'Negotiation Copo');
    });

    test('neither an exact row nor a create row → flag, not a blind commit', async () => {
        // Defensive: skillsearch normally always appends a create row, but if it
        // does not, nothing in the answer matches the term and none of it is safe.
        const fetchOptions = endpoint({ 'ghost skill': [cat('Unrelated', 0), cat('Also Unrelated', 1)] });
        const r = await resolveSkillToMdlz('ghost skill', { fetchOptions });
        assert.equal(r.status, 'flag');
        assert.match(r.reason, /no exact catalog row and no create row/);
    });

    test('a dead endpoint keeps the CV term (no regression) rather than flagging', async () => {
        const fetchOptions = async () => null;               // every request fails
        const r = await resolveSkillToMdlz('Anything', { fetchOptions });
        assert.equal(r.status, 'ok');
        assert.equal(r.via, 'unresolved');
        assert.equal(r.canonical, 'Anything');
    });

    test('empty / missing fetcher are handled, not thrown', async () => {
        assert.equal((await resolveSkillToMdlz('   ', { fetchOptions: async () => null })).status, 'empty');
        assert.equal((await resolveSkillToMdlz('x', {})).status, 'flag');
    });
});

describe('resolveSkillWants — a whole list, merged and de-flagged', () => {
    test('two phrasings that resolve to one catalogue skill make ONE chip', async () => {
        const fetchOptions = endpoint({
            'unit economics': [cat('It Economics', 0), create('unit economics', 15)],
            'ltv': [cat('Ltv Modeling', 0), create('ltv', 9)],
            'customer lifetime value': [cat('Customer Lifetime Value', 0)],
        });
        const taxonomy = { 'unit economics': ['Customer Lifetime Value'], 'ltv': ['Customer Lifetime Value'] };
        const out = await resolveSkillWants(['unit economics', 'LTV'], { fetchOptions, taxonomy });
        assert.deepEqual(out.want, ['Customer Lifetime Value'], 'the duplicate canonical collapses to one');
        assert.deepEqual(out.flagged, []);
        assert.equal(out.oracleReached, true);
    });

    test('a custom term rides along as itself; only a term with NO answer is flagged', async () => {
        const tail = Array.from({ length: 15 }, (_, i) => cat(`x${i}`, i)).concat(create('made up skill', 15));
        const fetchOptions = endpoint({
            'financial analysis': [cat('Financial Analysis', 0)],
            'made up skill': tail,                                    // custom → goes on verbatim
            'ghost skill': [cat('Unrelated', 0)],                      // no create row → flagged
        });
        const out = await resolveSkillWants(['financial analysis', 'made up skill', 'ghost skill'], { fetchOptions });
        assert.deepEqual(out.want, ['Financial Analysis', 'made up skill']);
        assert.deepEqual(out.flagged, ['ghost skill']);
    });

    test('a network blip anywhere marks oracleReached false (so the caller will not cache it)', async () => {
        const fetchOptions = endpoint({ 'financial analysis': [cat('Financial Analysis', 0)] }); // "other" is absent → null
        const out = await resolveSkillWants(['financial analysis', 'other'], { fetchOptions });
        assert.equal(out.oracleReached, false);
        assert.ok(out.want.includes('Financial Analysis'));
        assert.ok(out.want.includes('other'), 'the unresolved term is kept, not dropped');
    });
});

describe('the seeded taxonomy carries what we verified live', () => {
    test('unit economics resolves toward Customer Lifetime Value', () => {
        assert.ok(SKILL_TAXONOMY['unit economics'].includes('Customer Lifetime Value'));
    });
    test('the known spelling mismatches are seeded', () => {
        assert.deepEqual(SKILL_TAXONOMY['pricing strategy'], ['Pricing Strategies']);
        assert.deepEqual(SKILL_TAXONOMY['lifetime value'], ['Customer Lifetime Value']);
        assert.deepEqual(SKILL_TAXONOMY['agentic system'], ['Agentic AI']);
    });
});

// The data-write fallback's fiber read. The live shape (measured 2026-08-13):
// props with onSelect(fn) + values[] sit a dozen levels above the search input.
describe('readSkillsOnSelect finds the multiselect commit handler on the fiber', () => {
    const chain = (levels) => {
        // levels: array of memoizedProps, innermost first; returns the innermost el
        let parent = null;
        for (let i = levels.length - 1; i >= 0; i--) parent = { memoizedProps: levels[i], return: parent };
        const el = {};
        el['__reactFiber$test'] = parent;
        return el;
    };

    test('walks up to the level that carries onSelect + values', () => {
        const onSelect = () => {};
        const el = chain([{ onSelect, values: [{ label: 'SQL', id: 'R-1' }] }, { foo: 1 }, { bar: 2 }]);
        const p = readSkillsOnSelect(el);
        assert.ok(p);
        assert.equal(p.onSelect, onSelect);
        assert.equal(p.values.length, 1);
    });

    test('onSelect without a values array does not count', () => {
        const el = chain([{ onSelect: () => {} }, { values: 'not-an-array', onSelect: () => {} }]);
        assert.equal(readSkillsOnSelect(el), null);
    });

    test('no fiber (the harness) → null, and the fallback stays off', () => {
        assert.equal(readSkillsOnSelect({}), null);
        assert.equal(readSkillsOnSelect(null), null);
    });
});
