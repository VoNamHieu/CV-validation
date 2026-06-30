// Consent constants + helpers. Two layers (see ConsentProvider):
//  1. Terms + Privacy acceptance — the mandatory signup checkbox.
//  2. Auto-apply agent consent — a separate just-in-time confirmation.
import { account } from './db';

// Bump when the Terms/Privacy text changes materially so re-acceptance is
// recorded with the new version. Matches the "Cập nhật lần cuối" date.
export const TERMS_VERSION = '2026-06-30';

const PENDING_KEY = 'jobfit-pending-terms';

// Signup may require email confirmation, so there's no session to write to yet.
// Stash the accepted version locally and flush it once a session exists.
export function stashPendingTermsAcceptance(version: string = TERMS_VERSION): void {
    try { localStorage.setItem(PENDING_KEY, version); } catch { /* ignore */ }
}

export async function flushPendingTermsAcceptance(): Promise<void> {
    let pending: string | null = null;
    try { pending = localStorage.getItem(PENDING_KEY); } catch { /* ignore */ }
    if (!pending) return;
    try {
        await account.acceptTerms(pending);
        localStorage.removeItem(PENDING_KEY);
    } catch { /* leave it pending; retried on next authenticated load */ }
}
