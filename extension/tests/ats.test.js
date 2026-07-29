// Tests for the ATS candidate-account logic (node --test, no deps).
//
// These three modules decide things that are expensive to get wrong: which
// account a job belongs to, what an auth failure MEANS, and whether a tenant may
// be touched again. A misclassification here either locks a user out of a real
// candidate account or accuses them of a wrong password they never typed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { tenantRefFor, vendorForHost, sortJobsByTenant } from '../src/ats/tenant.js';
import { classifyDomError, classifyApiResponse, authResult, detectChallenge, RETRYABLE } from '../src/ats/classifier.js';
import { BLOCKING_STATES, OUTCOMES } from '../src/ats/states.js';
import * as coord from '../src/ats/coordinator.js';
import { FALLBACK_RECIPES } from '../src/content-agent/recipe.js';

// ── tenant identity ────────────────────────────────────────────────────────
describe('tenantRefFor', () => {
    test('keys on the host, not the career site', () => {
        const a = tenantRefFor('https://aia.wd3.myworkdayjobs.com/en-US/AIA_Careers/job/HCM/Analyst_R-1');
        const b = tenantRefFor('https://aia.wd3.myworkdayjobs.com/en-US/AIA_Campus/job/HN/Intern_R-2');
        assert.equal(a.tenantKey, 'aia.wd3.myworkdayjobs.com');
        assert.equal(a.tenantKey, b.tenantKey,
            'two career sites on one host must share ONE account, or a per-tenant '
            + 'password override fragments and the user is asked twice');
        assert.equal(a.careerSiteKey, 'AIA_Careers');
        assert.equal(b.careerSiteKey, 'AIA_Campus');
    });

    test('different tenants are different accounts', () => {
        const aia = tenantRefFor('https://aia.wd3.myworkdayjobs.com/en-US/X/job/1');
        const bosch = tenantRefFor('https://bosch.wd3.myworkdayjobs.com/en-US/X/job/1');
        assert.notEqual(aia.tenantKey, bosch.tenantKey);
    });

    test('skips the locale segment when finding the career site', () => {
        assert.equal(tenantRefFor('https://x.wd1.myworkdayjobs.com/en-US/Site/job/1').careerSiteKey, 'Site');
        assert.equal(tenantRefFor('https://x.wd1.myworkdayjobs.com/fr/Site/job/1').careerSiteKey, 'Site');
        assert.equal(tenantRefFor('https://x.wd1.myworkdayjobs.com/Site/job/1').careerSiteKey, 'Site');
    });

    test('no career site in the path is not an error', () => {
        const ref = tenantRefFor('https://x.wd1.myworkdayjobs.com/job/12345');
        assert.equal(ref.tenantKey, 'x.wd1.myworkdayjobs.com');
        assert.equal(ref.careerSiteKey, null);
    });

    test('myworkdaysite pods scope the account by PATH, not by host', () => {
        // wd3.myworkdaysite.com is one pod shared by every company on it. Keying
        // on the host collapsed them into a single account: a credential pinned
        // for Mondelez applied to Unilever, a verification block at one blocked
        // all, and the per-tenant attempt budget — the actual lockout defence —
        // was spent by the first two companies on behalf of everybody.
        const mdlz = tenantRefFor('https://wd3.myworkdaysite.com/recruiting/mdlz/External/job/Ho-Chi-Minh-Vietnam/Sales-Operation-Intern_R-173597-1');
        const unilever = tenantRefFor('https://wd3.myworkdaysite.com/recruiting/unilever/Careers/job/HCM/X_R-1');
        assert.equal(mdlz.tenantKey, 'wd3.myworkdaysite.com/mdlz');
        assert.notEqual(mdlz.tenantKey, unilever.tenantKey, 'two companies, two accounts');
        assert.equal(mdlz.careerSiteKey, 'External', '"recruiting" is plumbing, not the career site');
        assert.equal(mdlz.tenantSlug, 'mdlz', 'the label must name the company, not the pod');
        assert.equal(mdlz.canonicalHost, 'wd3.myworkdaysite.com', 'the link still points at the host');
    });

    test('two career sites of the SAME myworkdaysite tenant still share one account', () => {
        const a = tenantRefFor('https://wd3.myworkdaysite.com/recruiting/mdlz/External/job/X/A_R-1');
        const b = tenantRefFor('https://wd3.myworkdaysite.com/recruiting/mdlz/Campus/job/X/B_R-2');
        assert.equal(a.tenantKey, b.tenantKey);
    });

    test('a bare pod URL names no account and is declined', () => {
        assert.equal(tenantRefFor('https://wd3.myworkdaysite.com/recruiting'), null);
    });

    test('covers myworkdaysite.com', () => {
        // Absent from host_permissions until this change — those tenants had no
        // cookies and no content script at all.
        assert.equal(vendorForHost('acme.wd5.myworkdaysite.com'), 'workday');
        assert.equal(tenantRefFor('https://acme.wd5.myworkdaysite.com/recruiting/acme/S/job/1').atsVendor, 'workday');
    });

    test('returns null for ATS that need no account, and for junk', () => {
        assert.equal(tenantRefFor('https://boards.greenhouse.io/acme/jobs/1'), null);
        assert.equal(tenantRefFor('https://jobs.smartrecruiters.com/acme/1'), null);
        assert.equal(tenantRefFor('not a url'), null);
        assert.equal(tenantRefFor(null), null);
        assert.equal(tenantRefFor(undefined), null);
    });

    test('host matching is anchored — a lookalike domain is not Workday', () => {
        assert.equal(vendorForHost('myworkdayjobs.com.evil.test'), null);
    });

    test('tenantSlug gives a usable label', () => {
        assert.equal(tenantRefFor('https://aia.wd3.myworkdayjobs.com/job/1').tenantSlug, 'aia');
    });
});

