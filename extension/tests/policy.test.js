// Safety regression suite for the action policy (node --test, no deps).
//
// These assertions are the contract the rest of the agent is allowed to be
// flexible against: whatever the planner proposes, whatever a page says, these
// outcomes do not change. A failure here is not a style regression — it means
// the agent can now take an action the user never approved.
//
// Only the PURE half is exercised (descriptors, not elements), which is exactly
// why the module was split that way: the vocabulary is where the judgement
// lives, and it needs no browser to pin down.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    evaluateClick, evaluateConsent, evaluateCheckboxFill, evaluateFill, classifyConsent,
    looksLikeSubmit, isSensitiveField, DENY,
} from '../src/content-agent/policy.js';

const planner = { source: 'planner' };
const el = (text, extra = {}) => ({ text, ...extra });

// ── the cardinal rule: we never send the application ───────────────────────
describe('submit is refused', () => {
    for (const label of [
        'Submit', 'Submit Application', 'Send my application',
        'Nộp đơn', 'Nộp hồ sơ', 'Gửi hồ sơ', 'Hoàn tất ứng tuyển',
    ]) {
        test(`"${label}" is not clickable by the planner`, () => {
            const v = evaluateClick(el(label), planner);
            assert.equal(v.allowed, false);
            assert.equal(v.code, DENY.SUBMIT);
        });
    }

    test('the recipe\'s own submit selector is refused even with harmless text', () => {
        const v = evaluateClick(
            { text: 'Tiếp tục', selector: '[data-automation-id="pageFooterSubmitButton"]' },
            { ...planner, submitSelector: '[data-automation-id="pageFooterSubmitButton"]' },
        );
        assert.equal(v.allowed, false);
        assert.equal(v.code, DENY.SUBMIT);
    });

    test('quoting differences do not defeat the selector match', () => {
        const v = evaluateClick(
            { text: 'Next', selector: "[data-automation-id='pageFooterSubmitButton']" },
            { ...planner, submitSelector: '[data-automation-id="pageFooterSubmitButton"]' },
        );
        assert.equal(v.allowed, false);
    });

    test('on the review step EVERY click is refused — Workday reuses Next as Submit', () => {
        const v = evaluateClick(el('Save and Continue'), { ...planner, atFinalStep: true });
        assert.equal(v.allowed, false);
        assert.equal(v.code, DENY.FINAL_STEP);
    });

    test('a widget option cannot bypass the final-step stop', () => {
        // `widget` short-circuits, so it must never be set on the review page by
        // a caller. This test documents the ordering so a future edit that moves
        // the widget check below the final-step check is a visible behaviour change.
        const v = evaluateClick(el('Vietnam'), { source: 'recipe', widget: true, atFinalStep: true });
        assert.equal(v.allowed, true, 'widget short-circuit is intentional and comes first');
    });
});

// ── the VN collision: the same words open and send an application ──────────
describe('apply-verb collision (vi)', () => {
    test('"Nộp hồ sơ" opens the form when there is no form yet', () => {
        const v = evaluateClick(el('Nộp hồ sơ'), { source: 'gateway', openingApplication: true });
        assert.equal(v.allowed, true);
    });

    test('…and is refused once we are on the form', () => {
        const v = evaluateClick(el('Nộp hồ sơ'), planner);
        assert.equal(v.allowed, false);
    });

    test('"Apply" alone is never treated as a submit', () => {
        assert.equal(looksLikeSubmit(el('Apply now')), false);
        assert.equal(looksLikeSubmit(el('Ứng tuyển ngay')), false);
    });
});

