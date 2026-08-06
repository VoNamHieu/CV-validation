'use client';

// Gate for the auto-apply batch: make sure a default ATS credential exists
// before the extension starts hitting account-gated tenants.
//
// Same await-a-modal shape as ConsentProvider (lib/consent-context.tsx): the
// batch handler awaits `ensureApplyCredentials(...)`, which resolves true
// immediately when a credential is already on file and only renders the modal on
// the very first batch that needs one. Everything after that — new tenants
// included — is silent.

import {
    createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
    type ReactNode,
} from 'react';
import { useAuth } from './auth';
import { atsAccounts, type AtsAccount } from './db';
import type { AtsTenantSummary } from './atsTenant';
import ApplyCredentialsModal, {
    type ApplyCredentialsSubmit,
} from '@/components/ApplyCredentialsModal';

/** Tenant states that need the user to do something before we retry. */
const ACTIONABLE = new Set([
    'verification_required', 'credential_required', 'password_reset_required',
    'consent_required', 'challenge_required', 'unsupported',
]);

interface AtsCredentialsValue {
    /** True once we know the user has a usable default credential. */
    hasCredentials: boolean;
    /** Every tenant we've touched. One fetch, shared by the sidebar badge, the
     *  batch progress panel and the history board, so they can't disagree. */
    accounts: AtsAccount[];
    /** Tenants waiting on the user — drives the sidebar badge. */
    actionNeededCount: number;
    /**
     * Resolves true when the batch may proceed: either a default credential is
     * already on file, no tenant in this batch needs one, or the user just
     * supplied one. False means they cancelled — the caller must not start.
     */
    ensureApplyCredentials: (tenants: AtsTenantSummary[], defaultEmail?: string) => Promise<boolean>;
    /** Re-read after a batch reports progress or the settings panel changes. */
    refresh: () => Promise<void>;
}

const Ctx = createContext<AtsCredentialsValue | null>(null);

export function AtsCredentialsProvider({ children }: { children: ReactNode }) {
    const { enabled, user } = useAuth();
    const [hasCredentials, setHasCredentials] = useState(false);
    const [accounts, setAccounts] = useState<AtsAccount[]>([]);
    const [modalOpen, setModalOpen] = useState(false);
    const [tenants, setTenants] = useState<AtsTenantSummary[]>([]);
    const [defaultEmail, setDefaultEmail] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const resolverRef = useRef<((v: boolean) => void) | null>(null);

    const refresh = useCallback(async () => {
        if (!enabled || !user) { setHasCredentials(false); setAccounts([]); return; }
        try {
            const res = await atsAccounts.list();
            setHasCredentials(res.hasDefaultCredential);
            setAccounts(res.accounts);
        } catch {
            // Backend unreachable / feature disabled (503). Leave the flag false;
            // ensureApplyCredentials fails open below so a backend outage can't
            // block applying to jobs that need no account at all.
            setHasCredentials(false);
            setAccounts([]);
        }
    }, [enabled, user]);

    useEffect(() => { void refresh(); }, [refresh]);

    const ensureApplyCredentials = useCallback(
        (batchTenants: AtsTenantSummary[], email?: string): Promise<boolean> => {
            // Nothing in this batch needs an account, or we already have one.
            if (batchTenants.length === 0) return Promise.resolve(true);
            if (hasCredentials) return Promise.resolve(true);
            // Auth off (dev) → no server to store credentials in; don't block.
            if (!enabled || !user) return Promise.resolve(true);

            setTenants(batchTenants);
            setDefaultEmail(email || '');
            setError('');
            setModalOpen(true);
            return new Promise<boolean>((resolve) => { resolverRef.current = resolve; });
        },
        [enabled, user, hasCredentials],
    );

    const settle = useCallback((v: boolean) => {
        resolverRef.current?.(v);
        resolverRef.current = null;
        setModalOpen(false);
    }, []);

    const submit = useCallback(async (creds: ApplyCredentialsSubmit) => {
        setBusy(true);
        setError('');
        try {
            await atsAccounts.setDefault(creds.email, creds.password);
            setHasCredentials(true);
            settle(true);
        } catch (e) {
            // Fail closed: without a stored credential the agent would hit every
            // login wall with nothing to type and burn each tenant's one attempt.
            const status = (e as { status?: number })?.status;
            setError(status === 503
                ? 'Tính năng tài khoản ATS chưa được bật trên máy chủ.'
                : 'Không lưu được thông tin đăng nhập. Vui lòng thử lại.');
        } finally {
            setBusy(false);
        }
    }, [settle]);

    const actionNeededCount = useMemo(
        () => accounts.filter((a) => ACTIONABLE.has(a.accountState)).length,
        [accounts],
    );

    return (
        <Ctx.Provider value={{
            hasCredentials, accounts, actionNeededCount, ensureApplyCredentials, refresh,
        }}>
            {children}
            {modalOpen && (
                <ApplyCredentialsModal
                    tenants={tenants} defaultEmail={defaultEmail}
                    busy={busy} error={error}
                    onSubmit={submit} onCancel={() => settle(false)}
                />
            )}
        </Ctx.Provider>
    );
}

export function useAtsCredentials(): AtsCredentialsValue {
    const c = useContext(Ctx);
    if (!c) throw new Error('useAtsCredentials must be used within <AtsCredentialsProvider>');
    return c;
}