describe('sortJobsByTenant', () => {
    test('groups a tenant contiguously and keeps within-tenant order', () => {
        const jobs = [
            { id: 1, jobUrl: 'https://aia.wd3.myworkdayjobs.com/job/1' },
            { id: 2, jobUrl: 'https://bosch.wd3.myworkdayjobs.com/job/2' },
            { id: 3, jobUrl: 'https://aia.wd3.myworkdayjobs.com/job/3' },
            { id: 4, jobUrl: 'https://boards.greenhouse.io/x/jobs/4' },
            { id: 5, jobUrl: 'https://bosch.wd3.myworkdayjobs.com/job/5' },
        ];
        assert.deepEqual(sortJobsByTenant(jobs).map(j => j.id), [1, 3, 2, 5, 4]);
    });

    test('is a permutation — no job is dropped or duplicated', () => {
        const jobs = Array.from({ length: 20 }, (_, i) => ({
            id: i,
            jobUrl: i % 3 === 0
                ? `https://t${i % 4}.wd3.myworkdayjobs.com/job/${i}`
                : `https://boards.greenhouse.io/x/jobs/${i}`,
        }));
        const sorted = sortJobsByTenant(jobs);
        assert.equal(sorted.length, jobs.length);
        assert.deepEqual(sorted.map(j => j.id).sort((a, b) => a - b), jobs.map(j => j.id));
    });

    test('handles an empty batch', () => {
        assert.deepEqual(sortJobsByTenant([]), []);
    });
});

// ── error classification ───────────────────────────────────────────────────
/** Minimal document stub: one visible error banner with the given text. */
function docWith(text, { challenge = false } = {}) {
    const node = { textContent: text, offsetParent: {} };
    return {
        querySelectorAll: (sel) => (sel.includes('error') || sel.includes('alert') ? [node] : []),
        querySelector: (sel) => (challenge && sel.includes('captcha') ? {} : null),
    };
}

// ── challenge detection ────────────────────────────────────────────────────
/**
 * A document stub built from real nodes, because the bug this pins is about
 * WHICH element matched and what was inside it — a stub that answers by
 * substring cannot express that.
 */
