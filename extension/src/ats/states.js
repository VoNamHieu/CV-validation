// Shared ATS account-state vocabulary. Mirrors backend/app/db/ats_tenant_accounts.py
// (STATES / BLOCKING_STATES) — the two must stay in step, since the backend
// rejects any state or outcome it doesn't recognise.

export const ACCOUNT_STATES = [
    'unknown', 'ready', 'verification_required', 'credential_required',
    'password_reset_required', 'consent_required', 'challenge_required',
    'temporarily_locked', 'unsupported',
];

/** States that need the USER to act. The runner never retries these on its own —
 *  polling a tenant that's waiting on an email verification is how accounts get
 *  locked. `temporarily_locked` is excluded: it clears itself once next_retry_at
 *  passes, so the runner handles it by backoff rather than by asking the user. */
export const BLOCKING_STATES = new Set([
    'verification_required', 'credential_required', 'password_reset_required',
    'consent_required', 'challenge_required', 'unsupported',
]);

/** Auth outcomes the backend accepts. Anything else is rejected outright. */
export const OUTCOMES = [
    'success', 'account_exists', 'invalid_credentials', 'verification_required',
    'password_reset_required', 'consent_required', 'challenge_required',
    'temporarily_locked', 'rate_limited', 'unsupported', 'transient_error',
    'unknown_error',
];
