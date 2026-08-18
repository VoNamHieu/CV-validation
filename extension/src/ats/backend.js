// Backend client for ATS candidate accounts (background-only).
//
// Credentials are fetched JUST IN TIME — one tenant, immediately before the
// agent authenticates — and held in a local variable for the duration of that
// operation. Nothing here writes a password to chrome.storage.local; the old
// `jobfitApplyCredentials` blob sat there indefinitely, which is exactly what
// this replaces.
//
// Auth is the JWT the web app syncs (jobfitToken, refreshed on every Supabase
// auth-state change). A 401 means the token went stale mid-batch, which is
// reported distinctly so the caller can tell the user to re-open the web app
// rather than blaming the tenant.

import { tenantRefFor } from './tenant.js';

async function appOrigin() {
    const { jobfitAppUrl } = await chrome.storage.local.get('jobfitAppUrl');
    return jobfitAppUrl || 'https://copoai.net';
}

async function authHeaders() {
    const { jobfitToken } = await chrome.storage.local.get('jobfitToken');
    if (!jobfitToken) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${jobfitToken}` };
}

/**
 * Tenant verdicts for a batch, plus whether a default credential exists at all.
 * → { ok, hasDefaultCredential, states: {tenantKey: account}, auth?, error? }
 *
 * Fails OPEN on transport errors: a backend hiccup must not stop the user
 * applying to jobs that need no account. Callers treat an absent verdict as
 * `unknown` and let the tenant probe as usual.
 */
export async function resolveTenants(jobs, atsVendor = 'workday') {
    const refs = new Map();
    for (const job of jobs) {
        const ref = tenantRefFor(job.jobUrl);
        if (ref && ref.atsVendor === atsVendor) refs.set(ref.tenantKey, ref);
    }
    if (refs.size === 0) return { ok: true, hasDefaultCredential: true, states: {} };

    const headers = await authHeaders();
    if (!headers) return { ok: false, auth: true, states: {} };

    try {
        const res = await fetch(`${await appOrigin()}/api/me/ats-accounts/resolve`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                atsVendor,
                tenants: [...refs.values()].map((r) => ({
                    tenantKey: r.tenantKey,
                    canonicalHost: r.canonicalHost,
                    careerSiteKey: r.careerSiteKey,
                })),
            }),
        });
        if (res.status === 401) return { ok: false, auth: true, states: {} };
        if (!res.ok) return { ok: false, states: {} };
        const body = await res.json();
        const states = {};
        for (const acct of body.accounts || []) states[acct.tenantKey] = acct;
        return { ok: true, hasDefaultCredential: !!body.hasDefaultCredential, states };
    } catch (e) {
        console.warn('[Copo ATS] resolve failed (fail-open):', e?.message || e);
        return { ok: false, states: {} };
    }
}

/**
 * The credential for ONE tenant, decrypted server-side. Also records first
 * contact with the tenant, so the auth-result that follows has a row to attach
 * to.
 *
 * → { ok, email, password, credentialId, accountState } | { ok:false, ... }
 * `revoked:true` means the credential was killed (compromise) and the tenant now
 * needs a fresh one from the user — never retry with what we had.
 */
export async function fetchCredential(tenantRef) {
    const headers = await authHeaders();
    if (!headers) return { ok: false, auth: true };

    const params = new URLSearchParams({ atsVendor: tenantRef.atsVendor });
    if (tenantRef.canonicalHost) params.set('canonicalHost', tenantRef.canonicalHost);
    if (tenantRef.careerSiteKey) params.set('careerSiteKey', tenantRef.careerSiteKey);

    try {
        const res = await fetch(
            `${await appOrigin()}/api/me/ats-accounts/${encodeURIComponent(tenantRef.tenantKey)}`
            + `/credential/for-apply?${params}`,
            { headers },
        );
        if (res.status === 401) return { ok: false, auth: true };
        if (res.status === 404) return { ok: false, missing: true };
        if (res.status === 409) return { ok: false, revoked: true };
        if (res.status === 503) return { ok: false, disabled: true };
        if (!res.ok) return { ok: false };
        const body = await res.json();
        return {
            ok: true,
            email: body.email,
            password: body.password,
            credentialId: body.credentialId,
            credentialPinned: !!body.credentialPinned,
            accountState: body.accountState,
        };
    } catch (e) {
        console.warn('[Copo ATS] credential fetch failed:', e?.message || e);
        return { ok: false };
    }
}

/**
 * Report a normalized auth outcome and get the tenant's new state back.
 *
 * `idempotencyKey` makes a network retry safe: the attempt log rejects the
 * duplicate instead of double-counting an attempt that already landed.
 */
export async function reportAuthResult(tenantRef, result, opts = {}) {
    const headers = await authHeaders();
    if (!headers) return { ok: false, auth: true };
    try {
        const res = await fetch(
            `${await appOrigin()}/api/me/ats-accounts/${encodeURIComponent(tenantRef.tenantKey)}/auth-results`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    atsVendor: tenantRef.atsVendor,
                    operation: result.operation,
                    outcome: result.outcome,
                    source: result.source,
                    sourceCode: result.sourceCode,
                    retryable: !!result.retryable,
                    retryAfterSeconds: result.retryAfterSeconds,
                    consentAccepted: result.consentAccepted,
                    credentialId: opts.credentialId,
                    batchId: opts.batchId,
                    idempotencyKey: opts.idempotencyKey,
                    automationVersion: opts.automationVersion,
                    canonicalHost: tenantRef.canonicalHost,
                    careerSiteKey: tenantRef.careerSiteKey,
                }),
            },
        );
        if (res.status === 401) return { ok: false, auth: true };
        if (!res.ok) return { ok: false };
        return { ok: true, account: await res.json() };
    } catch (e) {
        console.warn('[Copo ATS] auth-result report failed:', e?.message || e);
        return { ok: false };
    }
}
