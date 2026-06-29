'use client';

// Auth context over Supabase Auth. Holds the current session/user and exposes
// sign in / sign up / sign out. When Supabase isn't configured, `enabled` is
// false and the app runs anonymously.
import {
    createContext, useCallback, useContext, useEffect, useState, type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const sb = getSupabase();
    const enabled = sb !== null;
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(enabled);

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
        });
        return () => {
            active = false;
            sub.subscription.unsubscribe();
        };
    }, [sb]);

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
        // No session back → email confirmation required.
        return { needsConfirm: !data.session };
    }, [sb]);

    const signOut = useCallback(async () => {
        if (sb) await sb.auth.signOut();
    }, [sb]);

    return (
        <AuthContext.Provider
            value={{ user: session?.user ?? null, session, loading, enabled, signIn, signUp, signOut }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
    return ctx;
}