function docWithNodes(nodes) {
    const matches = (el, sel) => sel.split(',').map(s => s.trim()).some((s) => {
        if (s.startsWith('iframe')) return el.tag === 'iframe' && (
            (s.includes('recaptcha') && /recaptcha/.test(el.src || ''))
            || (s.includes('hcaptcha') && /hcaptcha/.test(el.src || ''))
            || (s.includes('title') && /captcha/i.test(el.title || '')));
        if (s === '.g-recaptcha') return el.cls === 'g-recaptcha';
        if (s === '#challenge-form') return el.id === 'challenge-form';
        if (s.includes('data-automation-id*="captcha"')) return /captcha/i.test(el.aid || '');
        return false;
    });
    const wrap = (el) => ({
        ...el,
        offsetParent: el.hidden ? null : {},
        getAttribute: (a) => (a === 'data-automation-id' ? el.aid || null : null),
        querySelector: (sel) => (el.contains || []).map(wrap).find(c => matches(c, sel)) || null,
    });
    const all = nodes.map(wrap);
    return { querySelectorAll: (sel) => all.filter(el => matches(el, sel)) };
}

describe('detectChallenge', () => {
    test('a real reCAPTCHA frame is a challenge', () => {
        assert.equal(detectChallenge(docWithNodes([{ tag: 'iframe', src: 'https://google.com/recaptcha/api2' }])), true);
    });

    test('a hidden challenge frame is not on screen, so not a challenge', () => {
        assert.equal(detectChallenge(docWithNodes([{ tag: 'iframe', src: '.../recaptcha', hidden: true }])), false);
    });

    test('Workday\'s noCaptchaWrapper is not a captcha', () => {
        // Measured on Mondelez. This div is the wrapper around the Create Account
        // SUBMIT BUTTON, and its name is Workday saying there is no captcha here —
        // but `[data-automation-id*="captcha" i]` matched the substring, so every
        // signup aborted as challenge_required at the element it needed to click.
        assert.equal(detectChallenge(docWithNodes([
            { tag: 'div', aid: 'noCaptchaWrapper', contains: [{ tag: 'button', aid: 'createAccountSubmitButton' }] },
        ])), false);
    });

    test('a captcha-named wrapper counts once it actually holds a challenge', () => {
        // The other half: the name is not evidence, the contents are.
        assert.equal(detectChallenge(docWithNodes([
            { tag: 'div', aid: 'captchaWrapper', contains: [{ tag: 'iframe', src: '.../hcaptcha' }] },
        ])), true);
        assert.equal(detectChallenge(docWithNodes([{ tag: 'div', aid: 'captchaWrapper', contains: [] }])), false);
    });
});

describe('classifyDomError', () => {
    test('nothing on screen → null', () => {
        assert.equal(classifyDomError(docWith('')), null);
    });

    const cases = [
        ['An account with this email already exists.', 'account_exists'],
        ['Tài khoản đã tồn tại', 'account_exists'],
        ['Please verify your email to continue', 'verification_required'],
        ['A verification email has been sent', 'verification_required'],
        ['Your password has expired', 'password_reset_required'],
        ['This account is locked', 'temporarily_locked'],
        ['Too many failed attempts', 'temporarily_locked'],
        ['Too many requests, try again later', 'rate_limited'],
        ['The email or password you entered is incorrect', 'invalid_credentials'],
        ['Invalid password', 'invalid_credentials'],
        ['Sai mật khẩu', 'invalid_credentials'],
    ];
    for (const [text, expected] of cases) {
        test(`"${text.slice(0, 40)}" → ${expected}`, () => {
            assert.equal(classifyDomError(docWith(text)).outcome, expected);
        });
    }

    test('CRITICAL: a generic failure is NOT invalid_credentials', () => {
        // This is the rule the whole design leans on. `invalid_credentials`
        // blocks the tenant and tells the user their password is wrong — it must
        // never be inferred from "something went wrong".
        for (const text of [
            'Sign in failed',
            'We were unable to process your request',
            'An error occurred. Please try again.',
            'Something went wrong',
        ]) {
            const got = classifyDomError(docWith(text));
            assert.equal(got.outcome, 'unknown_error', `"${text}" must stay unknown_error`);
            assert.equal(got.code, 'unrecognized_error');
        }
    });

    test('a password-policy complaint is not a credentials error either', () => {
        // It means the SIGNUP was rejected, not that the stored password is wrong.
        assert.equal(
            classifyDomError(docWith('Password must contain a special character')).outcome,
            'unknown_error',
        );
    });

    test('the banner text is never returned — only a sanitized code', () => {
        // Error banners can echo the user's email address.
        const got = classifyDomError(docWith('No account for hieu@example.com'));
        assert.equal(JSON.stringify(got).includes('hieu@example.com'), false);
    });
});

