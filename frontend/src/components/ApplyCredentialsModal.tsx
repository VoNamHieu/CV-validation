'use client';

// Modal A — the ONE approval this feature is allowed to add.
//
// Shown at batch start when the queue contains jobs on an account-gated ATS and
// the user has no default credential yet. After this, tenants the agent has
// never seen are handled silently (sign up / sign in just-in-time), so this is
// once per user, not once per company.
//
// Deliberate omissions:
//   · No "I already have an account here" checkbox per tenant — the user can't
//     reliably remember, and the agent finds out by probing.
//   · No generate-password button — the MVP has no reveal, so a generated
//     password the user never typed would lock them out of their own candidate
//     accounts (Workday is also where they'll read interview invitations).
//   · Consent is delegated by a line above the CTA rather than a checkbox: a
//     checkbox is a second approval, and pressing "Tiếp tục" is already an
//     affirmative act.

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { LockKey, Warning, Eye, EyeSlash, Check, CaretDown, X } from '@phosphor-icons/react';
import { useModalA11y } from '@/lib/useModalA11y';
import type { AtsTenantSummary } from '@/lib/atsTenant';

export interface ApplyCredentialsSubmit {
    email: string;
    password: string;
}

interface Props {
    tenants: AtsTenantSummary[];
    defaultEmail?: string;
    busy?: boolean;
    error?: string;
    onSubmit: (creds: ApplyCredentialsSubmit) => void;
    onCancel: () => void;
}

/** Workday's account-creation policy. Checked here because a password that fails
 *  it doesn't fail once — it fails separately at every tenant, as an opaque
 *  signup error the agent can only report as "unknown". */
