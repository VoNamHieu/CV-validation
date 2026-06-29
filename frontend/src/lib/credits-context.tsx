'use client';

// Tracks the logged-in user's credit balance. Refetches on login and each time
// a global operation finishes (useAppStore.isLoading false-transition) — every
// AI action toggles isLoading, so the balance stays in sync after each spend.
// Also re-fetches when the tab regains focus.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import { credits as creditsApi } from './db';
import { useAppStore } from '@/store/useAppStore';

interface CreditsValue {
    balance: number | null;
    grant: number | null;
    refresh: () => void;
}

const CreditsContext = createContext<CreditsValue>({ balance: null, grant: null, refresh: () => {} });

export function CreditsProvider({ children }: { children: ReactNode }) {
    const { user, enabled } = useAuth();
    const isLoading = useAppStore((s) => s.isLoading);
    const [balance, setBalance] = useState<number | null>(null);
    const [grant, setGrant] = useState<number | null>(null);
    const prevLoading = useRef(false);

    const refresh = useCallback(() => {
        if (!user && enabled) return; // logged out (auth on) → no balance
        creditsApi.balance()
            .then((r) => { setBalance(r.balance); setGrant(r.signup_grant); })
            .catch(() => { /* ignore — unauth or transient */ });
    }, [user, enabled]);

    // On login / auth change.
    useEffect(() => { if (user) refresh(); else setBalance(null); }, [user, refresh]);

    // After any global operation finishes (AI action just spent credits).
    useEffect(() => {
        if (prevLoading.current && !isLoading && user) refresh();
        prevLoading.current = isLoading;
    }, [isLoading, user, refresh]);

    // On tab focus.
    useEffect(() => {
        const onFocus = () => { if (user) refresh(); };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [user, refresh]);

    return (
        <CreditsContext.Provider value={{ balance, grant, refresh }}>
            {children}
        </CreditsContext.Provider>
    );
}

export function useCredits(): CreditsValue {
    return useContext(CreditsContext);
}
