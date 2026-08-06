// AUTO-SPLIT from content-agent.js (Phase 2). Part of the Copo apply agent.
import { safeActivate, setNativeValue, sleep } from './dom.js';
import { isThirdPartyApply } from './detect.js';
import { evaluateConsent } from './policy.js';
import { trace } from './trace.js';
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
// belongs to policy.js: the same distinction (a marketing opt-in vs everything
// else) has to hold for the planner and the recipe too, and two copies of a
// safety rule is one copy too many.

/**
 * What the page's error banner actually says, for the LOCAL trace only.
 *
 * classifyDomError deliberately returns a code and no words, because its value
 * is sent to the backend and auth banners echo the account's email. This reads
 * the same nodes for the console, where nothing is transmitted — and "the ATS
 * said Account locked" is the difference between a fix and another guess at
 * `unrecognized_error`.
 */
function _visibleErrorText() {
    try {
        return [...document.querySelectorAll(
            '[data-automation-id="errorMessage"], [data-automation-id*="errorMessage"], '
            + '[data-automation-id="inputAlert"], '
            + '[role="alert"], .css-error, [data-automation-id="alertMessage"]')]
            .filter(_vis)
            .map(n => n.textContent || '')
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 240) || null;
    } catch { return null; }
}

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
    for (const b of [...document.querySelectorAll('input[type="checkbox"]')].filter(_vis)) {
        if (b.checked) continue;
        const raw = _labelTextFor(b);
        if (!evaluateConsent({ text: raw, label: raw, type: 'checkbox' }).allowed) continue;
        safeActivate(b, { source: 'login', activation: 'widget-option' });
        if (!b.checked) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); }
        // Trimmed + capped: evidence of WHAT was accepted, not a DOM dump.
        accepted.push(raw.replace(/\s+/g, ' ').slice(0, 120));
    }
    return accepted;
}

/**
 * A required consent still unticked after the pass above.
 *
 * The pass ticks everything that is not marketing, so in practice this catches
 * two things: a required MARKETING box (an opt-in we will not give, and a signup
 * that demands one is a signup we do not complete), and a box the tick did not
 * take. Either way the account cannot be created without the user, and saying so
 * beats submitting a form whose required consent is blank.
 */
function _hasUnhandledRequiredConsent() {
    return [...document.querySelectorAll('input[type="checkbox"][required], input[type="checkbox"][aria-required="true"]')]
        .filter(_vis)
        .some(b => !b.checked);
}

/**
 * Recipe-driven EXTRA signup fields + consent dialog, for ATSes whose create-
 * account form asks for more than email/password (SuccessFactors, measured on
 * EY 2026-08-05: retype email, name, phone country code, phone, country of
 * residence — and a data-privacy statement that is a DIALOG, not a checkbox).
 *
 * The dialog dance is SF's `validateAndOpenDpcsDialog`: the opener VALIDATES the
 * whole form first (so this runs after every field is filled), then a JUIC
 * dialog fetches the country-specific statement; its buttons carry session-
 * random ids (dlgButton_NN:) so the accept is matched by TEXT. Accepting writes
 * the statement id into a hidden input — that input being non-empty is the only
 * commit signal, and what `committedInput` checks.
 *
 * Declared per-recipe (recipe.signup), all-JSON so it can sync from the web app.
 */