describe('classifyApiResponse', () => {
    test('2xx is success', () => {
        assert.equal(classifyApiResponse({ status: 200, json: {} }).outcome, 'success');
        assert.equal(classifyApiResponse({ status: 204, text: '' }).outcome, 'success');
    });

    test('429 is rate limited, 5xx is transient — both retryable', () => {
        const rl = classifyApiResponse({ status: 429, json: {} });
        const tx = classifyApiResponse({ status: 503, json: {} });
        assert.equal(rl.outcome, 'rate_limited');
        assert.equal(tx.outcome, 'transient_error');
        assert.ok(RETRYABLE.has(rl.outcome) && RETRYABLE.has(tx.outcome));
    });

    test('401/403 stays vague — unauthenticated is not "wrong password"', () => {
        // An unverified account and a challenge produce 401 too.
        assert.equal(classifyApiResponse({ status: 401, json: {} }).outcome, 'unknown_error');
        assert.equal(classifyApiResponse({ status: 403, json: {} }).outcome, 'unknown_error');
    });

    test('an explicit body signal still wins over the status code', () => {
        const got = classifyApiResponse({
            status: 400, json: { message: 'An account with this email already exists' },
        });
        assert.equal(got.outcome, 'account_exists');
    });

    test('carries the source through for the audit log', () => {
        assert.equal(classifyApiResponse({ status: 200, json: {} }, { source: 'cxs' }).source, 'cxs');
    });
});

describe('authResult', () => {
    test('emits only outcomes the backend accepts', () => {
        for (const outcome of OUTCOMES) {
            assert.equal(authResult('login', outcome, 'dom').outcome, outcome);
        }
    });

    test('derives retryable from the outcome', () => {
        assert.equal(authResult('login', 'transient_error', 'dom').retryable, true);
        assert.equal(authResult('login', 'invalid_credentials', 'dom').retryable, false);
        assert.equal(authResult('login', 'verification_required', 'dom').retryable, false);
    });
});

