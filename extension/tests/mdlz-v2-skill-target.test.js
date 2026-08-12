// The discriminator a PARTIAL skills read leans on.
//
// The settle loop waits for the widget's item array to reach the count the
// header declared, but a slow server can leave it short at the deadline — and
// the create row is LAST, so a short array holds neither it nor a catalog row
// that sits below the window. pickAcrossList must then tell the ONE answer a
// longer list cannot overturn (an exact hit) from the two it can (a near-match
// the exact row would beat; a create row the catalog would), and it reads that
// off `match`. This suite freezes what `match` means, because the guard that
// keeps a partial read from being cached as OPTION_NOT_FOUND is built on it.
//
// The measured incident: itemsLen 4 / declared 16 returned OPTION_NOT_FOUND,
// which is in SEMANTIC, so the refusal cache froze Skills for the whole page —
// a wrong verdict that a slow network could reproduce at random.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { chooseSkillTarget, readVirtualItems } from '../src/content-agent/mdlz-v2/executors.js';

// A catalog row carries the tenant's own id; the create row's id IS its label.
const cat = (label, n = 1) => ({ label, id: `REMOTE_SKILL-1-${n}`, index: n });
const make = (label, index) => ({ label, id: label, index });   // the create row

describe('chooseSkillTarget marks how far a partial list may be trusted', () => {
    test('an exact catalog hit is the one answer safe on a short list', () => {
        const c = chooseSkillTarget([cat('Figma')], 'Figma');
        assert.equal(c.kind, 'catalog');
        assert.equal(c.match, 'exact');
    });

    test('a single near-match is a catalog answer, but marked near — not exact', () => {
        const c = chooseSkillTarget([cat('Agile/Scrum')], 'Agile');
        assert.equal(c.kind, 'catalog');
        assert.equal(c.match, 'near', 'a near hit must be distinguishable so a short list refuses it');
    });

    test('the create row is free text, marked create', () => {
        const c = chooseSkillTarget([make('retention optimization', 0)], 'retention optimization');
        assert.equal(c.kind, 'free');
        assert.equal(c.match, 'create');
    });

    test('an exact catalog row beats a create row of the same text', () => {
        // Both rows read "SQL"; only the id tells them apart, and structured data
        // wins. The exact mark is what lets this commit even before the list ends.
        const c = chooseSkillTarget([cat('SQL', 3), make('SQL', 9)], 'SQL');
        assert.equal(c.kind, 'catalog');
        assert.equal(c.match, 'exact');
    });

    test('nothing that holds the term is a none with no match to trust', () => {
        const c = chooseSkillTarget([cat('Figma')], 'Rust');
        assert.equal(c.kind, 'none');
        assert.equal(c.match, undefined, 'a none carries no match — a short list retries rather than refusing');
    });
});

// The reason the Skills fast-path was dead: readVirtualItems handed back null on
// the live widget, so every term fell to the scroll-walk that reaches ~11/16 and
// OPEN_TIMEOUT-retried a below-fold row for three passes. Probed 2026-08-13: the
// item array sits at props.items (len 31) and its rows carry `ariaLabel`, not
// `label` — which the matcher used to reject. These freeze that it reads both.
const fiberEl = (items) => {
    const el = {};
    el['__reactFiber$xyz'] = { return: null, alternate: null, memoizedProps: { items }, memoizedState: null };
    return el;
};
const rows = (key, n = 5) => Array.from({ length: n }, (_, i) => ({ [key]: `Skill ${i}`, id: `REMOTE_SKILL-${i}` }));

describe('readVirtualItems finds the item array whether its rows carry label or ariaLabel', () => {
    test('rows exposing their text as ariaLabel are found — the live Skills shape', () => {
        const items = rows('ariaLabel');                 // no `label` key at all
        const got = readVirtualItems(fiberEl(items));
        assert.equal(got, items, 'the fiber read must not go null just because the rows use ariaLabel');
    });

    test('rows that carry label are still found', () => {
        const items = rows('label');
        assert.equal(readVirtualItems(fiberEl(items)), items);
    });

    test('an array of the wrong shape is not mistaken for the item list', () => {
        const notItems = [{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }, { x: 5 }];
        assert.equal(readVirtualItems(fiberEl(notItems)), null);
    });

    test('no react fiber → null, and the scroll-walk takes over', () => {
        assert.equal(readVirtualItems({}), null);
    });
});