const RULES: { label: string; test: (v: string) => boolean }[] = [
    { label: 'Ít nhất 8 ký tự', test: (v) => v.length >= 8 },
    { label: 'Có chữ hoa', test: (v) => /[A-Z]/.test(v) },
    { label: 'Có chữ thường', test: (v) => /[a-z]/.test(v) },
    { label: 'Có số', test: (v) => /\d/.test(v) },
    { label: 'Có ký tự đặc biệt', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export default function ApplyCredentialsModal({
    tenants, defaultEmail = '', busy = false, error = '', onSubmit, onCancel,
}: Props) {
    // The modal is mounted fresh each time it opens, so the CV email is simply
    // the initial value — no syncing effect needed.
    const [email, setEmail] = useState(defaultEmail);
    const [password, setPassword] = useState('');
    const [show, setShow] = useState(false);
    const [tenantsOpen, setTenantsOpen] = useState(false);
    const dialogRef = useModalA11y<HTMLDivElement>(onCancel);

    const checks = useMemo(() => RULES.map((r) => ({ ...r, ok: r.test(password) })), [password]);
    const passwordOk = checks.every((c) => c.ok);
    const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
    const canSubmit = emailOk && passwordOk && !busy;

    const totalJobs = tenants.reduce((n, t) => n + t.count, 0);

    if (typeof document === 'undefined') return null;

    const input: React.CSSProperties = {
        width: '100%', padding: '10px 12px', fontSize: '0.88rem',
        borderRadius: 10, border: '1px solid var(--border-default)',
        background: 'var(--bg-card)', color: 'var(--text-primary)', outline: 'none',
    };
    const label: React.CSSProperties = {
        fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5, display: 'block',
    };

    return createPortal(
        <div
            role="presentation"
            // Click-outside closes; the target check means the content needs no
            // stopPropagation handler of its own (same shape as ConfirmModal).
            onClick={(e) => { if (!busy && e.target === e.currentTarget) onCancel(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 16, overflowY: 'auto',
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="apply-creds-title"
                tabIndex={-1}
                style={{
                    width: '100%', maxWidth: 460, background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)', borderRadius: 16, padding: 24,
                    position: 'relative', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                }}
            >
                <button
                    onClick={onCancel} aria-label="Đóng" disabled={busy}
                    style={{
                        position: 'absolute', top: 14, right: 14, border: 'none',
                        background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                    }}
                >
                    <X size={18} weight="bold" />
                </button>

                <div style={{
                    width: 44, height: 44, borderRadius: 12, marginBottom: 14,
                    background: 'rgba(245,158,11,0.14)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                }}>
                    <Warning size={22} weight="fill" color="var(--accent-amber)" />
                </div>

                <h2 id="apply-creds-title" style={{
                    fontSize: '1.05rem', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)',
                }}>
                    {totalJobs} vị trí cần tài khoản để ứng tuyển
                </h2>
                <p style={{
                    fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px',
                }}>
                    Mỗi công ty có một tài khoản ứng viên riêng. Copo sẽ dùng email và mật khẩu dưới đây để{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>tự đăng nhập hoặc tạo tài khoản</strong>{' '}
                    ở từng công ty giúp bạn.
                </p>

                <div style={{ marginBottom: 12 }}>
                    <label style={label} htmlFor="apply-creds-email">Email</label>
                    <input
                        id="apply-creds-email" type="email" value={email} disabled={busy}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={defaultEmail || 'email@example.com'}
                        autoComplete="username" style={input}
                    />
                </div>

                <div style={{ marginBottom: 10 }}>
                    <label style={label} htmlFor="apply-creds-password">Mật khẩu</label>
                    <div style={{ position: 'relative' }}>
                        <input
                            id="apply-creds-password" type={show ? 'text' : 'password'}
                            value={password} disabled={busy}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Mật khẩu dùng cho các trang tuyển dụng"
                            autoComplete="new-password" style={{ ...input, paddingRight: 40 }}
                        />
                        <button
                            type="button" onClick={() => setShow((s) => !s)}
                            aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                            style={{
                                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--text-muted)', display: 'flex', padding: 2,
                            }}
                        >
                            {show ? <EyeSlash size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                </div>

                {/* Live policy checklist — Workday rejects weak passwords per tenant. */}
                <ul style={{
                    listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'flex',
                    flexWrap: 'wrap', gap: '4px 14px',
                }}>
                    {checks.map((c) => (
                        <li key={c.label} style={{
                            fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4,
                            color: c.ok ? 'var(--accent-green)' : 'var(--text-muted)',
                        }}>
                            <Check size={11} weight="bold" style={{ opacity: c.ok ? 1 : 0.35 }} />
                            {c.label}
                        </li>
                    ))}
                </ul>

                <div style={{
                    fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.55,
                    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                    borderRadius: 10, padding: '9px 11px', marginBottom: 12,
                    display: 'flex', gap: 7, alignItems: 'flex-start',
                }}>
                    <LockKey size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>
                        <strong style={{ color: 'var(--text-primary)' }}>Hãy nhớ mật khẩu này</strong> — bạn sẽ
                        cần nó khi tự đăng nhập trang tuyển dụng để xem trạng thái hồ sơ. Nếu bạn đã từng
                        đăng ký ở công ty nào bên dưới, hãy dùng đúng mật khẩu cũ đó.
                    </span>
                </div>

                {tenants.length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                        <button
                            type="button" onClick={() => setTenantsOpen((o) => !o)}
                            aria-expanded={tenantsOpen}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 5, border: 'none',
                                background: 'none', padding: 0, cursor: 'pointer',
                                fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 600,
                            }}
                        >
                            <CaretDown
                                size={11} weight="bold"
                                style={{
                                    transform: tenantsOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                                    transition: 'transform 0.15s',
                                }}
                            />
                            Sẽ dùng cho {tenants.length} công ty
                        </button>
                        {tenantsOpen && (
                            <ul style={{ listStyle: 'none', padding: '8px 0 0 16px', margin: 0 }}>
                                {tenants.map((t) => (
                                    <li key={t.tenantKey} style={{
                                        fontSize: '0.78rem', color: 'var(--text-secondary)',
                                        padding: '2px 0', display: 'flex', justifyContent: 'space-between',
                                        gap: 12, maxWidth: 320,
                                    }}>
                                        <span>{t.label}</span>
                                        <span style={{ color: 'var(--text-muted)' }}>{t.count} vị trí</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {error && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--accent-red)', marginBottom: 10 }}>
                        {error}
                    </div>
                )}

                {/* Consent delegation. A line, not a checkbox: the checkbox would be a
                    second approval, and clicking the CTA is already affirmative. Only
                    covers the mandatory apply terms — marketing opt-ins are never
                    ticked on the user's behalf (see login.js _tickConsent). */}
                <p style={{
                    fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 10px',
                }}>
                    Bấm “Tiếp tục” nghĩa là bạn đồng ý để Copo chấp nhận điều khoản ứng tuyển bắt buộc của
                    từng công ty thay bạn. Copo không bao giờ đăng ký nhận email quảng cáo thay bạn.
                </p>

                <div style={{ display: 'flex', gap: 10 }}>
                    <button
                        onClick={onCancel} disabled={busy}
                        style={{
                            flex: 1, padding: '11px 12px', borderRadius: 10, cursor: 'pointer',
                            border: '1px solid var(--border-default)', background: 'var(--bg-card)',
                            color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600,
                        }}
                    >
                        Huỷ
                    </button>
                    <button
                        onClick={() => onSubmit({ email: email.trim(), password })}
                        disabled={!canSubmit}
                        style={{
                            flex: 1.4, padding: '11px 12px', borderRadius: 10, border: 'none',
                            background: 'var(--gradient-hero)', color: '#fff', fontSize: '0.85rem',
                            fontWeight: 600, cursor: canSubmit ? 'pointer' : 'default',
                            opacity: canSubmit ? 1 : 0.55,
                        }}
                    >
                        {busy ? 'Đang lưu…' : 'Tiếp tục ứng tuyển'}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
