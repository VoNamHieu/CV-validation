// AUTO-SPLIT from content-agent.js (Phase 2). Part of the Copo apply agent.
import { overlayClick, setNativeValue, sleep } from './dom.js';
import { isThirdPartyApply } from './detect.js';

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

// The login credentials synced from the web app (LoginCredentialsBanner), used
// ONLY to sign in / create an account on account-gated ATS (Workday, SF…).
export async function getApplyCredentials() {
    return new Promise(r =>
        chrome.storage.local.get('jobfitApplyCredentials', d => r(d.jobfitApplyCredentials || null)));
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

// Tick a required consent/terms checkbox (Workday's create-account gate) — only
// boxes whose label reads like an agreement, never arbitrary ones.
function _tickConsent() {
    for (const b of [...document.querySelectorAll('input[type="checkbox"]')].filter(_vis)) {
        if (b.checked) continue;
        const lbl = ((b.id && document.querySelector(`label[for="${CSS.escape(b.id)}"]`)?.textContent) ||
            b.closest('label')?.textContent || b.getAttribute('aria-label') || '').toLowerCase();
        if (/agree|consent|terms|privacy|i have read|acknowledge|đồng ý|điều khoản/.test(lbl)) {
            b.click();
            if (!b.checked) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); }
        }
    }
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

// When the apply flow hits a login / sign-up wall, fill the page's OWN email +
// password fields with the user's synced credentials and submit — the one place
// the agent is allowed to touch a password box (with the user's value, never a
// page-derived one). Strictly scoped: a visible password field on a page whose
// text reads like a login/signup form. `login` is the matched recipe's login
// selectors (exact, verified) when available. Returns true if it acted; the
// submit navigates, and the redirect-resume re-injects the agent on the next page.
export async function handleLoginWall(creds, login) {
    if (!creds || !creds.password) return false;
    const recipePw = _q(login?.passwordSelector);
    const pwFields = [...document.querySelectorAll('input[type="password"]')].filter(_vis);
    if (_vis(recipePw) && !pwFields.includes(recipePw)) pwFields.push(recipePw);
    if (!pwFields.length) return false;
    const scope = (document.body?.innerText || '').toLowerCase().slice(0, 5000);
    if (!/\b(sign in|log in|login|sign up|signup|register|create (an )?account|đăng nhập|đăng ký|tạo tài khoản)\b/.test(scope)) {
        return false;
    }

    // The user reuses ONE account per ATS, so SIGN IN is the default. If we've
    // landed on a create-account form (2 password boxes, or a create-account
    // submit) but a "Sign In" toggle exists, switch to it and sign in on the next
    // pass — creating a duplicate account would just error "account already exists".
    const onCreateForm = pwFields.length >= 2 || _vis(_q('[data-automation-id="createAccountSubmitButton"]'));
    if (onCreateForm) {
        const toggle = _q('[data-automation-id="signInLink"]') || _findToggle(/\bsign in\b|\blog in\b|đăng nhập/);
        if (_vis(toggle)) {
            toggle.click();
            console.log('[Copo Agent] login wall: on create-account form → switching to Sign In (account exists)');
            return true; // re-observe → sign-in form next pass
        }
    }

    const emailEl = _findEmailField(login?.emailSelector);
    if (emailEl && creds.email) await _typeInto(emailEl, creds.email);
    // Fill EVERY visible password box with the same value: a create-account form
    // (Workday) has Password + "Verify New Password" and both must match; a plain
    // sign-in form has one, so this is a no-op difference there.
    for (const pw of pwFields) await _typeInto(pw, creds.password);
    await sleep(300);
    _tickConsent();
    await sleep(150);

    // Create-account form (2 password boxes, or a create-account submit present)
    // vs a plain sign-in form → pick the matching submit button.
    const createBtn = _q('[data-automation-id="createAccountSubmitButton"]');
    const isCreate = pwFields.length >= 2 || _vis(createBtn);
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
        overlayClick(btn);
        console.log(`[Copo Agent] login wall (${isCreate ? 'create-account' : 'sign-in'}): filled + submitted ` +
            `[${btn.getAttribute?.('data-automation-id') || 'button'}]`);
    } else {
        // No button — press Enter (works on simple forms; ignored by hardened ones).
        const pw0 = pwFields[0];
        pw0.focus();
        for (const type of ['keydown', 'keypress', 'keyup']) {
            pw0.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }
        console.log(`[Copo Agent] login wall (${isCreate ? 'create-account' : 'sign-in'}): filled, no button — submitted via Enter`);
    }
    return true;
}
