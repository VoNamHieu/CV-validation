/**
 * Test ATS accounts for the fixture builds — TEMPLATE.
 *
 * Copy to `creds.local.js` (gitignored) and fill in. build.mjs resolves the
 * import to THIS file when the local one is absent, so a fresh clone builds with
 * no credentials rather than failing.
 *
 * Why not in the repo: this repository is public, and a password committed once
 * stays in the history after it is deleted. The values live on the machine that
 * runs the tests; only their SHAPE is tracked.
 *
 * `login` is an account that already exists on the ATS — supplying it tells the
 * coordinator to skip its signup-first probe. `signup` is the account to
 * REGISTER on a tenant where none exists yet; keep it a fresh address (Gmail's
 * `+tag` form gives you an unlimited supply that all deliver to one inbox).
 *
 * MODE picks which one a run uses:
 *   'login'  → the tenant is marked ready and the agent signs in
 *   'signup' → the coordinator's signup-first order stands and the agent registers
 *
 * A credential in `chrome.storage.local.jobfitApplyCredentials` still overrides
 * both, so the console one-liner keeps working for a one-off.
 */

export const FIXTURE_CREDENTIALS = {
    login: null,   // { email: 'you+ats@gmail.com', password: '…' }
    signup: null,  // { email: 'you+ats-signup@gmail.com', password: '…' }
};

export const FIXTURE_CREDENTIAL_MODE = 'login';
