// Which live-region announcements count as validation errors.
//
// `role="alert"` is a transport, not a verdict: it is how a page tells a screen
// reader that something urgent happened, and on a Workday job page that is
// "Sales Specialist page is loaded". Reporting it as a validation error is not
// cosmetic — the error list is shipped to the planner every iteration as
// evidence the form is failing, and it is what the agent shows the user as the
// reason it gave up.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isLikelyValidationError } from '../src/content-agent/observe.js';

describe('page-status announcements are not errors', () => {
    for (const t of [
        'Sales Specialist page is loaded',          // the one from the live log
        'Page loaded',
        'Loading results',
        '25 results found',
        'Your draft has been saved',
        'Đã tải trang',
    ]) {
        test(`ignored: "${t}"`, () => {
            assert.equal(isLikelyValidationError(t), false);
        });
    }

    test('a status announcement is ignored even inside a field wrapper', () => {
        // The wrapper normally buys trust, but "saved" is never a validation
        // failure and some frameworks reuse one live region for both.
        assert.equal(isLikelyValidationError('Saved', { inFieldWrapper: true }), false);
    });
});

describe('real validation messages are kept', () => {
    for (const t of [
        'This field is required',
        'Please enter a valid email address',
        'Password must be at least 8 characters',
        'Error: postal code is invalid',
        'Vui lòng nhập số điện thoại',
        'Trường này là bắt buộc',
        'Giá trị không hợp lệ',
    ]) {
        test(`kept: "${t}"`, () => {
            assert.equal(isLikelyValidationError(t), true);
        });
    }

    test('a field wrapper is trusted without matching the vocabulary', () => {
        // A field's own error node can word things unpredictably ("Select One"),
        // and its position already says what it is.
        assert.equal(isLikelyValidationError('Select One', { inFieldWrapper: true }), true);
        assert.equal(isLikelyValidationError('Select One'), false, 'but not on its own');
    });

    test('empty text is never an error', () => {
        assert.equal(isLikelyValidationError(''), false);
        assert.equal(isLikelyValidationError(null), false);
        assert.equal(isLikelyValidationError('   ', { inFieldWrapper: true }), false);
    });
});

// ── an advisory is not a failure ───────────────────────────────────────────
// Measured on a real My Information step: a legal name in capitals raises an
// "Alerts Found" panel. Nothing is wrong and Next works — but the deterministic
// advance requires errors.length === 0, so counting an advisory as an error
// withholds the click for as long as the advisory is on screen. A step that fills
// perfectly and then never moves, with no failure anywhere to point at.
describe('Workday alerts vs errors', () => {
    const ADVISORIES = [
        'Alert - Family Name - Western Script',
        'Verify that the field Family Name is correctly capitalized because it contains more than 2 capital letters.',
        'Please verify your phone number',
        'Xác nhận lại số điện thoại',
    ];
    for (const text of ADVISORIES) {
        test(`advisory, not an error: "${text.slice(0, 40)}…"`, () => {
            assert.equal(isLikelyValidationError(text), false);
            assert.equal(isLikelyValidationError(text, { inFieldWrapper: true }), false,
                'the field-wrapper path treated anything non-status as an error');
        });
    }

    test('a real error is still an error', () => {
        assert.equal(isLikelyValidationError('Error: The field How Did You Hear About Us? is required and must have a value.'), true);
        assert.equal(isLikelyValidationError('Please enter a valid email'), true);
    });

    test('"verify" wording does not swallow a genuine required error', () => {
        // The advisory check runs first, so it must not match an error that merely
        // shares a word with one.
        assert.equal(isLikelyValidationError('This field is required'), true);
        assert.equal(isLikelyValidationError('Postal Code is invalid'), true);
    });
});
