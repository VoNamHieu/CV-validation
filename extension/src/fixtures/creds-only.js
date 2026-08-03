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

export function initFixture() {
    // No seeding. The banner is the build's identity check — if you don't see
    // it, you are not on the creds build; if you see it in a ship build, stop.
    try {
        console.warn('[Copo] ⚠️ LOCAL-CREDS BUILD — reads jobfitApplyCredentials from storage; '
            + 'no fixture data is seeded. Not for shipping.');
    } catch { /* no console here — nothing to announce to */ }
}

const CREDENTIAL_KEY = 'jobfitApplyCredentials';

/** Same contract as the fixture's reader: `{ email, password }`, optional
 *  `operation: 'signup'`; one credential covers every tenant. */
export async function readFixtureCredential() {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return null;
    const got = await chrome.storage.local.get(CREDENTIAL_KEY);
    const c = got?.[CREDENTIAL_KEY];
    if (!c?.email || !c?.password) return null;
    return {
        email: String(c.email),
        password: String(c.password),
        operation: c.operation === 'signup' ? 'signup' : 'login',
    };
}

export const FIXTURE_CREDS_SUPPORTED = true;
