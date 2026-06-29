'use client';

import { SignIn, SignOut, UserCircle, Coins } from '@phosphor-icons/react';
import { useAuth } from '@/lib/auth';
import { useCredits } from '@/lib/credits-context';

// Sidebar auth widget: a login button when signed out, or the user's email +
// sign-out when signed in. Renders nothing if Supabase Auth isn't configured.
export default function AuthButton() {
    const { enabled, user, loading, signOut, promptLogin } = useAuth();
    const { balance } = useCredits();

    if (!enabled) return null;

    const rowStyle: React.CSSProperties = {
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px', borderRadius: 10,
        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
        color: 'var(--text-secondary)', fontSize: '0.74rem', fontWeight: 500,
        cursor: 'pointer', width: '100%', textAlign: 'left',
    };

    if (loading) {
        return <div style={{ ...rowStyle, cursor: 'default', color: 'var(--text-muted)' }}>Đang tải…</div>;
    }

    if (user) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ ...rowStyle, cursor: 'default' }}>
                    <UserCircle size={16} weight="duotone" />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {user.email}
                    </span>
                </div>
                <div style={{ ...rowStyle, cursor: 'default', justifyContent: 'space-between' }}
                    title="Credit còn lại cho các thao tác AI">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Coins size={15} weight="duotone" /> Credit
                    </span>
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                        {balance ?? '…'}
                    </span>
                </div>
                <button
                    onClick={() => signOut()}
                    style={rowStyle}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                    <SignOut size={15} weight="duotone" /> Đăng xuất
                </button>
            </div>
        );
    }

    return (
        <button
            onClick={() => promptLogin()}
            style={rowStyle}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
            <SignIn size={15} weight="duotone" /> Đăng nhập
        </button>
    );
}