// ── coordinator: probe-once + attempt budget ───────────────────────────────
describe('coordinator', () => {
    const AIA = { atsVendor: 'workday', tenantKey: 'aia.wd3.myworkdayjobs.com' };

    test('an unseen tenant is probed, signup first', () => {
        // Signup-first because Workday's signup answers distinguishably
        // ("account already exists"), while a failed login is ambiguous.
        coord.beginBatch('b1', {});
        assert.equal(coord.gateJob(AIA).skip, false);
        assert.equal(coord.nextOperation(AIA.tenantKey), 'signup');
    });

    test('a known-ready tenant logs in directly', () => {
        coord.beginBatch('b1', { [AIA.tenantKey]: { accountState: 'ready' } });
        assert.equal(coord.gateJob(AIA).skip, false);
        assert.equal(coord.nextOperation(AIA.tenantKey), 'login');
    });

    for (const state of BLOCKING_STATES) {
        test(`'${state}' skips the job without opening a tab`, () => {
            coord.beginBatch('b1', { [AIA.tenantKey]: { accountState: state } });
            const gate = coord.gateJob(AIA);
            assert.equal(gate.skip, true, `${state} must not be retried automatically`);
            assert.ok(['verification', 'credential', 'manual'].includes(gate.reason));
        });
    }

    test('verification and credential blocks map to their own UI reasons', () => {
        coord.beginBatch('b1', { [AIA.tenantKey]: { accountState: 'verification_required' } });
        assert.equal(coord.gateJob(AIA).reason, 'verification');
        coord.beginBatch('b2', { [AIA.tenantKey]: { accountState: 'credential_required' } });
        assert.equal(coord.gateJob(AIA).reason, 'credential');
        coord.beginBatch('b3', { [AIA.tenantKey]: { accountState: 'challenge_required' } });
        assert.equal(coord.gateJob(AIA).reason, 'manual');
    });

    test('temporarily_locked is honoured until next_retry_at, then released', () => {
        coord.beginBatch('b1', {
            [AIA.tenantKey]: {
                accountState: 'temporarily_locked',
                nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
            },
        });
        assert.equal(coord.gateJob(AIA).skip, true);

        coord.beginBatch('b2', {
            [AIA.tenantKey]: {
                accountState: 'temporarily_locked',
                nextRetryAt: new Date(Date.now() - 60_000).toISOString(),
            },
        });
        assert.equal(coord.gateJob(AIA).skip, false, 'backoff expired → probe again');
    });

    test('temporarily_locked WITHOUT a deadline is not a life sentence', () => {
        // The DOM classifier reports a lockout with no retry-after (Workday's
        // banner carries none), so this row shape is the common one, not an edge
        // case. Treating a missing deadline as "never" stranded the tenant for
        // good: skipped in every later batch, and `temporarily_locked` is
        // deliberately absent from the "Cần bạn xử lý" list, so no screen in the
        // product could clear it. The attempt budget is what bounds the retry.
        coord.beginBatch('b1', {
            [AIA.tenantKey]: { accountState: 'temporarily_locked', nextRetryAt: null },
        });
        assert.equal(coord.gateJob(AIA).skip, false);

        coord.beginBatch('b2', {
            [AIA.tenantKey]: { accountState: 'temporarily_locked', nextRetryAt: 'not a date' },
        });
        assert.equal(coord.gateJob(AIA).skip, false, 'an unparseable deadline is no deadline');
    });

    test('snapshot/restore survives a recycled service worker', () => {
        // MV3 recycles an idle worker and a job legitimately takes minutes, so
        // this is the NORMAL path through a batch. Losing the budget here means
        // re-probing a tenant that is already waiting on the user.
        coord.beginBatch('b1', {
            [AIA.tenantKey]: { accountState: 'verification_required' },
        });
        coord.recordAttempt(AIA.tenantKey, 'signup');
        const snap = JSON.parse(JSON.stringify(coord.snapshot()));  // through storage

        coord.endBatch();                     // the worker died
        assert.equal(coord.stateFor(AIA.tenantKey), 'unknown');

        assert.equal(coord.restore(snap), true);
        assert.equal(coord.currentBatchId(), 'b1', 'batchId must survive, or the '
            + 'idempotency key for auth-results collides across batches');
        assert.equal(coord.stateFor(AIA.tenantKey), 'verification_required');
        assert.equal(coord.gateJob(AIA).skip, true, 'the blocked tenant stays blocked');
        assert.equal(coord.nextOperation(AIA.tenantKey), 'login',
            'the spent signup must not come back');
    });

    test('restore(null) is a no-op rather than a crash', () => {
        coord.beginBatch('b1', {});
        assert.equal(coord.restore(null), false);
    });

    test('probe-once: the budget is spent after signup + login, then jobs skip', () => {
        // Ten jobs at one tenant must cost at most two auth operations — this is
        // the actual lockout defence, far more than any password choice.
        coord.beginBatch('b1', {});
        assert.equal(coord.nextOperation(AIA.tenantKey), 'signup');
        coord.recordAttempt(AIA.tenantKey, 'signup');
        assert.equal(coord.nextOperation(AIA.tenantKey), 'login');
        coord.recordAttempt(AIA.tenantKey, 'login');
        assert.equal(coord.nextOperation(AIA.tenantKey), null);
        assert.equal(coord.gateJob(AIA).skip, true, 'budget spent → remaining jobs skip');
    });

    test('a grant that never became a submission is refunded', () => {
        // The failure this fixes: the agent asked for a credential while the login
        // wall was still rendering, found nothing to type into, and the tenant was
        // out of logins for the rest of the batch — for an attempt the ATS never
        // saw. Refunding is safe exactly because nothing was submitted; the budget
        // exists to limit failed logins the ATS counts, and there was none.
        coord.beginBatch('b1', {});
        assert.equal(coord.nextOperation(AIA.tenantKey), 'signup');
        coord.recordAttempt(AIA.tenantKey, 'signup');
        coord.refundAttempt(AIA.tenantKey, 'signup');
        assert.equal(coord.nextOperation(AIA.tenantKey), 'signup', 'the attempt comes back');
    });

    test('a refund cannot mint attempts that were never spent', () => {
        // Otherwise a repeated abandon would drive the counter negative and hand
        // the tenant unlimited logins — the exact opposite of what it is for.
        coord.beginBatch('b1', {});
        coord.refundAttempt(AIA.tenantKey, 'login');
        coord.refundAttempt(AIA.tenantKey, 'login');
        coord.recordAttempt(AIA.tenantKey, 'signup');
        coord.recordAttempt(AIA.tenantKey, 'login');
        assert.equal(coord.nextOperation(AIA.tenantKey), null);
    });

    test("a 'ready' tenant logs in instead of probing signup first", () => {
        // How a supplied credential reaches 'login' without bypassing anything:
        // it says the account EXISTS, which is what 'ready' means, and this is
        // the ordinary consequence of that state. Signup-first is the right
        // default only while the account's existence is unknown — otherwise every
        // run opens by trying to register an account that is already there.
        coord.beginBatch('b1', {});
        coord.setState(AIA.tenantKey, { accountState: 'ready' });
        assert.equal(coord.nextOperation(AIA.tenantKey), 'login');
    });

    test("'ready' does not buy extra attempts", () => {
        // The state changes WHICH operation is chosen, never how many are
        // allowed — otherwise it would be a way to re-probe a tenant that had
        // already spent its budget.
        coord.beginBatch('b1', {});
        coord.setState(AIA.tenantKey, { accountState: 'ready' });
        coord.recordAttempt(AIA.tenantKey, 'login');
        assert.equal(coord.nextOperation(AIA.tenantKey), null);
    });

    test('a verdict recorded for the tenant applies to its later jobs', () => {
        coord.beginBatch('b1', {});
        assert.equal(coord.gateJob(AIA).skip, false);
        coord.setState(AIA.tenantKey, { accountState: 'verification_required' });
        assert.equal(coord.gateJob(AIA).skip, true);
        assert.equal(coord.gateJob(AIA).reason, 'verification');
    });

    test('budgets are per tenant, not global', () => {
        const bosch = { atsVendor: 'workday', tenantKey: 'bosch.wd3.myworkdayjobs.com' };
        coord.beginBatch('b1', {});
        coord.recordAttempt(AIA.tenantKey, 'signup');
        coord.recordAttempt(AIA.tenantKey, 'login');
        assert.equal(coord.nextOperation(AIA.tenantKey), null);
        assert.equal(coord.nextOperation(bosch.tenantKey), 'signup');
        assert.equal(coord.gateJob(bosch).skip, false);
    });

    test('a job with no tenant (ATS needing no account) is never gated', () => {
        coord.beginBatch('b1', {});
        assert.equal(coord.gateJob(null).skip, false);
    });

    test('beginBatch resets the previous batch\'s budget', () => {
        coord.beginBatch('b1', {});
        coord.recordAttempt(AIA.tenantKey, 'signup');
        coord.recordAttempt(AIA.tenantKey, 'login');
        assert.equal(coord.nextOperation(AIA.tenantKey), null);
        coord.beginBatch('b2', {});
        assert.equal(coord.nextOperation(AIA.tenantKey), 'signup');
    });

    test('endBatch clears state', () => {
        coord.beginBatch('b1', { [AIA.tenantKey]: { accountState: 'ready' } });
        coord.endBatch();
        assert.equal(coord.currentBatchId(), null);
        assert.equal(coord.stateFor(AIA.tenantKey), 'unknown');
    });
});

