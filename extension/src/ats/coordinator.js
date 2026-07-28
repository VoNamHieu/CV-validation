// Per-tenant auth state for a running batch (background-only).
//
// The batch queue is strictly sequential — one tab at a time — so there is no
// concurrency to lock against: the first job of a tenant probes, and this holds
// the verdict so every later job of that tenant inherits it instead of hitting
// the login wall again. That "probe once per tenant" rule is what keeps us clear
// of lockouts, far more than anything about which password is used.
//
// Attempt budget per tenant per batch: 1 signup + 1 login + 1 user-triggered
// retry. Counted here, in the background, because a content script's context
// dies on every navigation and can't be trusted to remember how many times it
// has already tried.

import { BLOCKING_STATES } from './states.js';

const MAX_SIGNUP = 1;
const MAX_LOGIN = 1;

/** In-memory per-batch state. Rebuilt from the backend at batch start. */
let tenantStates = {};      // tenantKey → account row from /resolve
let attempts = {};          // tenantKey → { signup, login }
let batchId = null;

export function beginBatch(id, states) {
    batchId = id;
    tenantStates = states || {};
    attempts = {};
}

export function currentBatchId() {
    return batchId;
}

export function endBatch() {
    tenantStates = {};
    attempts = {};
    batchId = null;
}

/**
 * Serialize the runtime so it can outlive the service worker.
 *
 * MV3 recycles an idle worker, and a batch job legitimately takes minutes — so
 * "the worker died mid-batch" is the normal case, not an edge one. Without this
 * the attempt budget and every tenant verdict reset to zero on wake, and the
 * runner cheerfully re-probed a tenant that was already waiting on the user.
 */
export function snapshot() {
    return { batchId, tenantStates, attempts };
}

/** Adopt a snapshot taken before the worker was recycled. */
export function restore(snap) {
    if (!snap) return false;
    batchId = snap.batchId ?? null;
    tenantStates = snap.tenantStates || {};
    attempts = snap.attempts || {};
    return !!batchId;
}

export function stateFor(tenantKey) {
    return tenantStates[tenantKey]?.accountState || 'unknown';
}

export function setState(tenantKey, account) {
    if (!account) return;
    tenantStates[tenantKey] = { ...(tenantStates[tenantKey] || {}), ...account };
}

/**
 * Should the runner skip this job without opening a tab?
 * → { skip: true, reason } when the tenant is waiting on the user, else { skip:false }.
 *
 * Skipping BEFORE the tab opens is deliberate: it costs no credit, no browser
 * tab, and no failed login against a tenant we already know is blocked.
 */
export function gateJob(tenantRef) {
    if (!tenantRef) return { skip: false };
    const account = tenantStates[tenantRef.tenantKey];
    const state = account?.accountState || 'unknown';

    if (BLOCKING_STATES.has(state)) {
        return { skip: true, reason: blockedReason(state), state };
    }
    if (state === 'temporarily_locked') {
        // Honour the backoff deadline; once it passes we may probe again.
        //
        // A MISSING deadline must NOT read as "never". The DOM classifier reports
        // a lockout with no retry-after (Workday's banner carries none), so the row
        // lands with next_retry_at NULL — and treating that as an infinite block
        // stranded the tenant for good: skipped in every later batch, while
        // `temporarily_locked` is deliberately excluded from the "Cần bạn xử lý"
        // list (it is supposed to clear itself) and the accounts panel offers no
        // action. Nothing in the product could get it back. With no deadline we
        // let the per-batch attempt budget do the bounding instead, which is what
        // "temporarily" is supposed to mean.
        const until = account?.nextRetryAt ? Date.parse(account.nextRetryAt) : NaN;
        if (Number.isFinite(until) && Date.now() < until) {
            return { skip: true, reason: 'manual', state };
        }
    }
    if (!budgetLeft(tenantRef.tenantKey)) {
        // Already spent this batch's attempts here without reaching a verdict —
        // stop rather than grind the same tenant.
        return { skip: true, reason: 'manual', state };
    }
    return { skip: false, state };
}

/** UI-facing bucket for a blocked tenant. Never phrased as an error. */
export function blockedReason(state) {
    if (state === 'verification_required') return 'verification';
    if (state === 'credential_required' || state === 'password_reset_required') return 'credential';
    return 'manual';
}

function counters(tenantKey) {
    if (!attempts[tenantKey]) attempts[tenantKey] = { signup: 0, login: 0 };
    return attempts[tenantKey];
}

export function budgetLeft(tenantKey) {
    const c = counters(tenantKey);
    return c.signup < MAX_SIGNUP || c.login < MAX_LOGIN;
}

/**
 * Which auth operation may the agent perform at this tenant right now?
 * → 'signup' | 'login' | null (budget exhausted)
 *
 * Signup-first for an unseen tenant, because Workday's signup gives a
 * DISTINGUISHABLE answer ("account already exists") while a failed login is
 * ambiguous — it looks the same whether the account doesn't exist, the password
 * is wrong, or the account is simply unverified. Probing in the direction that
 * yields a clean signal keeps us to at most two operations either way.
 */
export function nextOperation(tenantKey) {
    const state = stateFor(tenantKey);
    const c = counters(tenantKey);
    if (state === 'ready') return c.login < MAX_LOGIN ? 'login' : null;
    if (c.signup < MAX_SIGNUP) return 'signup';
    if (c.login < MAX_LOGIN) return 'login';
    return null;
}

export function recordAttempt(tenantKey, operation) {
    const c = counters(tenantKey);
    if (operation === 'signup') c.signup += 1;
    else if (operation === 'login') c.login += 1;
}