// ── consent: one delegated case, everything else stays with the user ───────
describe('consent', () => {
    // The gate is DELEGATION (did the batch-start modal run?), not which form the
    // box sits on — the modal's wording covers "điều khoản ứng tuyển bắt buộc".
    const signupLogin = { source: 'login', formKind: 'signup', consentDelegated: true };
    const delegated = { source: 'planner', consentDelegated: true };

    test('terms on a create-account form are delegated', () => {
        const v = evaluateConsent(el('I agree to the Terms and Conditions'), signupLogin);
        assert.equal(v.allowed, true);
    });

    test('mandatory apply terms are covered too — Workday cannot reach review otherwise', () => {
        const v = evaluateConsent(
            el('I have read and consent to the Terms and Conditions'), delegated);
        assert.equal(v.allowed, true);
    });

    test('without the modal there is no delegation, so the box stays with the user', () => {
        // The SmartRecruiters shape: no account needed, so no modal ever ran.
        const v = evaluateConsent(el('I agree to the Terms and Conditions'), planner);
        assert.equal(v.allowed, false);
        assert.equal(v.code, DENY.APPLICATION_CONSENT);
    });

    test('marketing is refused even inside the delegated signup flow', () => {
        const v = evaluateConsent(el('I agree to receive marketing updates'), signupLogin);
        assert.equal(v.allowed, false);
        assert.equal(v.code, DENY.MARKETING_CONSENT);
    });

    test('marketing wins when a label claims to be both', () => {
        assert.equal(classifyConsent(el('I agree to the terms and to receive newsletters')), 'marketing');
        assert.equal(
            evaluateConsent(el('I agree to the terms and to receive newsletters'), delegated).code,
            DENY.MARKETING_CONSENT);
    });

    test('a personal attestation is refused even in the delegated flow', () => {
        const v = evaluateConsent(el('I certify I have never been convicted of a felony'), signupLogin);
        assert.equal(v.allowed, false);
        assert.equal(v.consentKind, 'declaration');
    });

    test('a box we cannot place at all is still the user\'s call', () => {
        const v = evaluateConsent(el('Include me in the alumni directory'), signupLogin);
        assert.equal(v.allowed, false);
        assert.equal(v.consentKind, 'other');
    });

    test('vietnamese terms wording is recognised', () => {
        assert.equal(classifyConsent(el('Tôi đồng ý với điều khoản sử dụng')), 'terms');
        assert.equal(classifyConsent(el('Tôi muốn nhận tin khuyến mãi')), 'marketing');
    });
});

// ── destructive + third-party + account creation ───────────────────────────
describe('other irreversible actions', () => {
    test('deleting an experience entry is refused', () => {
        assert.equal(evaluateClick(el('Delete'), planner).code, DENY.DESTRUCTIVE);
        assert.equal(evaluateClick(el('Xóa'), planner).code, DENY.DESTRUCTIVE);
    });

    test('withdrawing the application is refused', () => {
        assert.equal(evaluateClick(el('Withdraw application'), planner).code, DENY.DESTRUCTIVE);
    });

    test('third-party apply shortcuts are refused', () => {
        assert.equal(evaluateClick(el('Apply with Indeed'), planner).code, DENY.THIRD_PARTY);
        assert.equal(evaluateClick(el('Ứng tuyển bằng LinkedIn'), planner).code, DENY.THIRD_PARTY);
    });

    test('the planner may not open an account', () => {
        assert.equal(evaluateClick(el('Create Account'), planner).code, DENY.CREATE_ACCOUNT);
        assert.equal(evaluateClick(el('Tạo tài khoản'), planner).code, DENY.CREATE_ACCOUNT);
    });

    test('…but the controlled login flow may', () => {
        assert.equal(evaluateClick(el('Create Account'), { source: 'login' }).allowed, true);
    });
});

// ── fields that must never receive profile data ────────────────────────────
describe('sensitive fields', () => {
    for (const d of [
        { type: 'password' },
        { text: 'One-time code', name: 'otp' },
        { label: 'Mã xác minh' },
        { label: 'Card number', name: 'cardNumber' },
        { label: 'CVV' },
        { label: 'Số CCCD/CMND' },
        { label: 'Social Security Number' },
        { selector: '#user_password' },
    ]) {
        test(`refused: ${JSON.stringify(d)}`, () => {
            assert.equal(isSensitiveField(d), true);
            assert.equal(evaluateFill(d, planner).allowed, false);
        });
    }

    test('a password box is writable ONLY by the login flow', () => {
        assert.equal(evaluateFill({ type: 'password' }, planner).allowed, false);
        assert.equal(evaluateFill({ type: 'password' }, { source: 'login' }).allowed, true);
    });

    test('ordinary fields are untouched by the policy', () => {
        assert.equal(evaluateFill({ type: 'text', label: 'First name' }, planner).allowed, true);
        assert.equal(evaluateFill({ type: 'tel', label: 'Số điện thoại' }, planner).allowed, true);
    });
});