async function _runSignupExtras(signup, creds, profile) {
    let filled = 0;
    for (const f of signup.fields || []) {
        const el = _q(f.selector);
        if (!_vis(el)) { trace('login.signupField', { sel: f.selector, state: 'absent' }); continue; }
        const value = f.from === 'email' ? (creds.email || '')
            : f.profileKey ? (profile?.[f.profileKey] || f.default || '')
            : (f.value ?? f.default ?? '');
        if (!String(value).trim()) { trace('login.signupField', { sel: f.selector, state: 'no value' }); continue; }
        if (String(el.value || '').trim()) continue;   // idempotent on a re-pass
        if (el.tagName === 'SELECT') {
            el.value = String(value);
            el.dispatchEvent(new Event('change', { bubbles: true }));
            if (el.value !== String(value)) { trace('login.signupField', { sel: f.selector, state: 'option missing' }); continue; }
        } else {
            _typeInto(el, String(value));
        }
        filled++;
    }
    const dlg = signup.consentDialog;
    if (!dlg) return { filled, consentOk: null };
    const committed = () => String(_q(dlg.committedInput)?.value || '').trim() !== '';
    if (committed()) return { filled, consentOk: true };
    const opener = _q(dlg.open);
    if (_vis(opener) && safeActivate(opener, { source: 'login', activation: 'page-action' })) {
        const acceptRe = new RegExp(dlg.acceptText, 'i');
        const by = Date.now() + 5000;
        let btn = null;
        while (!btn && Date.now() < by) {
            await sleep(250);
            btn = [...document.querySelectorAll('button, input[type="button"], [role="button"]')]
                .find(b => _vis(b) && acceptRe.test((b.textContent || b.value || '')));
        }
        if (btn) {
            // A data-privacy acknowledgement required to create the account —
            // the same class of consent _tickConsent gives on checkboxes, and
            // never a marketing opt-in (those are checkboxes, left alone above).
            safeActivate(btn, { source: 'login', activation: 'widget-option' });
            const by2 = Date.now() + 3000;
            while (!committed() && Date.now() < by2) await sleep(250);
        }
        trace('login.signupConsentDialog', { openerFound: true, acceptFound: !!btn, committed: committed() });
    } else {
        trace('login.signupConsentDialog', { openerFound: _vis(opener), committed: false });
    }
    return { filled, consentOk: committed() };
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
    safeActivate(toggle, { source: 'login', activation: 'page-action' });
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
export async function handleLoginWall(creds, login, operation = 'login', opts = {}) {
    if (!creds || !creds.password) {
        trace('login.abort', { why: 'no credential passed in', hasEmail: !!creds?.email });
        return null;
    }
    const wall = detectLoginWall(login);
    if (!wall) {
        // The single most common way this function does nothing: it is called a
        // beat before (or after) the wall exists. Record what the page looked
        // like, or the next investigation starts from zero again.
        trace('login.noWall', {
            passwordFields: document.querySelectorAll('input[type="password"]').length,
            visiblePasswords: [...document.querySelectorAll('input[type="password"]')].filter(_vis).length,
            bodyHead: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
        });
        return null;
    }
    const { pwFields } = wall;

    // A challenge beats everything: we cannot and must not try to solve it.
    if (detectChallenge()) {
        trace('login.challenge', { operation });
        return authResult(operation, 'challenge_required', 'dom', { sourceCode: 'captcha' });
    }

    // Put ourselves on the form the coordinator asked for. Switching is free —
    // filling the WRONG form is what costs an attempt (a signup against an
    // existing account, or a login for an account that doesn't exist yet).
    const kind = _formKind(pwFields);
    const want = operation === 'signup' ? 'signup' : 'signin';
    trace('login.form', { asked: operation, onScreen: kind, passwordFields: pwFields.length });
    if (kind !== want && _switchForm(want)) {
        trace('login.switch', { from: kind, to: want });
        return { pending: true };
    }
    if (kind !== want) {
        // No toggle found. We are about to fill the wrong kind of form, which is
        // the one thing the switch above exists to prevent — so say so loudly
        // rather than letting it read as a normal fill in the log.
        trace('login.switchFailed', { asked: want, stuckOn: kind });
    }

    const isCreate = _formKind(pwFields) === 'signup';
    const emailEl = _findEmailField(login?.emailSelector);
    const emailOk = !!(emailEl && creds.email) && await _typeInto(emailEl, creds.email);
    // Fill EVERY visible password box with the same value: a create-account form
    // (Workday) has Password + "Verify New Password" and both must match; a plain
    // sign-in form has one, so this is a no-op difference there.
    const pwOk = [];
    for (const pw of pwFields) pwOk.push(await _typeInto(pw, creds.password));
    trace('login.fill', {
        emailFound: !!emailEl,
        emailSelector: emailEl?.getAttribute('data-automation-id') || emailEl?.id || emailEl?.name || null,
        emailAccepted: emailOk,
        passwordsFilled: `${pwOk.filter(Boolean).length}/${pwFields.length}`,
        isCreate,
    });
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
        // Recipe-declared extra fields + consent DIALOG (SuccessFactors). Runs
        // after email/passwords/checkboxes: the dialog opener validates the
        // whole form before it opens, so it must go last. A dialog we could not
        // commit is a consent we did not give — stop and say so, instead of
        // submitting a form whose required acknowledgement is blank.
        if (opts.signup) {
            const extras = await _runSignupExtras(opts.signup, creds, opts.profile || {});
            trace('login.signupExtras', { filled: extras.filled, consentOk: extras.consentOk });
            if (extras.consentOk === false) {
                return authResult('signup', 'consent_required', 'dom', {
                    sourceCode: 'consent_dialog_not_committed', consentAccepted,
                });
            }
            if (extras.consentOk) consentAccepted = [...(consentAccepted || []), 'Data privacy statement (dialog)'];
            await sleep(200);
        }
    }

    const createBtn = _q(login?.createAccountSubmitSelector) || _q('[data-automation-id="createAccountSubmitButton"]');
    let btn;
    if (isCreate) {
        btn = _vis(createBtn) ? createBtn
            : _findSubmit(pwFields[0], /create account|sign up|register|đăng ký|tạo tài khoản/);
    } else {
        btn = _q(login?.signInSelector);
        if (!_vis(btn)) btn = _findSubmit(pwFields[0], /sign in|log in|login|continue|next|đăng nhập|tiếp tục/);
    }
    if (btn) {
        // safeActivate clicks the TOPMOST element at the button's centre — Workday
        // overlays the submit with a "click_filter" div that owns the handler, so
        // clicking the <button> underneath is ignored. Pure JS; no debugger needed.
        // Declared as the login flow so the policy's account-creation rule lets
        // this through: it is the sanctioned path, running under the background's
        // per-tenant attempt budget.
        const clicked = safeActivate(btn, { source: 'login', formKind: isCreate ? 'signup' : 'signin' });
        // safeActivate returns false when the policy refused or the element had no
        // viewport box. Both look exactly like a successful submit from the
        // outside — the page simply does not move — so the flag has to be recorded.
        trace('login.submit', {
            via: btn.getAttribute?.('data-automation-id') || btn.tagName,
            label: (btn.textContent || '').trim().slice(0, 40),
            activated: clicked,
            isCreate,
        });
    } else {
        // No button — press Enter (works on simple forms; ignored by hardened ones).
        const pw0 = pwFields[0];
        pw0.focus();
        for (const type of ['keydown', 'keypress', 'keyup']) {
            pw0.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }
        trace('login.submit', { via: 'Enter key', activated: null, isCreate, why: 'no submit button found' });
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
    const startedAt = Date.now();
    let lastError = null;
    let polls = 0;

    while (Date.now() < DEADLINE) {
        await sleep(700);
        polls++;

        if (detectChallenge()) {
            trace('login.outcome', { verdict: 'challenge_required', afterMs: Date.now() - startedAt });
            return authResult(operation, 'challenge_required', 'dom', {
                sourceCode: 'captcha', consentAccepted,
            });
        }

        const err = classifyDomError();
        if (err && err.code !== 'unrecognized_error') {
            trace('login.outcome', {
                verdict: err.outcome, code: err.code, afterMs: Date.now() - startedAt,
                banner: _visibleErrorText(),
            });
            return authResult(operation, err.outcome, 'dom', {
                sourceCode: err.code, consentAccepted,
            });
        }
        if (err) lastError = err;

        // Wall gone → we're through. Signup often lands on a "check your email"
        // interstitial, which classifyDomError catches above as
        // verification_required before we ever get here.
        if (!detectLoginWall(login)) {
            trace('login.outcome', { verdict: 'success', afterMs: Date.now() - startedAt, polls });
            return authResult(operation, 'success', 'dom', { consentAccepted });
        }
    }

    // The interesting failure: 15s on the same wall with no error text. Capture
    // what the page actually says, because "unknown_error" on its own has now
    // twice sent an investigation looking in the wrong place.
    trace('login.outcome', {
        verdict: 'unknown_error',
        polls,
        stillOnWall: true,
        lastUnrecognisedCode: lastError?.code || null,
        banner: _visibleErrorText(),
        bodyHead: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 220),
    });

    // Still on the wall with nothing we recognise. Report the ambiguity honestly:
    // unknown_error leaves the tenant's state alone rather than telling the user
    // their password is wrong on a guess.
    return authResult(operation, 'unknown_error', 'dom', {
        sourceCode: lastError?.code || 'timeout_on_wall', consentAccepted,
    });
}
