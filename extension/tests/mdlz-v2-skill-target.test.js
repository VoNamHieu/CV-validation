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

import { chooseSkillTarget } from '../src/content-agent/mdlz-v2/executors.js';

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
