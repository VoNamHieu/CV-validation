// AUTO-SPLIT from content-agent.js (Phase 2). Part of the Copo apply agent.
import { setNativeValue, sleep } from './dom.js';
import { isThirdPartyApply } from './detect.js';

// The login credentials synced from the web app (LoginCredentialsBanner), used
// ONLY to sign in / create an account on account-gated ATS (Workday, SF…).
export async function getApplyCredentials() {
    return new Promise(r =>
        chrome.storage.local.get('jobfitApplyCredentials', d => r(d.jobfitApplyCredentials || null)));
}

// When the apply flow hits a login / sign-up wall, fill the page's OWN email +
// password fields with the user's synced credentials and submit — the one place
// the agent is allowed to touch a password box (with the user's value, never a
// page-derived one). Strictly scoped: a visible password field on a page whose
// text reads like a login/signup form. Returns true if it acted; the submit
// navigates, and the redirect-resume re-injects the agent on the next page.
export async function handleLoginWall(creds) {
    if (!creds || !creds.password) return false;
    const pw = [...document.querySelectorAll('input[type="password"]')].find(e => e.offsetParent);
    if (!pw) return false;
    const scope = (document.body?.innerText || '').toLowerCase().slice(0, 5000);
    if (!/\b(sign in|log in|login|sign up|signup|register|create (an )?account|đăng nhập|đăng ký|tạo tài khoản)\b/.test(scope)) {
        return false;
    }
    const emailEl = document.querySelector('input[type="email"]')
        || [...document.querySelectorAll('input[type="text"], input:not([type])')].find(e =>
            e.offsetParent && /email|e-mail|user|username|tài khoản/i.test(
                (e.name || '') + (e.id || '') + (e.getAttribute('aria-label') || '') + (e.placeholder || '')));
    if (emailEl && creds.email) setNativeValue(emailEl, creds.email);
    setNativeValue(pw, creds.password);
    await sleep(400);

    const form = pw.closest('form');
    let btn = form && form.querySelector('button[type="submit"], input[type="submit"]');
    if (!btn || !btn.offsetParent) {
        btn = [...document.querySelectorAll('button, input[type="submit"], [role="button"]')].find(e => {
            if (!e.offsetParent) return false;
            const t = (e.textContent || e.value || '').toLowerCase();
            return /\b(sign in|log in|login|sign up|register|continue|next|create account|đăng nhập|đăng ký|tiếp tục)\b/.test(t)
                && !isThirdPartyApply(e);
        });
    }
    console.log(`[Copo Agent] login wall: filled credentials${btn ? ', submitting' : ' (no submit button)'}`);
    if (btn) btn.click();
    return true;
}
