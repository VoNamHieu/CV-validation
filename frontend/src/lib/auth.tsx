'use client';

// Auth context over Supabase Auth. Holds the current session/user and exposes
// sign in / sign up / sign out. When Supabase isn't configured, `enabled` is
// false and the app runs anonymously.
import {
    createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { useAppStore } from '@/store/useAppStore';

interface AuthResult {
    error?: string;
    needsConfirm?: boolean;
}

interface AuthContextValue {
    user: User | null;
    session: Session | null;
    loading: boolean;
    enabled: boolean;
    signIn: (email: string, password: string) => Promise<AuthResult>;
    signUp: (email: string, password: string) => Promise<AuthResult>;
    signOut: () => Promise<void>;
    // Global login prompt — the soft gate opens this when an anonymous user
    // hits an action that needs an account. `promptReason` is shown in the modal.
    promptOpen: boolean;
    promptReason: string;
    promptLogin: (reason?: string) => void;
    closePrompt: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const sb = getSupabase();
    const enabled = sb !== null;
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(enabled);
    const [promptOpen, setPromptOpen] = useState(false);
    const [promptReason, setPromptReason] = useState('');

    useEffect(() => {
        if (!sb) return;
        let active = true;
        sb.auth.getSession().then(({ data }) => {
            if (active) {
                setSession(data.session);
                setLoading(false);
            }
        });
        const { data: sub } = sb.auth.onAuthStateChange((_event, s) => {
            setSession(s);
            setLoading(false);
            // Dismiss the soft-gate prompt the moment auth succeeds (covers
            // sign-in in another tab / email-confirm landing while it's open).
            if (s) setPromptOpen(false);
        });
        return () => {
            active = false;
            sub.subscription.unsubscribe();
        };
    }, [sb]);

    // Once the session is resolved, claim the persisted store for this user.
    // A different (or absent) owner means a logout or account switch on this
    // browser → wipe the previous user's CV / JD entries / history so nothing
    // leaks. Then (re)hydrate the history cache from the backend. Gated on
    // !loading so the transient null during session-restore doesn't wipe a
    // returning user's own data.
    const userId = session?.user?.id ?? null;
    useEffect(() => {
        if (loading) return;
        useAppStore.getState().claimOwnership(userId);
        void useAppStore.getState().loadJobHistory();
        void useAppStore.getState().syncActiveCvProfile();
    }, [loading, userId]);

    const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
        if (!sb) return { error: 'Đăng nhập chưa được cấu hình' };
        const { error } = await sb.auth.signInWithPassword({ email, password });
        return error ? { error: error.message } : {};
    }, [sb]);

    const signUp = useCallback(async (email: string, password: string): Promise<AuthResult> => {
        if (!sb) return { error: 'Đăng ký chưa được cấu hình' };
        // Send the email-confirmation link back to a dedicated callback route
        // so the session is established and the token-bearing URL is cleaned up
        // (instead of dumping #access_token=… on the landing page).
        const emailRedirectTo = typeof window !== 'undefined'
            ? `${window.location.origin}/auth/callback`
            : undefined;
        const { data, error } = await sb.auth.signUp({
            email, password, options: { emailRedirectTo },
        });
        if (error) return { error: error.message };
        // Supabase anti-enumeration: signing up with an ALREADY-registered email
        // doesn't error — it returns an obfuscated user with an empty identities
        // array and no session. Detect that so we tell the user to log in instead
        // of falsely claiming a confirmation email was sent.
        if (data.user && (data.user.identities?.length ?? 0) === 0) {
            return { error: 'Email này đã có tài khoản. Vui lòng đăng nhập.' };
        }
        // No session back → email confirmation required.
        return { needsConfirm: !data.session };
    }, [sb]);

    const signOut = useCallback(async () => {
        if (sb) await sb.auth.signOut();
    }, [sb]);

    const promptLogin = useCallback((reason?: string) => {
        setPromptReason(reason ?? '');
        setPromptOpen(true);
    }, []);
    const closePrompt = useCallback(() => setPromptOpen(false), []);

    const user = session?.user ?? null;
    const value = useMemo<AuthContextValue>(() => ({
        user, session, loading, enabled, signIn, signUp, signOut,
        promptOpen, promptReason, promptLogin, closePrompt,
    }), [user, session, loading, enabled, signIn, signUp, signOut,
        promptOpen, promptReason, promptLogin, closePrompt]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
    return ctx;
}

/**
 * Soft-gate helper. Returns a function to call right before a gated action:
 * if auth is configured and nobody is signed in, it opens the login prompt and
 * returns false (caller should bail); otherwise returns true (proceed). When
 * auth isn't configured (no Supabase env), it's a no-op that always allows.
 */
export function useAuthGate(): (reason?: string) => boolean {
    const { enabled, user, loading, promptLogin } = useAuth();
    return useCallback((reason?: string) => {
        // Only block when we're certain the visitor is anonymous — never during
        // the initial session-restore window, so a returning logged-in user
        // doesn't get a spurious prompt.
        if (enabled && !loading && !user) {
            promptLogin(reason);
            return false;
        }
        return true;
    }, [enabled, loading, user, promptLogin]);
}
