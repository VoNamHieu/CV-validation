// AUTO-SPLIT from content-agent.js (Phase 2). Part of the Copo apply agent.
import { overlayClick, setNativeValue, sleep } from './dom.js';
import { isThirdPartyApply } from './detect.js';
import { classifyConsent, evaluateConsent } from './policy.js';
import { authResult, classifyDomError, detectChallenge } from '../ats/classifier.js';

// Fill a login field the React-correct way: setNativeValue drives the value
// through the native setter so React's valueTracker registers the change (a plain
// value-set is swallowed). Then a keydown/keyup nudge marks the field "touched"
// so Workday enables the submit button — which stayed inert on a bare fill.
function _typeInto(el, value) {
    if (!el) return false;
    el.focus();
    setNativeValue(el, value);
    const last = String(value).slice(-1) || 'x';
    el.dispatchEvent(new KeyboardEvent('keydown', { key: last, bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: last, bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return String(el.value ?? '').length > 0;
}

const _vis = (e) => !!(e && e.offsetParent !== null);
const _q = (sel) => { try { return sel ? document.querySelector(sel) : null; } catch { return null; } };

// Find the email/username input: recipe selector first, then id/name/label/aria
// heuristic (Workday's is <input type="text" id="email" data-automation-id="email">
// with no linked <label for>, so we also read the field's own attributes + any
// associated label text).
function _findEmailField(recipeSel) {
    const bySel = _q(recipeSel);
    if (_vis(bySel)) return bySel;
    const typed = document.querySelector('input[type="email"]');
    if (_vis(typed)) return typed;
    const cands = [...document.querySelectorAll('input[type="text"], input:not([type])')].filter(_vis);
    for (const e of cands) {
        let lbl = '';
        if (e.id) { const l = document.querySelector(`label[for="${CSS.escape(e.id)}"]`); lbl = (l?.textContent || '').toLowerCase(); }
        const attr = ((e.name || '') + (e.id || '') + (e.getAttribute('aria-label') || '') +
            (e.placeholder || '') + (e.getAttribute('data-automation-id') || '') + ' ' + lbl).toLowerCase();
        if (/e-?mail|user\s*name|username|tài khoản/.test(attr)) return e;
    }
    return null;
}

// The consent vocabulary used to live here as a private pair of regexes. It now
// belongs to policy.js: the same distinction (delegated terms vs marketing vs an
// application's own consent) has to hold for the planner and the recipe too, and
// two copies of a safety rule is one copy too many.

function _labelTextFor(box) {
    return (
        (box.id && document.querySelector(`label[for="${CSS.escape(box.id)}"]`)?.textContent)
        || box.closest('label')?.textContent
        || box.getAttribute('aria-label')
        || ''
    ).trim();
}

/**
 * Tick the mandatory consent boxes on a create-account form.
 *
 * Returns the sanitized labels of everything ticked, which is stored as the
 * audit trail for consent given on the user's behalf. Marketing/optional boxes
 * are left alone, always.
 */
function _tickConsent() {
    const accepted = [];
    // Ticking here is delegated by construction: we only reached a login wall
    // holding a credential, and that credential exists only because the user
    // completed the batch-start modal that grants exactly this.
    const ctx = { source: 'login', formKind: 'signup', consentDelegated: true };
    for (const b of [...document.querySelectorAll('input[type="checkbox"]')].filter(_vis)) {
        if (b.checked) continue;
        const raw = _labelTextFor(b);
        if (!evaluateConsent({ text: raw, label: raw, type: 'checkbox' }, ctx).allowed) continue;
        b.click();
        if (!b.checked) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); }
        // Trimmed + capped: evidence of WHAT was accepted, not a DOM dump.
        accepted.push(raw.replace(/\s+/g, ' ').slice(0, 120));
    }
    return accepted;
}

/**
 * A required consent we could NOT classify — e.g. a country-specific declaration
 * the user must personally affirm. Distinct from the terms box: the user
 * delegated the standard terms, not an arbitrary legal statement about them.
 */
function _hasUnhandledRequiredConsent() {
    return [...document.querySelectorAll('input[type="checkbox"][required], input[type="checkbox"][aria-required="true"]')]
        .filter(_vis)
        .some((b) => {
            if (b.checked) return false;
            const raw = _labelTextFor(b);
            // Anything that is neither the delegated terms box nor a marketing
            // opt-in blocks the signup: a personal declaration ('declaration') and
            // a box we cannot place ('other') both need the user, so the test is
            // "not one of the two we know how to handle" rather than a single kind.
            const kind = classifyConsent({ text: raw, label: raw });
            return kind !== 'terms' && kind !== 'marketing';
        });
}

// A form-switch toggle link ("Already have an account? Sign In" on a create form,
// or vice-versa) matched by text, excluding the header's utility Sign-In button.
function _findToggle(verbRe) {
    return [...document.querySelectorAll('a, button, [role="button"]')].find(e => {
        if (!_vis(e)) return false;
        if (e.closest('header, nav, [data-automation-id^="utilityButton"], [data-automation-id^="navigationItem"]')) return false;
        const aid = e.getAttribute('data-automation-id') || '';
        if (aid === 'createAccountSubmitButton' || aid === 'signInSubmitButton') return false; // those are submits, not toggles
        return verbRe.test((e.textContent || '').trim().toLowerCase());
    }) || null;
}

// The submit button for THIS login form, scoped so we never click the page
// header's "Sign In" utility button (Workday renders one, and it sits before the
// real form button in the DOM). Prefers a real submit in the password's form.
function _findSubmit(pwEl, verbRe) {
    const form = pwEl.closest('form');
    const submitInForm = form && [...form.querySelectorAll('button[type="submit"], input[type="submit"]')].find(_vis);
    if (submitInForm) return submitInForm;
    const scopeEl = form || document;
    return [...scopeEl.querySelectorAll('button, [role="button"], input[type="submit"]')].find(e => {
        if (!_vis(e)) return false;
        // Skip nav/header utility buttons (utilityButtonSignIn, navigationItem-*).
        if (e.closest('header, nav, [data-automation-id^="utilityButton"], [data-automation-id^="navigationItem"]')) return false;
        const t = (e.textContent || e.value || '').toLowerCase();
        return verbRe.test(t) && !isThirdPartyApply(e);
    }) || null;
}

/** Is a login/signup wall on screen right now? */
export function detectLoginWall(login) {
    const recipePw = _q(login?.passwordSelector);
    const pwFields = [...document.querySelectorAll('input[type="password"]')].filter(_vis);
    if (_vis(recipePw) && !pwFields.includes(recipePw)) pwFields.push(recipePw);
    if (!pwFields.length) return null;
    const scope = (document.body?.innerText || '').toLowerCase().slice(0, 5000);
    if (!/\b(sign in|log in|login|sign up|signup|register|create (an )?account|đăng nhập|đăng ký|tạo tài khoản)\b/.test(scope)) {
        return null;
    }
    return { pwFields };
}

/** Switch the form between sign-in and create-account. Returns true if it acted. */
function _switchForm(to) {
    const toggle = to === 'signin'
        ? (_q('[data-automation-id="signInLink"]') || _findToggle(/\bsign in\b|\blog in\b|đăng nhập/))
        : (_q('[data-automation-id="createAccountLink"]') || _findToggle(/create (an )?account|sign up|register|đăng ký|tạo tài khoản/));
    if (!_vis(toggle)) return false;
    toggle.click();
    return true;
}

/** Which form are we currently looking at? */
function _formKind(pwFields) {
    if (pwFields.length >= 2) return 'signup';                     // password + verify
    if (_vis(_q('[data-automation-id="createAccountSubmitButton"]'))) return 'signup';
    return 'signin';
}

/**
 * Handle a login / sign-up wall, and REPORT WHAT HAPPENED.
 *
 * This is the only place the agent touches a password box, and it fills only the
 * user's own stored value. `operation` comes from the background coordinator
 * ('signup' for a tenant we've never authenticated at, 'login' for one we have)
 * — the content script never decides on its own how many times to try.
 *
 * Returns a normalized AtsAuthResult (see ats/classifier.js), or
 *   { pending: true } when it switched forms and needs another pass, or
 *   null when there was no wall to handle.
 *
 * The verdict deliberately errs vague: `unknown_error` leaves the tenant's state
 * untouched, whereas `invalid_credentials` blocks it and asks the user for a
 * password — so we only return the latter on an explicit credentials error.
 */
export async function handleLoginWall(creds, login, operation = 'login') {
    if (!creds || !creds.password) return null;
    const wall = detectLoginWall(login);
    if (!wall) return null;
    const { pwFields } = wall;

    // A challenge beats everything: we cannot and must not try to solve it.
    if (detectChallenge()) {
        return authResult(operation, 'challenge_required', 'dom', { sourceCode: 'captcha' });
    }

    // Put ourselves on the form the coordinator asked for. Switching is free —
    // filling the WRONG form is what costs an attempt (a signup against an
    // existing account, or a login for an account that doesn't exist yet).
    const kind = _formKind(pwFields);
    const want = operation === 'signup' ? 'signup' : 'signin';
    if (kind !== want && _switchForm(want)) {
        console.log(`[Copo Agent] login wall: switching to ${want} form`);
        return { pending: true };
    }

    const isCreate = _formKind(pwFields) === 'signup';
    const emailEl = _findEmailField(login?.emailSelector);
    if (emailEl && creds.email) await _typeInto(emailEl, creds.email);
    // Fill EVERY visible password box with the same value: a create-account form
    // (Workday) has Password + "Verify New Password" and both must match; a plain
    // sign-in form has one, so this is a no-op difference there.
    for (const pw of pwFields) await _typeInto(pw, creds.password);
    await sleep(300);

    let consentAccepted = null;
    if (isCreate) {
        consentAccepted = _tickConsent();
        await sleep(150);
        // A required box we can't classify is the user's call, not ours.
        if (_hasUnhandledRequiredConsent()) {
            return authResult('signup', 'consent_required', 'dom', {
                sourceCode: 'unclassified_required_consent', consentAccepted,
            });
        }
    }

    const createBtn = _q('[data-automation-id="createAccountSubmitButton"]');
    let btn;
    if (isCreate) {
        btn = _vis(createBtn) ? createBtn
            : _findSubmit(pwFields[0], /create account|sign up|register|đăng ký|tạo tài khoản/);
    } else {
        btn = _q(login?.signInSelector);
        if (!_vis(btn)) btn = _findSubmit(pwFields[0], /sign in|log in|login|continue|next|đăng nhập|tiếp tục/);
    }
    if (btn) {
        // overlayClick clicks the TOPMOST element at the button's centre — Workday
        // overlays the submit with a "click_filter" div that owns the handler, so
        // clicking the <button> underneath is ignored. Pure JS; no debugger needed.
        // Declared as the login flow so the policy's account-creation rule lets
        // this through: it is the sanctioned path, running under the background's
        // per-tenant attempt budget.
        overlayClick(btn, { source: 'login', formKind: isCreate ? 'signup' : 'signin' });
        console.log(`[Copo Agent] login wall (${isCreate ? 'create-account' : 'sign-in'}): filled + submitted `
            + `[${btn.getAttribute?.('data-automation-id') || 'button'}]`);
    } else {
        // No button — press Enter (works on simple forms; ignored by hardened ones).
        const pw0 = pwFields[0];
        pw0.focus();
        for (const type of ['keydown', 'keypress', 'keyup']) {
            pw0.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }
        console.log(`[Copo Agent] login wall (${isCreate ? 'create-account' : 'sign-in'}): filled, no button — submitted via Enter`);
    }

    return await _observeOutcome(isCreate ? 'signup' : 'login', login, consentAccepted);
}

/**
 * Wait for the page to answer, then classify it.
 *
 * Success is "the password field is gone and no error appeared" — a navigation
 * or an SPA re-render past the wall. The old code just assumed success here,
 * which is why a wrong password looked identical to a good one.
 */
async function _observeOutcome(operation, login, consentAccepted) {
    const DEADLINE = Date.now() + 15000;
    let lastError = null;

    while (Date.now() < DEADLINE) {
        await sleep(700);

        if (detectChallenge()) {
            return authResult(operation, 'challenge_required', 'dom', {
                sourceCode: 'captcha', consentAccepted,
            });
        }

        const err = classifyDomError();
        if (err && err.code !== 'unrecognized_error') {
            return authResult(operation, err.outcome, 'dom', {
                sourceCode: err.code, consentAccepted,
            });
        }
        if (err) lastError = err;

        // Wall gone → we're through. Signup often lands on a "check your email"
        // interstitial, which classifyDomError catches above as
        // verification_required before we ever get here.
        if (!detectLoginWall(login)) {
            return authResult(operation, 'success', 'dom', { consentAccepted });
        }
    }

    // Still on the wall with nothing we recognise. Report the ambiguity honestly:
    // unknown_error leaves the tenant's state alone rather than telling the user
    // their password is wrong on a guess.
    return authResult(operation, 'unknown_error', 'dom', {
        sourceCode: lastError?.code || 'timeout_on_wall', consentAccepted,
    });
}
