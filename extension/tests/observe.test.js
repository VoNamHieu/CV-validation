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
