'use client';

// Settings surface for ATS candidate accounts: the masked default credential
// and the per-tenant list.
//
// No "Reveal" in the MVP — showing a stored password back to the browser needs
// its own re-authentication flow and an audit trail, and neither is worth
// blocking this on. Changing the default is the supported path, and it never
// breaks existing tenants (they stay pinned to the credential their account was
// actually created with).

import { useCallback, useEffect, useState } from 'react';
import { LockKey, ArrowClockwise, Eye, EyeSlash, CheckCircle } from '@phosphor-icons/react';
import {
    atsAccounts, type AtsAccount, type AtsCredentialMode, type AtsDefaultCredential,
} from '@/lib/db';
import { tenantLabel } from '@/lib/atsTenant';
import { useAtsCredentials } from '@/lib/ats-credentials-context';
import PendingActionsSection from './PendingActionsSection';

/** Three distinct labels, because after a password rotation EVERY older tenant
 *  is pinned to the previous credential. Collapsing that into "different
 *  password" would paint the whole list as broken when nothing is wrong. */
const MODE_LABEL: Record<AtsCredentialMode, string> = {
    default: 'Dùng thông tin mặc định',
    legacy_default: 'Dùng thông tin mặc định trước đây',
    override: 'Dùng thông tin riêng bạn đã nhập',
};

const STATE_LABEL: Record<string, string> = {
    unknown: 'Chưa dùng lần nào',
    ready: 'Đã đăng nhập được',
    verification_required: 'Chờ xác minh email',
    credential_required: 'Cần thông tin đăng nhập riêng',
    password_reset_required: 'Cần đặt lại mật khẩu',
    consent_required: 'Cần bạn xác nhận điều khoản',
    challenge_required: 'Cần xác minh thủ công',
    temporarily_locked: 'Tạm thời bị khoá',
    unsupported: 'Chưa hỗ trợ tự động',
};

