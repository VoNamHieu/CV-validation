// Why a form ended up with three "Vietnamese" rows and a red
// "Duplicate language entries are not allowed."
//
// Two independent defects met. The grow loop read its work list ONCE and never
// recomputed it, while the planner that built that list skipped empty rows
// entirely — so a blank row already on the page counted for nothing and a CV
// with a single language kept clicking "Add" until it hit the three-row cap.
// Those spare blanks were then somewhere to put a language, and each concurrent
// pass put the same one in a different row.
//
// The grow loop needs a DOM to test; this covers the half that does not — the
// list of languages the section is grown FOR. If two entries in it are the same
// language, no amount of correct row arithmetic saves the step.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeLanguages } from '../src/content-agent/recipe.js';

const names = (out) => out.map(l => l.language);

describe('one row per language, whatever the CV called it', () => {
    test('the two spellings of Vietnamese are one language', () => {
        // The exact shape behind the screenshot: a CV section naming its mother
        // tongue twice, so the VN-market rule normalised one and the other rode
        // through into a row of its own.
        const out = dedupeLanguages([
            { language: 'Vietnamese', level: 'Native' },
            { language: 'Tiếng Việt', level: 'Native' },
        ]);
        assert.equal(out.length, 1);
        assert.deepEqual(names(out), ['Vietnamese']);
    });

    test('a certificate score does not earn a second row', () => {
        const out = dedupeLanguages([
            { language: 'English' },
            { language: 'English (IELTS 7.5)', level: 'Fluent' },
        ]);
        assert.equal(out.length, 1);
        // The entry that states a level is the one worth keeping — the other
        // says nothing the form can use.
        assert.equal(out[0].level, 'Fluent');
    });

    test('a dashed qualification folds onto the bare name too', () => {
        const out = dedupeLanguages([
            { language: 'Japanese', level: 'Intermediate' },
            { language: 'Japanese - JLPT N3' },
        ]);
        assert.equal(out.length, 1);
        assert.equal(out[0].level, 'Intermediate');
    });

    test('genuinely different languages all survive', () => {
        const out = dedupeLanguages([
            { language: 'Vietnamese', level: 'Native' },
            { language: 'English', level: 'Advanced' },
            { language: 'Japanese', level: 'Intermediate' },
        ]);
        assert.deepEqual(names(out), ['Vietnamese', 'English', 'Japanese']);
    });

    test('order is the CV\'s — the first mention keeps its place', () => {
        const out = dedupeLanguages([
            { language: 'English', level: 'Advanced' },
            { language: 'Vietnamese', level: 'Native' },
            { language: 'Tiếng Việt' },
        ]);
        assert.deepEqual(names(out), ['English', 'Vietnamese']);
    });

    test('a level found on the LATER duplicate is not lost', () => {
        const out = dedupeLanguages([
            { language: 'Vietnamese' },
            { language: 'Tiếng Việt', level: 'Native' },
        ]);
        assert.equal(out.length, 1);
        assert.equal(out[0].level, 'Native');
    });

    test('nameless and empty entries are dropped, not turned into blank rows', () => {
        // A blank row is a required Language* nobody can answer — it stops the
        // step exactly as a duplicate does.
        assert.deepEqual(dedupeLanguages([{ language: '' }, { language: '   ' }, {}]), []);
        assert.deepEqual(dedupeLanguages([]), []);
        assert.deepEqual(dedupeLanguages(null), []);
    });
});
