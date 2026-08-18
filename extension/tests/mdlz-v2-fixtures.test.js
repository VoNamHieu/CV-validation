// v2 replayed against the measured corpus.
//
// The corpus rule, from tests/fixtures/workday/README.md: "a capability version
// is promoted to a pinned tenant only after replaying that tenant's fixtures
// green", and "changing a fixture to make a test pass is the one forbidden
// move". v2 has been proven against a harness built from measurements, which is
// a good way to be right about what was measured and no way to be right about
// what was not — so before it is offered a live page, the lists a real tenant
// really served get to judge it.
//
// Two properties are on trial here:
//
//   · THE NO-FALSE-CLAIM RULE. A term the catalogue does not hold must resolve
//     to nothing. "retention optimization" becoming "Retention Strategies" is
//     not a near miss; it is a skill on a submitted application that its owner
//     never claimed.
//   · THE FINGERPRINT AGREES WITH WHAT WAS OBSERVED. Each fixture records the
//     widget family the tenant actually rendered, derived from its `shape`. v2
//     resolves capability from shape at runtime, so the two must land on the
//     same family — and if they ever stop agreeing, the tenant changed.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installDom } from './harness/mini-dom.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'workday');

/** An option row as the chooser sees one: something with text. */
const node = (label) => ({ textContent: label, getAttribute: () => null, closest: () => null, offsetParent: {} });

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

let dom;
let chooseOption;
let kindOf;
let WIDGET;

before(async () => {
    console.log = () => { };
    dom = installDom();
    ({ chooseOption } = await import('../src/content-agent/mdlz-v2/executors.js'));
    ({ kindOf, WIDGET } = await import('../src/content-agent/mdlz-v2/fingerprint.js'));
});

after(() => dom?.uninstall());

// ── the no-false-claim rule, on lists a tenant really served ─────────────

describe('mdlz Skills: v2 refuses every term the catalogue does not hold', () => {
    const fx = fixtures.find((f) => f.file === 'mdlz/skills-search.json');
    for (const q of fx.measured.queries) {
        test(`"${q.term}" over [${q.results.slice(0, 3).join(', ')}…] → ${q.expect === null ? 'no claim' : q.expect}`, () => {
            const got = chooseOption(q.results.map(node), q.term);
            if (q.expect === null) {
                assert.equal(got.option, null,
                    `v2 would have claimed "${got.matched}" — ${q.note || 'the catalogue does not hold this term'}`);
            } else {
                assert.equal(got.matched, q.expect);
            }
        });
    }
});

describe('the source cascades: a category can be named, a rung cannot name it', () => {
    const mdlz = fixtures.find((f) => f.file === 'mdlz/source-hierarchical.json');
    for (const [wanted, expected] of Object.entries(mdlz.measured.expectAtLevel1)) {
        test(`mdlz level-1 "${wanted}" → "${expected}"`, () => {
            const got = chooseOption(mdlz.measured.level1.labels.map(node), wanted);
            assert.equal(got.matched, expected);
        });
    }

    const pwc = fixtures.find((f) => f.file === 'pwc/source-hierarchical.json');
    for (const [wanted, expected] of Object.entries(pwc.measured.expectAtLevel0)) {
        test(`pwc level-0 "${wanted}" → ${expected === null ? 'nothing' : `"${expected}"`}`, () => {
            const got = chooseOption(pwc.measured.level0.labels.map(node), wanted);
            if (expected === null) assert.equal(got.option, null);
            else assert.equal(got.matched, expected);
        });
    }

    test('every measured leaf under Website is reachable by its own text', () => {
        const leaves = pwc.measured.level1UnderWebsite.labels;
        for (const leaf of leaves) {
            assert.equal(chooseOption(leaves.map(node), leaf.toLowerCase()).matched, leaf);
        }
    });
});

// ── the fingerprint against what was observed ────────────────────────────

/**
 * A wrapper built from a fixture's `shape` — the observed DOM signals, and
 * nothing invented beside them.
 *
 * Only signals that change what the widget IS are rendered. `virtualized`,
 * `optionCheckbox` and `clipRectDegenerate` describe how it BEHAVES once open,
 * which is the harness's job, not the classifier's.
 */
function wrapperFromShape(shape) {
    const doc = dom.document;
    const wrap = doc.createElement('div');
    wrap.setAttribute('data-automation-id', 'formField-fromFixture');
    doc.body.appendChild(wrap);
    if (shape.selectedItemChips) {
        wrap.appendChild(doc.createElement('div')).setAttribute('data-automation-id', 'selectedItemList');
    }
    if (shape.textInput) {
        const input = doc.createElement('input');
        input.setAttribute('type', 'text');
        wrap.appendChild(input);
    }
    if ((shape.nestedMenu || shape.leafNodes) && !shape.textInput) {
        const button = doc.createElement('button');
        button.setAttribute('aria-haspopup', 'listbox');
        wrap.appendChild(button);
    }
    return wrap;
}

/** The fixture's observed family, in the vocabulary the classifier answers in. */
const FAMILY = {
    'searchable-multi': () => WIDGET.SEARCH_MULTI,
    'hierarchical-listbox': () => WIDGET.LISTBOX,
};

describe('what v2 sees agrees with what the tenant was observed to render', () => {
    for (const fx of fixtures) {
        test(`${fx.file}: shape → ${fx.capability}`, () => {
            const expected = FAMILY[fx.capability];
            assert.ok(expected, `no v2 family recorded for capability "${fx.capability}" (${fx.file})`);
            const kind = kindOf(wrapperFromShape(fx.shape));
            assert.equal(kind, expected(),
                `${fx.file} was measured as ${fx.capability}; v2 reads its shape as ${kind}`);
        });
    }

    test('capability is read from the shape, never from the field name', () => {
        // The same label, two tenants, two widgets — the corpus holds this pair
        // precisely so the shortcut "this intent → this capability" cannot be
        // defended. Both source fixtures carry one label and one intent.
        const both = fixtures.filter((f) => f.intent === 'application.source');
        assert.equal(both.length, 2);
        assert.equal(new Set(both.map((f) => f.field.toLowerCase())).size, 1, 'one label');
        // They agree here, and they are allowed not to: what must never happen
        // is the classifier reading the LABEL to decide.
        const kinds = both.map((f) => kindOf(wrapperFromShape(f.shape)));
        for (const k of kinds) assert.equal(k, WIDGET.LISTBOX);
    });
});

// ── what the corpus does not cover, said out loud ────────────────────────
//
// A search prompt with NO chip list and no aria-haspopup — PwC renders a filter
// box over its cascade — looks exactly like a text field until something is
// typed into it, and v2 would classify it TEXT. No fixture records whether that
// widget carries aria-haspopup, so there is nothing here to test against: it is
// named as an open question rather than answered by a test that would only be
// asserting my own guess. It does not touch the step v2 owns (My Experience has
// no source field), and the failure it would produce is honest — a value that
// never commits, reported as COMMIT_FAILED.
