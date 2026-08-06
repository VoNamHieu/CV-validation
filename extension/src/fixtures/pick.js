/**
 * Which account a fixture build uses, as a pure decision.
 *
 * Two sources, and the order matters: `chrome.storage.local.jobfitApplyCredentials`
 * is the one-off override a developer pastes into the console, and the built-in
 * accounts (creds.local.js — gitignored) are the standing test data so that
 * paste is no longer required before every run. Storage wins where it is
 * complete; a half-filled storage entry is not a credential and falls through
 * rather than sending the agent at a login form with a blank password.
 *
 * Kept separate from the data it selects so the RULE can be tested with literals
 * — the values themselves live outside the repo and no test may depend on them.
 */

const complete = (c) => !!(c && c.email && c.password);

/**
 * @param {object|null} stored   whatever is in storage under the credential key
 * @param {object|null} builtIn  `{ login, signup }` from the local creds module
 * @param {string}      mode     which built-in account to use ('login' | 'signup')
 * @returns {{email: string, password: string, operation: 'login'|'signup'}|null}
 */
export function pickCredential(stored, builtIn, mode = 'login') {
    if (complete(stored)) {
        return {
            email: String(stored.email),
            password: String(stored.password),
            // Default LOGIN, not signup. Supplying a credential is a statement
            // that the account already exists, and the coordinator's signup-first
            // probe is for tenants where that is unknown.
            operation: stored.operation === 'signup' ? 'signup' : 'login',
        };
    }
    const op = mode === 'signup' ? 'signup' : 'login';
    const c = builtIn?.[op];
    if (!complete(c)) return null;
    return { email: String(c.email), password: String(c.password), operation: op };
}
