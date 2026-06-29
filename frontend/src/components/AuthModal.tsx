'use client';

import { useState } from 'react';
import { X } from '@phosphor-icons/react';
import { useAuth } from '@/lib/auth';

type Mode = 'signin' | 'signup';

export default function AuthModal({ onClose }: { onClose: () => void }) {
    const { signIn, signUp } = useAuth();
    const [mode, setMode] = useState<Mode>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
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
        if (res.needsConfirm) {
            setNotice('Đã gửi email xác nhận. Vui lòng kiểm tra hộp thư để kích hoạt tài khoản.');
            return;
        }
        onClose();
    };

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '10px 12px', borderRadius: 10,
        border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
        color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none',
    };

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 100,
                background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 380, background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)', borderRadius: 16,
                    padding: 24, position: 'relative',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
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

                <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 4, color: 'var(--text-primary)' }}>
                    {mode === 'signin' ? 'Đăng nhập' : 'Tạo tài khoản'}
                </h2>
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

                    {error && (
                        <div style={{ fontSize: '0.76rem', color: 'var(--accent-red, #ef4444)' }}>{error}</div>
                    )}
                    {notice && (
                        <div style={{ fontSize: '0.76rem', color: 'var(--accent-green, #22c55e)' }}>{notice}</div>
                    )}

                    <button
                        type="submit" disabled={busy}
                        style={{
                            marginTop: 4, padding: '11px 12px', borderRadius: 10, border: 'none',
                            background: 'var(--gradient-hero)', color: 'white', fontWeight: 600,
                            fontSize: '0.85rem', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
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
            </div>
        </div>
    );
}