// ── Workday step detection ─────────────────────────────────────────────────
// Measured on Mondelez's Create Account page
// (wd3.myworkdaysite.com/en-US/recruiting/mdlz/External/.../apply/autofillWithResume):
// `jobTitleHeading` is a visible <h2> carrying the job title, and the degree
// field is absent. It is rendered on EVERY page of the apply flow, so it can
// never identify a step.
describe('workday recipe steps are mutually exclusive', () => {
    const wd = FALLBACK_RECIPES.find((r) => r.ats === 'workday');
    /** Which step a page with `present` selectors resolves to — the same
     *  first-match rule applyRecipeFields uses. */
    const stepFor = (present) => wd.steps.find(
        (s) => s.detect.split(',').some((sel) => present.includes(sel.trim())),
    )?.name || null;

    test('the job-title heading identifies no step at all', () => {
        assert.equal(stepFor(['[data-automation-id="jobTitleHeading"]']), null,
            'it is on every page of the flow, including Create Account');
    });

    test('Application Questions is not swallowed by My Experience', () => {
        // The real regression: `find()` takes the FIRST match, so while
        // jobTitleHeading was an alternative detect for My Experience, the
        // questions page resolved to My Experience and its notice-period and
        // salary fields were never filled on any job.
        assert.equal(stepFor([
            '[data-automation-id="jobTitleHeading"]',
            '[data-automation-id="applyFlowPrimaryQuestionsPage"]',
        ]), 'Application Questions');
    });

    test('each step still matches its own page', () => {
        assert.equal(stepFor(['[data-automation-id="formField-legalName--firstName"]']), 'My Information');
        assert.equal(stepFor(['[data-automation-id="formField-degree"]']), 'My Experience');
        assert.equal(stepFor(['[data-automation-id="applyFlowPrimaryQuestionsPage"]']), 'Application Questions');
    });

    test('the résumé-upload page is a step, so something can advance it', () => {
        // Step 1 of 6 had no entry at all. That page carries no form fields — a
        // dropzone and "Continue" — so with no step matched there was no `advance`
        // selector to click, and the agent is deliberately not handed a fieldless
        // page to plan against. A run that logged in and uploaded the CV then sat
        // there until the stuck-detector ended it.
        assert.equal(stepFor(['[data-automation-id="applyFlowAutoFillPage"]']), 'Autofill with Resume');
        const step = wd.steps.find(s => s.name === 'Autofill with Resume');
        assert.ok(step.advance, 'without this there is nothing to click');
        assert.ok(step.advanceWhen, 'and without this it clicks Continue before the CV attaches');
    });

    test('the upload page never shadows a real form step', () => {
        // Workday keeps the /apply/autofillWithResume URL for the whole wizard, so
        // if that page container outlives the step it names, first-match order is
        // the only thing keeping My Information reachable. Hence: listed last.
        assert.equal(stepFor([
            '[data-automation-id="applyFlowAutoFillPage"]',
            '[data-automation-id="formField-legalName--firstName"]',
        ]), 'My Information');
        assert.equal(wd.steps[wd.steps.length - 1].name, 'Autofill with Resume',
            'order is the mechanism — keep it last');
    });
});

