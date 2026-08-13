// resolveSkillToMdlz turns a CV skill into a term the hidden Skills widget can
// actually commit: an exact catalog row that lands in the PAINTABLE top window
// (index 0-1), or nothing. The rule exists because a free-text "create" row sits
// LAST and never paints while hidden — the whole "Skills hung at position 16".
//
// These freeze the four verdicts (direct / taxonomy / create-safe / flag) and
// the two safety rails: a dead endpoint keeps the CV's term (no regression), and
// a canonical spelling is only trusted once skillsearch confirms it at the top.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    resolveSkillToMdlz, resolveSkillWants, SKILL_TAXONOMY, RENDER_SAFE,
} from '../src/content-agent/mdlz-v2/skill-resolve.js';

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

describe('resolveSkillToMdlz — one skill to a hidden-safe MDLZ term', () => {
    test('the CV already wrote the catalogue word → direct, at the catalogue spelling', async () => {
        const fetchOptions = endpoint({ 'financial modeling': [cat('Financial Modeling', 0), cat('Investment Modeling', 1)] });
        const r = await resolveSkillToMdlz('financial modeling', { fetchOptions });
        assert.equal(r.status, 'ok');
        assert.equal(r.via, 'direct');
        assert.equal(r.canonical, 'Financial Modeling');   // the tenant's own casing
    });

    test('an exact catalog row at index 1 still counts (top window is 0..RENDER_SAFE)', async () => {
        assert.equal(RENDER_SAFE, 1);
        const fetchOptions = endpoint({ 'cohort analysis': [cat('Chart Analysis', 0), cat('Cohort Analysis', 1)] });
        const r = await resolveSkillToMdlz('cohort analysis', { fetchOptions });
        assert.equal(r.via, 'direct');
        assert.equal(r.canonical, 'Cohort Analysis');
    });

    test('an exact catalog row PAST the paintable window is not trusted', async () => {
        // "Cohort Analysis" exists but at index 2 — a hidden tab may never paint it.
        const rows = [cat('A', 0), cat('B', 1), cat('Cohort Analysis', 2)];
        const fetchOptions = endpoint({ 'cohort analysis': rows });
        const r = await resolveSkillToMdlz('cohort analysis', { fetchOptions });
        assert.equal(r.status, 'flag', 'a below-fold catalog match is unreachable, so flag not commit');
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

    test('a taxonomy guess is only used if skillsearch confirms it at the top', async () => {
        // The map says "Pricing Strategies" but this tenant does not carry it at the
        // top; and the raw term's own create row is at the tail (long match list).
        const rawRows = Array.from({ length: 15 }, (_, i) => cat(`Pricing ${i}`, i));
        rawRows.push(create('pricing strategy', 15));
        const fetchOptions = endpoint({
            'pricing strategy': rawRows,
            'pricing strategies': [cat('Something Else', 0)],   // NOT an exact top match
        });
        const r = await resolveSkillToMdlz('pricing strategy', { fetchOptions, taxonomy: { 'pricing strategy': ['Pricing Strategies'] } });
        assert.equal(r.status, 'flag', 'an unconfirmed canonical guess must self-reject, never commit blind');
    });

    test('a genuinely custom skill that is the SOLE result is safe as free text', async () => {
        // Nothing in the catalogue matched → the create row is index 0 → it paints.
        const fetchOptions = endpoint({ 'copo widget zzz': [create('Copo Widget Zzz', 0)] });
        const r = await resolveSkillToMdlz('Copo Widget Zzz', { fetchOptions });
        assert.equal(r.status, 'ok');
        assert.equal(r.via, 'create-safe');
        assert.equal(r.canonical, 'Copo Widget Zzz');
    });

    test('a custom skill whose create row is at the tail is flagged, never minted', async () => {
        const rows = Array.from({ length: 15 }, (_, i) => cat(`Neg ${i}`, i));
        rows.push(create('negotiation copo', 15));          // create row LAST → position 16
        const fetchOptions = endpoint({ 'negotiation copo': rows });
        const r = await resolveSkillToMdlz('Negotiation Copo', { fetchOptions });
        assert.equal(r.status, 'flag');
        assert.match(r.reason, /paintable window/);
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

    test('flagged skills are dropped from want and reported', async () => {
        const tail = Array.from({ length: 15 }, (_, i) => cat(`x${i}`, i)).concat(create('made up skill', 15));
        const fetchOptions = endpoint({
            'financial analysis': [cat('Financial Analysis', 0)],
            'made up skill': tail,
        });
        const out = await resolveSkillWants(['financial analysis', 'made up skill'], { fetchOptions });
        assert.deepEqual(out.want, ['Financial Analysis']);
        assert.deepEqual(out.flagged, ['made up skill']);
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
    });
});