export default function AtsAccountsPanel() {
    const { refresh: refreshGate } = useAtsCredentials();
    const [cred, setCred] = useState<AtsDefaultCredential | null>(null);
    const [accounts, setAccounts] = useState<AtsAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [disabled, setDisabled] = useState(false);
    const [editing, setEditing] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [c, list] = await Promise.all([atsAccounts.getDefault(), atsAccounts.list()]);
            setCred(c);
            setAccounts(list.accounts);
            setDisabled(false);
        } catch (e) {
            // 503 = feature not configured on the server; anything else = offline.
            setDisabled((e as { status?: number })?.status === 503);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    if (loading) {
        return <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>Đang tải…</p>;
    }
    if (disabled) {
        return (
            <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
                Tính năng tài khoản ứng tuyển chưa được bật.
            </p>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <PendingActionsSection
                accounts={accounts}
                onChanged={() => { void load(); }}
            />

            <section>
                <h3 style={{
                    margin: '0 0 4px', fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)',
                }}>
                    Thông tin đăng nhập mặc định
                </h3>
                <p style={{
                    margin: '0 0 12px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55,
                }}>
                    Copo dùng thông tin này để tự đăng nhập hoặc tạo tài khoản ứng viên ở từng công ty
                    (Workday). Mỗi công ty vẫn là một tài khoản riêng biệt.
                </p>

                {editing || !cred?.hasDefaultCredential ? (
                    <DefaultCredentialForm
                        onCancel={cred?.hasDefaultCredential ? () => setEditing(false) : undefined}
                        onSaved={async () => {
                            setEditing(false);
                            await load();
                            await refreshGate();
                        }}
                    />
                ) : (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                        borderRadius: 10, padding: '12px 14px',
                    }}>
                        <LockKey size={16} color="var(--text-muted)" />
                        <div style={{ fontSize: '0.84rem', color: 'var(--text-primary)' }}>
                            {cred.email}
                            <span style={{ color: 'var(--text-muted)', marginLeft: 10 }}>••••••••••</span>
                        </div>
                        <button
                            onClick={() => setEditing(true)}
                            style={{
                                marginLeft: 'auto', border: '1px solid var(--border-default)',
                                background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                                borderRadius: 8, padding: '6px 11px', fontSize: '0.76rem',
                                fontWeight: 600, cursor: 'pointer',
                            }}
                        >
                            Đổi thông tin mặc định
                        </button>
                    </div>
                )}
            </section>

            <section>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <h3 style={{
                        margin: 0, fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)',
                    }}>
                        Tài khoản theo công ty
                    </h3>
                    <button
                        onClick={() => { void load(); }} aria-label="Tải lại"
                        style={{
                            marginLeft: 'auto', border: 'none', background: 'transparent',
                            color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 3,
                        }}
                    >
                        <ArrowClockwise size={14} />
                    </button>
                </div>

                {accounts.length === 0 ? (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                        Chưa có công ty nào. Danh sách xuất hiện sau lần ứng tuyển đầu tiên vào một trang
                        cần tài khoản.
                    </p>
                ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex',
                                 flexDirection: 'column', gap: 6 }}>
                        {accounts.map((a) => (
                            <li key={a.tenantKey} style={{
                                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                                borderRadius: 10, padding: '10px 13px',
                            }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{
                                        fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)',
                                    }}>
                                        {tenantLabel(a.tenantKey)}
                                    </div>
                                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                                        {MODE_LABEL[a.credentialMode]}
                                        {' · '}
                                        {STATE_LABEL[a.accountState] ?? a.accountState}
                                    </div>
                                </div>
                                {a.accountState === 'ready' && (
                                    <CheckCircle
                                        size={15} weight="fill" color="var(--accent-green)"
                                        style={{ marginLeft: 'auto' }}
                                    />
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

function DefaultCredentialForm({ onSaved, onCancel }: {
    onSaved: () => void | Promise<void>;
    onCancel?: () => void;
}) {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async () => {
        setBusy(true); setError('');
        try {
            await atsAccounts.setDefault(email.trim(), password);
            await onSaved();
        } catch {
            setError('Không lưu được. Vui lòng thử lại.');
        } finally {
            setBusy(false);
        }
    };

    const input: React.CSSProperties = {
        width: '100%', padding: '8px 11px', fontSize: '0.84rem', borderRadius: 9,
        border: '1px solid var(--border-default)', background: 'var(--bg-card)',
        color: 'var(--text-primary)', outline: 'none',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 380 }}>
            <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="Email ứng tuyển" autoComplete="username" style={input} disabled={busy}
            />
            <div style={{ position: 'relative' }}>
                <input
                    type={show ? 'text' : 'password'} value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mật khẩu mặc định" autoComplete="new-password"
                    style={{ ...input, paddingRight: 38 }} disabled={busy}
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
                    {show ? <EyeSlash size={15} /> : <Eye size={15} />}
                </button>
            </div>
            {/* Rotation is safe by design; say so, or nobody will dare press it. */}
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Đổi thông tin mặc định không ảnh hưởng các công ty bạn đã có tài khoản — chúng vẫn dùng
                thông tin cũ để đăng nhập.
            </p>
            {error && (
                <div style={{ fontSize: '0.76rem', color: 'var(--accent-red)' }}>{error}</div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
                {onCancel && (
                    <button
                        onClick={onCancel} disabled={busy}
                        style={{
                            border: '1px solid var(--border-default)', background: 'var(--bg-secondary)',
                            color: 'var(--text-secondary)', borderRadius: 9, padding: '7px 13px',
                            fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                        }}
                    >
                        Huỷ
                    </button>
                )}
                <button
                    onClick={submit} disabled={busy || !email.trim() || !password}
                    style={{
                        border: 'none', background: 'var(--gradient-hero)', color: '#fff',
                        borderRadius: 9, padding: '7px 15px', fontSize: '0.8rem', fontWeight: 600,
                        cursor: busy || !email.trim() || !password ? 'default' : 'pointer',
                        opacity: busy || !email.trim() || !password ? 0.55 : 1,
                    }}
                >
                    {busy ? 'Đang lưu…' : 'Lưu'}
                </button>
            </div>
        </div>
    );
}