// ── option matching must not guess a discipline ────────────────────────────
// Measured on Mondelez's Degree list (19 named qualifications, no generic
// "Bachelor's Degree"). A plain substring match on "Bachelor" hits eleven of
// them and would take the first — Architecture — as the degree of someone who
// studied Marketing. That is a false credential on a real application.
describe('unambiguous option matching', () => {
    const DEGREES = [
        'A.A. - Associate of Arts or equivalent',
        'B.Arch - Bachelor of Architecture or equivalent',
        'B.B.A. - Bachelor of Business Administration or equivalent',
        'B.S. - Bachelor of Science or equivalent',
        'B.A. - Bachelor of Arts or equivalent',
    ].map(t => t.toLowerCase());

    /** Mirrors fillCustomSelect's uniqueMatch. */
    const uniqueMatch = (list, wanted) => {
        const exact = list.filter(o => o === wanted);
        if (exact.length) return exact[0];
        const prefix = list.filter(o => o.startsWith(wanted));
        if (prefix.length === 1) return prefix[0];
        const contains = list.filter(o => o.includes(wanted));
        return contains.length === 1 ? contains[0] : null;
    };

    test('"bachelor" is ambiguous and therefore answers nothing', () => {
        assert.equal(uniqueMatch(DEGREES, 'bachelor'), null,
            'eleven disciplines contain it; picking the first is a fabricated credential');
    });

    test('a specific degree the candidate stated does match', () => {
        assert.equal(uniqueMatch(DEGREES, 'b.b.a.'),
            'b.b.a. - bachelor of business administration or equivalent');
    });

    test('an exact option always wins over a longer one containing it', () => {
        const opts = ['mobile', 'mobile - personal', 'mobile - work'];
        assert.equal(uniqueMatch(opts, 'mobile'), 'mobile');
    });

    test('a unique substring is still accepted', () => {
        const opts = ['company website', 'contacted by recruiter', 'job board'];
        assert.equal(uniqueMatch(opts, 'company website'), 'company website');
        assert.equal(uniqueMatch(opts, 'recruiter'), 'contacted by recruiter');
    });
});

