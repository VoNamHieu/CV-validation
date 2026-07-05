'use client';

import { useState } from 'react';
import { SignIn, SignOut, UserCircle, Coins, Trash, Plus, CaretDown } from '@phosphor-icons/react';
import { useAuth } from '@/lib/auth';
import { useCredits } from '@/lib/credits-context';
import { useAppStore } from '@/store/useAppStore';
import DeleteAccountModal from './DeleteAccountModal';
import CreditRequestModal from './CreditRequestModal';

// Sidebar auth widget: a login button when signed out, or the user's email +
// sign-out when signed in. Renders nothing if Supabase Auth isn't configured.
export default function AuthButton() {
    const { enabled, user, loading, signOut, promptLogin } = useAuth();
    const { balance, refresh } = useCredits();
    const resetAll = useAppStore((s) => s.resetAll);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [topupOpen, setTopupOpen] = useState(false);
    const [open, setOpen] = useState(false);   // Profile section expanded?

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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {/* Profile section: one row (email + credit at a glance) that
                    expands to the account actions — collapses the old 5-row list. */}
                <button
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    style={{ ...rowStyle, justifyContent: 'space-between', gap: 8 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; }}
                    title={user.email ?? undefined}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <UserCircle size={16} weight="duotone" />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {user.email}
                        </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 700, color: 'var(--text-primary)' }}
                            title="Credit còn lại cho các thao tác AI">
                            <Coins size={13} weight="duotone" /> {balance ?? '…'}
                        </span>
                        <CaretDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                    </span>
                </button>

                {open && (
                    <div style={{
                        display: 'flex', flexDirection: 'column', gap: 6,
                        marginLeft: 4, paddingLeft: 10, borderLeft: '1px solid var(--border-subtle)',
                    }}>
                        <button
                            onClick={() => setTopupOpen(true)}
                            style={rowStyle}
                            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                        >
                            <Plus size={15} weight="bold" /> Nhận thêm credit
                        </button>
                        <button
                            onClick={() => signOut()}
                            style={rowStyle}
                            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }}
                        >
                            <SignOut size={15} weight="duotone" /> Đăng xuất
                        </button>
                        <button
                            onClick={() => setDeleteOpen(true)}
                            style={{ ...rowStyle, color: 'var(--accent-red, #ef4444)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--accent-red, #ef4444) 10%, transparent)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-card)'; }}
                        >
                            <Trash size={15} weight="duotone" /> Xoá tài khoản
                        </button>
                    </div>
                )}

                {topupOpen && (
                    <CreditRequestModal
                        email={user.email ?? ''}
                        onClose={() => setTopupOpen(false)}
                        onGranted={refresh}
                    />
                )}

                {deleteOpen && (
                    <DeleteAccountModal
                        email={user.email ?? ''}
                        onClose={() => setDeleteOpen(false)}
                        onDeleted={async () => {
                            setDeleteOpen(false);
                            await signOut();   // drop the (now-invalid) session
                            resetAll();         // wipe local store → back to landing
                        }}
                    />
                )}
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
