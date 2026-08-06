/**
 * What `./fixtures/dummy.js` resolves to in a `--local-creds` build.
 *
 * The middle bundle (user request 2026-08-02): PRODUCTION data behaviour —
 * nothing is seeded, the fake candidate file is never read, `copoFixture` does
 * not exist — but the LOCAL credential path stays on, so a login flow can be
 * exercised end-to-end with real data before the server-side credential store
 * (ATS_CRED_KEY + migration 015) is stood up. Same resolve-time swap as the
 * other two builds; no runtime flag anywhere.
 *
 * This bundle is TEMPORARY tooling: a password in chrome.storage.local is
 * readable by anything that can reach the extension's storage and survives
 * until removed. Ship builds stay `npm run build`, which ignores the key.
 */

import { pickCredential } from './pick.js';
import { PROFILE_GAP_SEEDS, seedProfileGaps } from './gaps.js';

/**
 * The local accounts, loaded so that their ABSENCE is not a crash.
 *
 * creds.local.js is gitignored (real passwords, public repo). build.mjs
 * resolves the import to the tracked template when it is missing — but
 * `node --test` has no such plugin, so a STATIC import made every test file
 * that reaches this module fail to load on a fresh clone. Measured on CI,
 * where the extension suite reported one failure and 27 fewer tests than
 * local: the whole fixture file never ran. A dynamic import can be caught;
 * a static one cannot.
 */
async function loadLocalCreds() {
    try {
        return await import('./creds.local.js');
    } catch {
        return { FIXTURE_CREDENTIALS: { login: null, signup: null }, FIXTURE_CREDENTIAL_MODE: 'login' };
    }
}


export function initFixture() {
    // The candidate is still the REAL one — this build exists to drive a real
    // profile through a real ATS. What it does seed is the handful of keys no
    // CV carries (GPA, ethnicity, gender, notice period), and only where the
    // profile leaves them empty; each one blocks a REQUIRED field, and they
    // were being pasted into this console before every run.
    try {
        console.warn('[Copo] ⚠️ LOCAL-CREDS BUILD — real profile, test ATS accounts. Not for shipping.');
    } catch { /* no console here — nothing to announce to */ }
    seedProfileGaps(PROFILE_GAP_SEEDS)
        .then(w => w.length && console.warn(`[Copo] fixture filled empty profile keys: ${w.join(', ')}`))
        .catch(() => { /* seeding is convenience, never a run blocker */ });
}

const CREDENTIAL_KEY = 'jobfitApplyCredentials';

/**
 * The account this run uses: `{ email, password, operation }`.
 *
 * Order is storage first, then the built-in test accounts — the console
 * one-liner stays the way to override for a one-off, and with nothing in
 * storage the build still has an account to work with instead of stopping.
 */
export async function readFixtureCredential() {
    let stored = null;
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        const got = await chrome.storage.local.get(CREDENTIAL_KEY);
        stored = got?.[CREDENTIAL_KEY] ?? null;
    }
    const { FIXTURE_CREDENTIALS, FIXTURE_CREDENTIAL_MODE } = await loadLocalCreds();
    return pickCredential(stored, FIXTURE_CREDENTIALS, FIXTURE_CREDENTIAL_MODE);
}

export const FIXTURE_CREDS_SUPPORTED = true;