// ── structured CV resolution ───────────────────────────────────────────────
// The flat profile has ONE `highestDegree` string. Workday's My Experience step
// asks for the school, the qualification, the subject, the grade and a language
// proficiency as five separate REQUIRED fields — and Workday's own résumé parse
// left every one of them blank (measured on a live Mondelez application). No
// amount of widening a flat shape fixes that: the next tenant asks for a second
// education entry, or three employment rows.
describe('cvPath reaches what the flat profile cannot', () => {
    const CV = {
        education: [
            { institution: 'University of Illinois at Urbana-Champaign', degree: 'Marketing', year: '2021 – 2025' },
            { institution: 'Somewhere Else', degree: 'Diploma', year: '2019' },
        ],
        languages: [{ language: 'English', level: 'Fluent' }],
        experience: [{ company: 'XGX', title: 'Product Manager / AI Operations' }],
    };
    /** Mirrors readCvPath in recipe.js. */
    const read = (cv, path) => {
        if (!cv || !path) return undefined;
        let node = cv;
        for (const part of String(path).split('.')) {
            const m = part.match(/^([^[\]]+)(?:\[(\d+)\])?$/);
            if (!m || node == null) return undefined;
            node = node[m[1]];
            if (m[2] != null) node = Array.isArray(node) ? node[Number(m[2])] : undefined;
        }
        return node;
    };

    test('reads an indexed entry', () => {
        assert.equal(read(CV, 'education[0].institution'), 'University of Illinois at Urbana-Champaign');
        assert.equal(read(CV, 'education[0].degree'), 'Marketing');
    });

    test('reaches entries a flat profile has no key for at all', () => {
        assert.equal(read(CV, 'education[1].institution'), 'Somewhere Else');
        assert.equal(read(CV, 'languages[0].level'), 'Fluent');
        assert.equal(read(CV, 'experience[0].company'), 'XGX');
    });

    test('a missing path is undefined, not a crash', () => {
        assert.equal(read(CV, 'education[9].institution'), undefined);
        assert.equal(read(CV, 'nope.deep[0].x'), undefined);
        assert.equal(read(null, 'education[0].degree'), undefined);
        assert.equal(read(CV, ''), undefined);
    });
});
