'use client';

// Shown above the job list when the system detects that some jobs need a LOGIN /
// account creation to apply (Workday, SuccessFactors, iCIMS…). It tells the user
// which ATS need it and collects one email + password the auto-apply agent will
// reuse to create/sign in to those accounts. The email is pre-filled from the CV
// (editable); nothing is persisted yet — this is the collect-credentials step.

import { useEffect, useState } from 'react';
import { LockKey, Warning, Eye, EyeSlash } from '@phosphor-icons/react';

export interface ApplyCredentials {
    email: string;
    password: string;
}

interface Props {
    /** Distinct ATS that need login, most-common first, with a job count. */
    atsSummary: { label: string; count: number }[];
    /** Email extracted from the CV — pre-fills the email field. */
    defaultEmail?: string;
    /** Bubbles the current credentials up so the caller can use them later. */
    onChange?: (creds: ApplyCredentials) => void;
}

export default function LoginCredentialsBanner({ atsSummary, defaultEmail = '', onChange }: Props) {
    const [email, setEmail] = useState(defaultEmail);
    const [password, setPassword] = useState('');
    const [show, setShow] = useState(false);

    // Keep the email in sync if the CV email arrives/changes after mount, but
    // only while the user hasn't typed over it.
    const [touched, setTouched] = useState(false);
    useEffect(() => {
        if (!touched && defaultEmail) setEmail(defaultEmail);
    }, [defaultEmail, touched]);

    useEffect(() => { onChange?.({ email, password }); }, [email, password, onChange]);

    if (atsSummary.length === 0) return null;

    const totalJobs = atsSummary.reduce((n, a) => n + a.count, 0);
    const atsText = atsSummary.map((a) => `${a.label} (${a.count})`).join(', ');

    const input: React.CSSProperties = {
        width: '100%', padding: '9px 12px', fontSize: '0.86rem',
        borderRadius: 'var(--radius-sm, 8px)', border: '1px solid var(--border-default)',
        background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none',
    };
    const label: React.CSSProperties = {
        fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4, display: 'block',
    };

    return (
        <div style={{
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.35)',
            borderRadius: 'var(--radius-md, 12px)',
            padding: '14px 18px', marginBottom: 16,
        }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10 }}>
                <Warning size={17} weight="fill" color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: '0.86rem', lineHeight: 1.5, color: 'var(--text-primary)' }}>
                    <b>{totalJobs} vị trí</b> trong danh sách dùng hệ thống cần <b>đăng nhập / tạo tài khoản</b> để ứng
                    tuyển ({atsText}). Nhập email và mật khẩu để hệ thống tự đăng nhập/tạo tài khoản giúp bạn khi ứng tuyển.
                </div>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                    <label style={label}>Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => { setTouched(true); setEmail(e.target.value); }}
                        placeholder={defaultEmail || 'email@example.com'}
                        autoComplete="username"
                        style={input}
                    />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                    <label style={label}>Mật khẩu</label>
                    <div style={{ position: 'relative' }}>
                        <input
                            type={show ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Mật khẩu dùng cho các trang tuyển dụng"
                            autoComplete="new-password"
                            style={{ ...input, paddingRight: 38 }}
                        />
                        <button
                            type="button"
                            onClick={() => setShow((s) => !s)}
                            aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                            style={{
                                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                                display: 'flex', padding: 2,
                            }}
                        >
                            {show ? <EyeSlash size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                <LockKey size={12} /> Chỉ dùng để tự ứng tuyển thay bạn trên các trang này.
            </div>
        </div>
    );
}
