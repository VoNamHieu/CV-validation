// A salary answer depends on the BOX that has to hold it.
//
// Measured on PwC Corporate Tax (2026-08-07): "Negotiable" written into
// "What are your salary expectations (gross) in VND?*" stood a validation
// error through sixteen passes while recovery cleared and rewrote the same
// impossible value. The reshaper decides between verbatim text, digits, a
// currency conversion, and stepping aside as a named gap.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reshapeMoneyValue } from '../src/content-agent/recipe.js';

describe('free-text salary boxes take the profile value verbatim', () => {
    test('"Negotiable" stays for a text box', () => {
        assert.equal(reshapeMoneyValue('Negotiable', {}), 'Negotiable');
    });
    test('"2000 USD" stays for a text box', () => {
        assert.equal(reshapeMoneyValue('2000 USD', {}), '2000 USD');
    });
});

describe('numeric boxes take digits or nothing', () => {
    test('"Negotiable" into a numeric box is a named gap, not a write', () => {
        assert.equal(reshapeMoneyValue('Negotiable', { numericBox: true }), '');
    });
    test('"2000 USD" into a numeric non-VND box is the bare number', () => {
        assert.equal(reshapeMoneyValue('2000 USD', { numericBox: true }), '2000');
    });
    test('grouped digits are flattened', () => {
        assert.equal(reshapeMoneyValue('52,000,000', { numericBox: true }), '52000000');
    });
});

describe('a VND-labelled box converts a USD expectation', () => {
    test('the measured case: $2000 into the PwC gross-VND box', () => {
        assert.equal(reshapeMoneyValue('2000 USD', { numericBox: true, vndLabel: true }), '52000000');
    });
    test('"$2000" spelled with the sign converts the same', () => {
        assert.equal(reshapeMoneyValue('$2000', { vndLabel: true }), '52000000');
    });
    test('an already-VND number is not converted again', () => {
        assert.equal(reshapeMoneyValue('52000000', { numericBox: true, vndLabel: true }), '52000000');
    });
    test('the VN shorthand "52tr" expands to VND', () => {
        assert.equal(reshapeMoneyValue('52tr', { numericBox: true, vndLabel: true }), '52000000');
    });
});
