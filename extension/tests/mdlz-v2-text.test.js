// The one text normalizer, and the word-bag match built on it. `fold` used to
// be four inconsistent copies; `sameConcept` is the safe ceiling of an exact
// match — widened by the accidents a keyboard makes (case, spacing, punctuation,
// word order), and NEVER by a near-match, because a near-match on a closed
// taxonomy is a fabricated claim ("Marketing" must never become "Digital
// Marketing").

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { fold, foldTokens, sameConcept } from '../src/content-agent/mdlz-v2/text.js';

describe('fold — one canonical normalizer', () => {
    test('trims, lower-cases, and collapses every run of whitespace', () => {
        assert.equal(fold('  École   Polytechnique '), 'école polytechnique');
        assert.equal(fold('MARKETING'), 'marketing');
        assert.equal(fold('a\tb\nc'), 'a b c');
    });
    test('null and undefined fold to empty, never "null"', () => {
        assert.equal(fold(null), '');
        assert.equal(fold(undefined), '');
    });
});

describe('foldTokens — punctuation-blind, order-blind word bag', () => {
    test('the same words in any order share one key', () => {
        assert.equal(foldTokens('Management and Marketing'), foldTokens('Marketing and Management'));
        assert.equal(foldTokens('Computer Science'), foldTokens('Science Computer'));
    });
    test('"&" reads as the word "and"', () => {
        assert.equal(foldTokens('Marketing & Management'), foldTokens('Marketing and Management'));
    });
    test('punctuation is erased', () => {
        assert.equal(foldTokens('B.B.A.'), foldTokens('BBA'));
        assert.equal(foldTokens('Banking, Finance and Marketing'), foldTokens('Banking Finance and Marketing'));
    });
    test('a MULTISET, not a set — a repeated word is not dropped', () => {
        assert.notEqual(foldTokens('data data science'), foldTokens('data science'));
    });
    test('a different word content is a different key', () => {
        assert.notEqual(foldTokens('Marketing'), foldTokens('Digital Marketing'));
        assert.notEqual(foldTokens('Data Science'), foldTokens('Data Analytics'));
    });
});

describe('sameConcept — the safe ceiling of an exact match', () => {
    test('reordered / re-punctuated names ARE the same concept', () => {
        assert.equal(sameConcept('Management and Marketing', 'Marketing and Management'), true);
        assert.equal(sameConcept('Marketing & Management', 'Marketing and Management'), true);
        assert.equal(sameConcept('B.B.A.', 'BBA'), true);
        assert.equal(sameConcept('Marketing', 'marketing'), true);
    });
    test('a NARROWER or different major is NOT — it stays a gap, never a claim', () => {
        assert.equal(sameConcept('Marketing', 'Digital Marketing'), false);
        assert.equal(sameConcept('Marketing', 'Marketing Science'), false);
        assert.equal(sameConcept('Data Science', 'Data Analytics'), false);
    });
    test('empty on either side is never a match', () => {
        assert.equal(sameConcept('', 'Marketing'), false);
        assert.equal(sameConcept('Marketing', ''), false);
        assert.equal(sameConcept(null, undefined), false);
    });
});
