'use client';

// Auth callback — where Supabase email-confirmation / magic links land.
//
// The link comes back here with the session token in the URL hash
// (#access_token=…, implicit flow). The Supabase client (detectSessionInUrl:
// true) parses and stores it on init and strips the hash; we then confirm a
// session exists and replace the URL with "/" so the user never sees the raw
// token and lands cleanly in the app. Kept on its own route so the cleanup is
// deterministic instead of racing on the landing page.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

export default function AuthCallback() {
    const router = useRouter();
    const [error, setError] = useState('');

    useEffect(() => {
        const sb = getSupabase();
        if (!sb) {
            router.replace('/');
            return;
        }

        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            router.replace('/');
        };

        // getSession() awaits the client's URL-detection init, so a session here
        // means the token was consumed successfully.
        sb.auth.getSession().then(({ data }) => {
            if (data.session) finish();
        });
        // Belt-and-suspenders: detection may resolve a tick later.
        const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
            if (session) finish();
        });

        // Don't hang forever if the link was expired/already used.
        const t = setTimeout(() => {
            if (done) return;
            sb.auth.getSession().then(({ data }) => {
                if (data.session) {
                    finish();
                } else {
                    setError('Liên kết xác nhận đã hết hạn hoặc đã được dùng. Vui lòng đăng nhập lại.');
                }
            });
        }, 4000);

        return () => {
            sub.subscription.unsubscribe();
            clearTimeout(t);
        };
    }, [router]);

    return (
        <div style={{
            minHeight: '100vh', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 18,
            background: 'var(--bg-secondary)', padding: 24, textAlign: 'center',
        }}>
            {error ? (
                <>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Không hoàn tất được đăng nhập
                    </div>
                    <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', maxWidth: 360, lineHeight: 1.5 }}>
                        {error}
                    </div>
                    <button
                        onClick={() => router.replace('/')}
                        className="btn-primary"
                        style={{ padding: '9px 22px', fontSize: '0.85rem' }}
                    >
                        Về trang chủ
                    </button>
                </>
            ) : (
                <>
                    <div style={{
                        width: 44, height: 44, borderRadius: '50%',
                        border: '3px solid var(--border-subtle)',
                        borderTopColor: 'var(--accent-purple, #8b5cf6)',
                        animation: 'spin 0.7s linear infinite',
                    }} />
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Đang hoàn tất đăng nhập…
                    </div>
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </>
            )}
        </div>
    );
}
