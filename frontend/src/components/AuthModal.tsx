'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle, FileText } from '@phosphor-icons/react';
import { useAuth } from '@/lib/auth';
import { stashPendingTermsAcceptance } from '@/lib/consent';
import { useModalA11y } from '@/lib/useModalA11y';
import TermsAcceptModal from './TermsAcceptModal';

type Mode = 'signin' | 'signup';

export default function AuthModal({ onClose, reason }: { onClose: () => void; reason?: string }) {
    const { signIn, signUp } = useAuth();
    const [mode, setMode] = useState<Mode>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [agreed, setAgreed] = useState(false);   // Layer-1 consent (signup only)
    const [termsModalOpen, setTermsModalOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(''); setNotice(''); setBusy(true);
        const res = mode === 'signin'
            ? await signIn(email, password)
            : await signUp(email, password);
        setBusy(false);
        if (res.error) { setError(res.error); return; }
        if (mode === 'signup') {
            // Acceptance is recorded once a session exists (here if immediate,
            // else after email confirm). See ConsentProvider.
            stashPendingTermsAcceptance();
        }
        if (res.needsConfirm) {
            setNotice('Đã gửi email xác nhận. Vui lòng kiểm tra hộp thư để kích hoạt tài khoản.');
            return;
        }
        onClose();
    };

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '10px 12px', borderRadius: 10,
        border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
        color: 'var(--text-primary)', fontSize: '0.85rem',
        // No outline: 'none' here — the global :focus-visible ring (globals.css)
        // is the only focus indicator keyboard users get on this form.
    };

    const dialogRef = useModalA11y<HTMLDivElement>(onClose);

    // Portal to <body> so the overlay escapes the Sidebar's backdrop-filter,
    // which would otherwise act as the containing block for position:fixed.
    // No-op on the server (no document); the modal only opens client-side.
    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            role="presentation"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 100,
                background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="auth-modal-title"
                tabIndex={-1}
                style={{
                    width: '100%', maxWidth: 380, background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)', borderRadius: 16,
                    padding: 24, position: 'relative',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                    // Never exceed the viewport on short screens / with the mobile
                    // keyboard open — scroll inside instead of clipping the top &
                    // bottom off-screen. Matches the 90vh cap the app's other modals
                    // (CreditRequest, GrantPermission, Terms…) already use.
                    maxHeight: '90vh', overflowY: 'auto',
                }}
            >
                <button
                    onClick={onClose}
                    aria-label="Đóng"
                    style={{
                        position: 'absolute', top: 14, right: 14, border: 'none',
                        background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                    }}
                >
                    <X size={18} weight="bold" />
                </button>

                <h2 id="auth-modal-title" style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 4, color: 'var(--text-primary)' }}>
                    {mode === 'signin' ? 'Đăng nhập' : 'Tạo tài khoản'}
                </h2>
                {reason && (
                    <div style={{
                        fontSize: '0.78rem', color: 'var(--accent-purple, #c43b2e)', fontWeight: 600,
                        marginBottom: 8, padding: '8px 10px', borderRadius: 8,
                        background: 'var(--gradient-hero-subtle, rgba(196, 59, 46,0.1))',
                    }}>
                        {reason}
                    </div>
                )}
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 18 }}>
                    Lưu CV, việc đã lưu và lịch sử ứng tuyển vào tài khoản của bạn.
                </p>

                <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input
                        type="email" required placeholder="Email" autoComplete="email"
                        value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle}
                    />
                    <input
                        type="password" required placeholder="Mật khẩu" minLength={6}
                        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                        value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle}
                    />

                    {/* Layer-1 mandatory consent — signup only. Scroll-to-accept:
                        the user must open the modal and scroll the full text. */}
                    {mode === 'signup' && (
                        agreed ? (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem',
                                fontWeight: 600, color: 'var(--accent-green)', padding: '9px 12px',
                                borderRadius: 10, background: 'color-mix(in srgb, var(--accent-green) 12%, transparent)',
                                border: '1px solid color-mix(in srgb, var(--accent-green) 30%, transparent)',
                            }}>
                                <CheckCircle size={16} weight="fill" />
                                Đã đồng ý Điều khoản Sử dụng &amp; Chính sách Quyền riêng tư
                            </div>
                        ) : (
                            <button
                                type="button" disabled={busy}
                                onClick={() => setTermsModalOpen(true)}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                                    border: '1px dashed var(--border-default)', background: 'var(--bg-card)',
                                    color: 'var(--text-primary)', fontSize: '0.8rem', fontWeight: 600,
                                }}
                            >
                                <FileText size={15} weight="duotone" />
                                Đọc &amp; đồng ý Điều khoản và Quyền riêng tư
                            </button>
                        )
                    )}

                    {error && (
                        <div style={{ fontSize: '0.76rem', color: 'var(--accent-red, #ef4444)' }}>{error}</div>
                    )}
                    {notice && (
                        <div style={{ fontSize: '0.76rem', color: 'var(--accent-green, #22c55e)' }}>{notice}</div>
                    )}

                    <button
                        type="submit" disabled={busy || (mode === 'signup' && !agreed)}
                        style={{
                            marginTop: 4, padding: '11px 12px', borderRadius: 10, border: 'none',
                            background: 'var(--gradient-hero)', color: 'white', fontWeight: 600,
                            fontSize: '0.85rem',
                            cursor: (busy || (mode === 'signup' && !agreed)) ? 'default' : 'pointer',
                            opacity: (busy || (mode === 'signup' && !agreed)) ? 0.55 : 1,
                        }}
                    >
                        {busy ? 'Đang xử lý…' : mode === 'signin' ? 'Đăng nhập' : 'Đăng ký'}
                    </button>
                </form>

                <div style={{ marginTop: 14, fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                    {mode === 'signin' ? (
                        <>Chưa có tài khoản?{' '}
                            <button onClick={() => { setMode('signup'); setError(''); setNotice(''); }}
                                style={{ border: 'none', background: 'none', color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer' }}>
                                Đăng ký
                            </button>
                        </>
                    ) : (
                        <>Đã có tài khoản?{' '}
                            <button onClick={() => { setMode('signin'); setError(''); setNotice(''); }}
                                style={{ border: 'none', background: 'none', color: 'var(--text-primary)', fontWeight: 600, cursor: 'pointer' }}>
                                Đăng nhập
                            </button>
                        </>
                    )}
                </div>

                {termsModalOpen && (
                    <TermsAcceptModal
                        onAccept={() => { setAgreed(true); setTermsModalOpen(false); }}
                        onClose={() => setTermsModalOpen(false)}
                    />
                )}
            </div>
        </div>,
        document.body,
    );
}