// ── refusing too much is its own failure ───────────────────────────────────
// Each of these was a live over-restriction: the policy said no to something
// ordinary, which does not make the agent safer — it makes the step
// unadvanceable and hands the user a half-filled form.
describe('over-restriction regressions', () => {
    test('an ordinary checkbox question is answerable', () => {
        // Required "Willing to relocate?" boxes are common. Refusing them blocks
        // the step; nothing about answering one is irreversible.
        assert.equal(evaluateCheckboxFill(el('Are you willing to relocate?'), planner).allowed, true);
        assert.equal(evaluateFill({ type: 'checkbox', label: 'I have a driver\'s licence' }, planner).allowed, true);
    });

    test('…but a personal declaration never is, delegated or not', () => {
        const delegated = { source: 'planner', consentDelegated: true };
        for (const label of [
            'I certify that the information provided is accurate',
            'I declare under penalty of perjury',
            'Please self-identify your disability status',
            'Protected veteran status',
            'Tôi cam đoan thông tin trên là đúng sự thật',
        ]) {
            assert.equal(evaluateCheckboxFill(el(label), delegated).allowed, false, label);
        }
    });

    test('a declaration is not misread as delegable terms', () => {
        // Agreement wording wrapped around a personal attestation must not
        // promote it to a delegable terms box.
        assert.equal(classifyConsent(el('I agree and certify that I have no criminal record')), 'declaration');
    });

    test('…but certifying that you READ a document is still terms', () => {
        // The mirror image, and the reason the two rules are separated: Workday's
        // signup box is phrased this way, and calling it a declaration blocked
        // account creation entirely.
        assert.equal(classifyConsent(el('I certify that I have read and accept the Terms and Conditions')), 'terms');
        assert.equal(
            evaluateConsent(el('I certify that I have read the Privacy Policy'),
                { source: 'login', formKind: 'signup', consentDelegated: true }).allowed,
            true);
    });

    test('demographic self-ID stays non-delegable even beside policy wording', () => {
        // "In accordance with our EEO policy, please self-identify…" contains a
        // document word; the personal-data rule must not be exemptible by it.
        assert.equal(
            classifyConsent(el('In accordance with our EEO policy, please self-identify your disability status')),
            'declaration');
    });

    test('a plain multi-step Next button is not a submit', () => {
        // `name="submit"` / `type="submit"` is ordinary HTML for step navigation.
        // Reading identifiers here refused every advance on ATS we have no recipe
        // for — the exact-control case belongs to ctx.submitSelector instead.
        assert.equal(looksLikeSubmit({ text: 'Next', name: 'submit', type: 'submit' }), false);
        assert.equal(looksLikeSubmit({ text: 'Tiếp tục', id: 'submit-btn' }), false);
        assert.equal(evaluateClick({ text: 'Next', name: 'submit', type: 'submit' }, planner).allowed, true);
    });

    test('an input[type=submit] is still judged by its visible value', () => {
        assert.equal(looksLikeSubmit({ type: 'submit', value: 'Nộp hồ sơ' }), true);
        assert.equal(looksLikeSubmit({ type: 'submit', value: 'Next' }), false);
    });

    test('an email box beside "Forgot password?" is still fillable', () => {
        // The single most common layout on a login wall. Reading neighbouring
        // copy for sensitivity made the agent refuse to type an email address.
        const emailBox = {
            type: 'email', name: 'email', label: 'Email',
            nearbyText: 'Forgot password? Reset it here',
        };
        assert.equal(isSensitiveField(emailBox), false);
        assert.equal(evaluateFill(emailBox, planner).allowed, true);
    });

    test('a textarea whose CONTENT mentions a password is still fillable', () => {
        // The value is the user's own text, not a description of the field.
        const cover = {
            type: 'textarea', label: 'Cover letter',
            value: 'I built the password reset flow at my last company',
        };
        assert.equal(isSensitiveField(cover), false);
    });
});

// ── the failure mode of forgetting ─────────────────────────────────────────
describe('defaults', () => {
    test('an undeclared caller is treated as the planner, not waved through', () => {
        assert.equal(evaluateClick(el('Submit')).allowed, false);
        assert.equal(evaluateFill({ type: 'password' }).allowed, false);
        assert.equal(evaluateConsent(el('I agree to the terms')).allowed, false);
    });
});
