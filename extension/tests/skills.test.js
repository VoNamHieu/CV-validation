// Choosing a skill from an employer's search results.
//
// This is the only part of the Skills field that can put a CLAIM on a real
// application. The taxonomy belongs to the employer, not the candidate: typing
// "SQL" can return SQL, SQL Server, MySQL and PL/SQL, and three of those are
// things the candidate never said. Dropping a skill costs them a line on a form;
// picking the wrong one puts words in their mouth.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { pickSearchResult } from '../src/content-agent/recipe.js';

const pick = (results, term) => pickSearchResult(results, term);

describe('an exact label always wins', () => {
    test('even when longer labels also contain the term', () => {
        assert.equal(pick(['SQL Server', 'SQL', 'MySQL', 'PL/SQL'], 'SQL'), 'SQL');
    });

    test('case and surrounding space do not matter', () => {
        assert.equal(pick(['  Product Management  '], 'product management'), '  Product Management  ');
    });
});

describe('a partial match counts only when it is unambiguous', () => {
    test('one distinct label containing the term is accepted', () => {
        // The employer names it slightly differently and there is only one
        // candidate — taking it is the whole point of a search field.
        assert.equal(pick(['Agile Methodologies'], 'Agile'), 'Agile Methodologies');
    });

    test('the same label repeated is still one answer', () => {
        // Workday renders a row as several nested nodes, so duplicates are normal
        // and must not read as ambiguity.
        assert.equal(pick(['Figma', 'Figma', 'Figma'], 'Figma'), 'Figma');
    });

    test('several DIFFERENT labels resolve to nothing', () => {
        // "SQL Server" and "MySQL" both contain it, and neither is what was
        // written. Guessing here is how an application acquires a skill its owner
        // never claimed.
        assert.equal(pick(['SQL Server', 'MySQL', 'PL/SQL'], 'SQL'), null);
    });
});

describe('nothing is invented', () => {
    test('no results means no skill', () => {
        assert.equal(pick([], 'Figma'), null);
        assert.equal(pick(null, 'Figma'), null);
    });

    test('a taxonomy that simply lacks the skill drops it', () => {
        // Measured reality: an employer list may not contain "Figma" at all. The
        // nearest-looking entry is not a substitute.
        assert.equal(pick(['Photoshop', 'Illustrator', 'Sketch'], 'Figma'), null);
    });

    test('an empty term never matches anything', () => {
        // A blank between two commas ("SQL,,Figma") must not select the first row.
        assert.equal(pick(['SQL', 'Figma'], ''), null);
        assert.equal(pick(['SQL', 'Figma'], '   '), null);
    });
});

describe('it reads whatever the caller says the label is', () => {
    test('works on objects, not just strings', () => {
        // The live path passes DOM nodes and reads textContent; the rule itself
        // must not care.
        const rows = [{ t: 'Scrum' }, { t: 'Scrum Master' }];
        assert.deepEqual(pickSearchResult(rows, 'Scrum', r => r.t), rows[0]);
    });
});
