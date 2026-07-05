'use client';

// Destructive confirmation for permanent account deletion. The user must type
// their email to enable the delete button (guards against accidental clicks).
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Warning } from '@phosphor-icons/react';
import { account } from '@/lib/db';
import { useModalA11y } from '@/lib/useModalA11y';

export default function DeleteAccountModal({
    email, onClose, onDeleted,
}: {
    email: string;
    onClose: () => void;
    onDeleted: () => void;
}) {
    const [typed, setTyped] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const confirmed = typed.trim().toLowerCase() === (email || '').trim().toLowerCase();

    const doDelete = async () => {
        if (!confirmed || busy) return;
        setBusy(true);
        setError('');
        try {
            await account.deleteAccount();
            onDeleted();
        } catch {
            setError('Xoá tài khoản thất bại. Vui lòng thử lại.');
            setBusy(false);
        }
    };

    // Escape must not close the modal mid-delete, same as the overlay click guard below.
    const dialogRef = useModalA11y<HTMLDivElement>(busy ? () => {} : onClose);

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            onClick={busy ? undefined : onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 16,
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-account-modal-title"
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 420, background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)', borderRadius: 16, padding: 24,
                    position: 'relative', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                }}
            >
                <button
                    onClick={onClose} disabled={busy} aria-label="Đóng"
                    style={{
                        position: 'absolute', top: 14, right: 14, border: 'none',
                        background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                    }}
                >
                    <X size={18} weight="bold" />
                </button>

                <div style={{
                    width: 44, height: 44, borderRadius: 12, marginBottom: 14,
                    background: 'color-mix(in srgb, var(--accent-red, #ef4444) 14%, transparent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <Warning size={22} weight="fill" style={{ color: 'var(--accent-red, #ef4444)' }} />
                </div>

                <h2 id="delete-account-modal-title" style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                    Xoá tài khoản vĩnh viễn
                </h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
                    Toàn bộ CV, việc đã lưu, lịch sử ứng tuyển và credit của bạn sẽ bị xoá và{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>không thể khôi phục</strong>.
                </p>

                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                    Nhập email <strong style={{ color: 'var(--text-secondary)' }}>{email}</strong> để xác nhận:
                </label>
                <input
                    type="email" value={typed} disabled={busy} autoComplete="off"
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={email}
                    style={{
                        width: '100%', padding: '10px 12px', borderRadius: 10,
                        border: '1px solid var(--border-default)', background: 'var(--bg-card)',
                        color: 'var(--text-primary)', fontSize: '0.85rem',
                    }}
                />

                {error && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--accent-red, #ef4444)', marginTop: 10 }}>
                        {error}
                    </div>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                    <button
                        onClick={onClose} disabled={busy}
                        style={{
                            flex: 1, padding: '11px 12px', borderRadius: 10, cursor: 'pointer',
                            border: '1px solid var(--border-default)', background: 'var(--bg-card)',
                            color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600,
                        }}
                    >
                        Huỷ
                    </button>
                    <button
                        onClick={doDelete} disabled={!confirmed || busy}
                        style={{
                            flex: 1, padding: '11px 12px', borderRadius: 10, border: 'none',
                            background: 'var(--accent-red, #ef4444)', color: '#fff', fontSize: '0.85rem',
                            fontWeight: 700, cursor: (!confirmed || busy) ? 'default' : 'pointer',
                            opacity: (!confirmed || busy) ? 0.5 : 1,
                        }}
                    >
                        {busy ? 'Đang xoá…' : 'Xoá vĩnh viễn'}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
