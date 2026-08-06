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

    test('NOTHING is exempt at the final step — not even a dropdown option', () => {
        // The review page ends the agent's authority. An earlier version let
        // widget activations short-circuit ahead of this check, which meant a
        // recipe or handler could still touch the page that carries Submit.
        for (const ctx of [
            { source: 'recipe', activation: 'widget-option', atFinalStep: true },
            { source: 'recipe', activation: 'widget-open', atFinalStep: true },
            { source: 'planner', atFinalStep: true },
            { source: 'gateway', openingApplication: true, atFinalStep: true },
        ]) {
            const v = evaluateClick(el('Vietnam'), ctx);
            assert.equal(v.allowed, false, JSON.stringify(ctx));
            assert.equal(v.code, DENY.FINAL_STEP);
        }
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

// ── consent: ticked, because the boundary is submission ────────────────────
describe('consent', () => {
    // Every consent box worth arguing about is one that is MANDATORY to advance,
    // so a policy that refuses it is not leaving the user a decision — it is
    // stranding the application one step short of the review page where they were
    // going to make that decision. They still make it: they read the review and
    // press Submit, which the agent never does.
    for (const label of [
        'I agree to the Terms and Conditions',
        'I have read and consent to the Terms and Conditions',
        'I certify I have never been convicted of a felony',
        'Include me in the alumni directory',
        'Tôi đồng ý với điều khoản sử dụng',
    ]) {
        test(`ticked: ${label}`, () => {
            assert.equal(evaluateConsent(el(label)).allowed, true);
        });
    }

    test('no caller context is needed to reach that answer', () => {
        // The delegation flag this used to hinge on came from a modal that only
        // ran on ATSes needing an account, so SmartRecruiters — which needs none —
        // could never tick a required box at all.
        assert.equal(evaluateConsent(el('I agree to the Terms and Conditions')).allowed, true);
    });

    test('marketing is refused, always', () => {
        // Not because it is riskier — because it is never required to advance, so
        // ticking it buys nothing and signs the user up for mail they did not ask
        // for. This is the one thing the batch-start modal promises outright.
        const v = evaluateConsent(el('I agree to receive marketing updates'));
        assert.equal(v.allowed, false);
        assert.equal(v.code, DENY.MARKETING_CONSENT);
    });

    test('marketing wins when a label claims to be both', () => {
        assert.equal(classifyConsent(el('I agree to the terms and to receive newsletters')), 'marketing');
        assert.equal(
            evaluateConsent(el('I agree to the terms and to receive newsletters')).code,
            DENY.MARKETING_CONSENT);
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

    test('the recipe may deselect ONE committed chip it is correcting', () => {
        // Measured on PwC: the résumé parser committed the wrong university
        // ("…at Chicago" for a CV that says Urbana-Champaign) and the eviction
        // written to fix exactly that was denied here — a false credential rode
        // to review twice. The ✕ on a chip says "Remove"; that is the widget's
        // word for unpicking an option, not a destructive act.
        const chip = { text: 'Remove University of Illinois at Chicago', automationId: 'selectedItem' };
        assert.equal(
            evaluateClick(chip, { source: 'recipe', activation: 'widget-option' }).allowed,
            true);
    });

    test('…and nothing wider than that', () => {
        const chip = { text: 'Remove University of Illinois at Chicago', automationId: 'selectedItem' };
        // The planner never gets it, whatever it claims about the element.
        assert.equal(evaluateClick(chip, planner).code, DENY.DESTRUCTIVE);
        // A section Delete button is not a chip, even from the recipe.
        assert.equal(
            evaluateClick(el('Delete'), { source: 'recipe', activation: 'widget-option' }).code,
            DENY.DESTRUCTIVE);
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

    test('disclosures and declarations ARE answerable — the user reviews them at the end', () => {
        // The agent's job is to complete the application; the review page is where
        // the user checks it. Refusing these left Workday stuck at Voluntary
        // Disclosures, so the application never reached the page that was supposed
        // to make refusing unnecessary.
        for (const label of [
            'I certify that the information provided is accurate',
            'I declare under penalty of perjury',
            'Please self-identify your disability status',
            'Protected veteran status',
            'I have read and consent to the Terms and Conditions',
            'Tôi cam đoan thông tin trên là đúng sự thật',
        ]) {
            assert.equal(evaluateCheckboxFill(el(label)).allowed, true, label);
        }
    });

    test('marketing opt-in is the one answer the agent never gives', () => {
        // Not required to advance, and the batch-start modal promises it in words.
        assert.equal(evaluateCheckboxFill(el('Send me job alerts and promotions')).allowed, false);
        assert.equal(evaluateCheckboxFill(el('Tôi muốn nhận tin khuyến mãi')).allowed, false);
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
            evaluateConsent(el('I certify that I have read the Privacy Policy')).allowed,
            true);
    });

    test('demographic self-ID still classifies apart from policy wording', () => {
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
        // `value` is the label on a button-like input, so it must be read — but
        // "Nộp hồ sơ" is an AMBIGUOUS apply verb, not an unambiguous submit, so
        // the verdict comes from flow context rather than from the word alone.
        assert.equal(looksLikeSubmit({ type: 'submit', value: 'Submit Application' }), true);
        assert.equal(looksLikeSubmit({ type: 'submit', value: 'Next' }), false);

        const onForm = evaluateClick({ type: 'submit', value: 'Nộp hồ sơ' }, planner);
        assert.equal(onForm.allowed, false, 'on a form it is the submit');
        const asGateway = evaluateClick(
            { type: 'submit', value: 'Nộp hồ sơ' }, { source: 'gateway', openingApplication: true });
        assert.equal(asGateway.allowed, true, 'on a job ad it opens the application');
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

// ── the product contract, as one table ─────────────────────────────────────
// Fill everything. Advance through everything. Review everything. Submit nothing.
describe('acceptance matrix', () => {
    const cases = [
        // [what,                              ctx,                          allowed]
        ['Next',                               planner,                       true],
        ['Continue',                           planner,                       true],
        ['Save and Continue',                  planner,                       true],
        ['Tiếp tục',                           planner,                       true],
        ['Voluntary Disclosures acknowledgement', planner,                    true],
        ['Yes',                                planner,                       true],
        ['No',                                 planner,                       true],
        ['Prefer not to say',                  planner,                       true],
        ['I acknowledge and agree',            planner,                       true],
        ['Submit',                             planner,                       false],
        ['Submit Application',                 planner,                       false],
        ['Save and Continue',                  { ...planner, atFinalStep: true }, false],
        ['Next',                               { ...planner, atFinalStep: true }, false],
        ['Withdraw application',               planner,                       false],
        ['Apply with Indeed',                  planner,                       false],
    ];
    for (const [label, ctx, allowed] of cases) {
        test(`${allowed ? 'allowed' : 'refused'}: "${label}"${ctx.atFinalStep ? ' @final' : ''}`, () => {
            assert.equal(evaluateClick(el(label), ctx).allowed, allowed);
        });
    }

    test('radio and checkbox answers are all fillable', () => {
        for (const d of [
            { type: 'radio', label: 'Are you legally authorized to work?' },
            { type: 'checkbox', label: 'I have read the notice' },
            { type: 'checkbox', label: 'Disability status: I do not wish to answer' },
        ]) {
            assert.equal(evaluateFill(d, planner).allowed, true, JSON.stringify(d));
        }
    });
});

// ── the failure mode of forgetting ─────────────────────────────────────────
describe('defaults', () => {
    test('an undeclared caller is treated as the planner, not waved through', () => {
        assert.equal(evaluateClick(el('Submit')).allowed, false);
        assert.equal(evaluateFill({ type: 'password' }).allowed, false);
        // Consent no longer reads context at all — it is ticked either way. What
        // must survive a caller that passes nothing is the refusal that does not
        // depend on context: a marketing opt-in.
        assert.equal(evaluateConsent(el('I agree to receive our newsletter')).allowed, false);
    });
});
