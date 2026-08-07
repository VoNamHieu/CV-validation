// The fixture corpus, run against the live matchers.
//
// Every list in tests/fixtures/workday/ was served by a real tenant on a real
// run, and every expectation is the answer that run proved correct. What this
// suite freezes is the agent's most consequential property: a value the
// catalogue does not hold resolves to NOTHING — never to a fuzzy neighbour.
// "retention optimization" becoming "Retention Strategies" is not a near miss,
// it is a wrong claim on a submitted application.
//
// Changing a fixture to make a test pass is the forbidden move. Fixtures
// change only when a new live measurement says the TENANT changed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    optionMatchAll, optionUniqueMatch, pickSearchResult, skillFallbacks,
} from '../src/content-agent/recipe.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'workday');

/** A rendered option row, as the matcher sees one: text + a real box. */
const node = (label) => ({
    textContent: label,
    getBoundingClientRect: () => ({ width: 120, height: 24 }),
});

function loadFixtures() {
    const out = [];
    for (const tenant of readdirSync(ROOT)) {
        const dir = join(ROOT, tenant);
        if (!statSync(dir).isDirectory()) continue;
        for (const f of readdirSync(dir)) {
            if (!f.endsWith('.json')) continue;
            out.push({ tenant, file: `${tenant}/${f}`, ...JSON.parse(readFileSync(join(dir, f), 'utf8')) });
        }
    }
    return out;
}

const fixtures = loadFixtures();

describe('the corpus itself is well-formed', () => {
    test('at least the three seed fixtures are present', () => {
        assert.ok(fixtures.length >= 3, `found ${fixtures.length}`);
    });
    for (const fx of fixtures) {
        test(`${fx.file} carries identity, intent, capability, commit signal and provenance`, () => {
            for (const k of ['tenant', 'field', 'intent', 'capability', 'commitSignal', 'shape', 'measured', 'source']) {
                assert.ok(fx[k], `${fx.file} is missing "${k}"`);
            }
            // A fixture without provenance is an invented fixture.
            assert.match(fx.source, /trace|run|HAR/i);
        });
    }
});

describe('mdlz Skills: search results that do not hold the term resolve to nothing', () => {
    const fx = fixtures.find(f => f.file === 'mdlz/skills-search.json');
    for (const q of fx.measured.queries) {
        test(`"${q.term}" over [${q.results.slice(0, 3).join(', ')}…] → ${q.expect === null ? 'no claim' : q.expect}`, () => {
            assert.equal(pickSearchResult(q.results, q.term), q.expect);
        });
    }
    test('the compound term decomposes to its real parts for the fallback pass', () => {
        const alts = skillFallbacks('Agile/Scrum').map(s => s.toLowerCase());
        assert.ok(alts.includes('agile'), `fallbacks were: ${alts.join(', ')}`);
        assert.ok(alts.includes('scrum'), `fallbacks were: ${alts.join(', ')}`);
    });
});

describe('PwC source cascade: ladder rungs cannot name a category, the category name can', () => {
    const fx = fixtures.find(f => f.file === 'pwc/source-hierarchical.json');
    const l0 = fx.measured.level0.labels.map(node);
    for (const [wanted, expected] of Object.entries(fx.measured.expectAtLevel0)) {
        test(`level-0 "${wanted}" → ${expected === null ? 'nothing' : `"${expected}"`}`, () => {
            const hit = optionUniqueMatch(l0, wanted);
            if (expected === null) assert.equal(hit, null);
            else assert.equal(hit?.textContent, expected);
        });
    }
    test('every measured level-1 leaf is reachable by its exact text', () => {
        const l1 = fx.measured.level1UnderWebsite.labels.map(node);
        for (const leaf of fx.measured.level1UnderWebsite.labels) {
            assert.equal(optionUniqueMatch(l1, leaf.toLowerCase())?.textContent, leaf);
        }
    });
});

describe('mdlz source cascade: the same label, a different widget, a directly nameable leaf', () => {
    const fx = fixtures.find(f => f.file === 'mdlz/source-hierarchical.json');
    const l1 = fx.measured.level1.labels.map(node);
    for (const [wanted, expected] of Object.entries(fx.measured.expectAtLevel1)) {
        test(`level-1 "${wanted}" → "${expected}"`, () => {
            assert.equal(optionUniqueMatch(l1, wanted)?.textContent, expected);
        });
    }
});

describe('the duplicate-node ordering the lift must preserve', () => {
    test('a zero-size twin loses to the rendered node carrying the same text', () => {
        // Workday keeps dead twins of "Company Website" in the document; the
        // matcher returns rendered-first so the caller's try-in-order starts
        // with the one a human could click. Measured on this exact field.
        const dead = { textContent: 'Company Website', getBoundingClientRect: () => ({ width: 0, height: 0 }) };
        const live = node('Company Website');
        const all = optionMatchAll([dead, live], 'company website');
        assert.equal(all.length, 2);
        assert.equal(all[0], live);
    });
    test('an ambiguous substring stays ambiguous even when only one twin is rendered', () => {
        // Rendering does not disambiguate MEANING: two different labels that
        // both contain the term answer nothing, whatever their boxes say.
        const rows = [node('Website'), { textContent: 'Company Website', getBoundingClientRect: () => ({ width: 0, height: 0 }) }];
        assert.equal(optionUniqueMatch(rows, 'website'), rows[0], 'exact text still wins outright');
        assert.equal(optionUniqueMatch(rows.slice(1).concat(node('Another Website')), 'website'), null);
    });
});
