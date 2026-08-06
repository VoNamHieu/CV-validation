'use client';

// "Cần bạn xử lý" — the single surface for every tenant the agent could not
// resolve on its own. Rendered both in the batch progress panel and at the top
// of Hồ sơ ứng tuyển, from ONE component and one source of state (the backend),
// so the two views can't drift apart.
//
// Deliberately NOT a modal: a batch runs long and the user may be in another
// tab, so a dialog fired at completion is a dialog nobody sees. This persists.
//
// Three row types, all grouped by tenant:
//   verify   — signup worked, the company wants the email confirmed. There is no
//              background polling (logging into an unverified account can count
//              against a tenant's failed-attempt counter), so the user tells us.
//   override — an account already exists under different details. Asks for email
//              AND password: a pre-existing account often sits on an old address.
//   manual   — CAPTCHA / unusual consent / unsupported flow → hand off to the user.

import { useMemo, useState } from 'react';
import {
    EnvelopeSimple, Key, ArrowSquareOut, ArrowClockwise, Warning,
    Eye, EyeSlash, CheckCircle,
} from '@phosphor-icons/react';
import { atsAccounts, type AtsAccount, type AtsAccountState } from '@/lib/db';
import { tenantLabel } from '@/lib/atsTenant';

/** States that need the user. `unknown`/`ready` never appear here, and
 *  `temporarily_locked` is excluded on purpose — it clears itself. */
const ACTIONABLE: AtsAccountState[] = [
    'verification_required', 'credential_required', 'password_reset_required',
    'consent_required', 'challenge_required', 'unsupported',
];

type RowKind = 'verify' | 'override' | 'manual';

function kindFor(state: AtsAccountState): RowKind {
    if (state === 'verification_required') return 'verify';
    if (state === 'credential_required' || state === 'password_reset_required') return 'override';
    return 'manual';
}

interface Props {
    accounts: AtsAccount[];
    /** Jobs waiting on each tenant, keyed by tenantKey — omit and rows just
     *  don't show a count. */
    pendingCounts?: Record<string, number>;
    /** Called after any successful action so the caller can refetch. */
    onChanged?: () => void;
    compact?: boolean;
}

export default function PendingActionsSection({
    accounts, pendingCounts, onChanged, compact = false,
}: Props) {
    const actionable = useMemo(
        () => accounts.filter((a) => ACTIONABLE.includes(a.accountState)),
        [accounts],
    );
    const [busyAll, setBusyAll] = useState(false);
    const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());

    if (actionable.length === 0) return null;

    const verifyRows = actionable.filter((a) => kindFor(a.accountState) === 'verify');

    /** One button for the whole verification card — N separate buttons is the
     *  fastest way to make a user give up halfway down the list. */
    const retryAllVerify = async () => {
        setBusyAll(true);
        const done = new Set(doneKeys);
        for (const acct of verifyRows) {
            try {
                await atsAccounts.retry(acct.tenantKey);
                done.add(acct.tenantKey);
            } catch { /* leave it in the list; the row's own button can retry */ }
        }
        setDoneKeys(done);
        setBusyAll(false);
        onChanged?.();
    };

    return (
        <section
            aria-label="Cần bạn xử lý"
            style={{
                background: 'rgba(245,158,11,0.07)',
                border: '1px solid rgba(245,158,11,0.32)',
                borderRadius: 12, padding: compact ? '12px 14px' : '14px 18px',
                marginBottom: 16,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Warning size={16} weight="fill" color="var(--accent-amber)" />
                <h3 style={{
                    margin: 0, fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)',
                }}>
                    Cần bạn xử lý
                </h3>
                <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    {actionable.length} công ty
                </span>
                {verifyRows.length > 1 && (
                    <button
                        onClick={retryAllVerify} disabled={busyAll}
                        style={{
                            marginLeft: 'auto', border: '1px solid var(--border-default)',
                            background: 'var(--bg-card)', color: 'var(--text-primary)',
                            borderRadius: 8, padding: '5px 10px', fontSize: '0.75rem',
                            fontWeight: 600, cursor: busyAll ? 'default' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 5, opacity: busyAll ? 0.6 : 1,
                        }}
                    >
                        <ArrowClockwise size={12} weight="bold" />
                        {busyAll ? 'Đang thử lại…' : 'Thử lại tất cả'}
                    </button>
                )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {actionable.map((acct) => (
                    <ActionRow
                        key={acct.tenantKey}
                        account={acct}
                        pendingCount={pendingCounts?.[acct.tenantKey]}
                        done={doneKeys.has(acct.tenantKey)}
                        onChanged={onChanged}
                    />
                ))}
            </div>
        </section>
    );
}

function ActionRow({
    account, pendingCount, done, onChanged,
}: {
    account: AtsAccount;
    pendingCount?: number;
    done: boolean;
    onChanged?: () => void;
}) {
    const kind = kindFor(account.accountState);
    const label = tenantLabel(account.tenantKey);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [ok, setOk] = useState(done);

    const jobsNote = pendingCount ? `${pendingCount} vị trí đang chờ` : null;
    const siteUrl = `https://${account.canonicalHost}`;

    const retry = async () => {
        setBusy(true); setError('');
        try {
            await atsAccounts.retry(account.tenantKey);
            setOk(true);
            onChanged?.();
        } catch {
            setError('Không cập nhật được. Thử lại sau ít phút.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
            borderRadius: 10, padding: '11px 13px',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                {kind === 'verify' && <EnvelopeSimple size={14} weight="fill" color="var(--accent-amber)" />}
                {kind === 'override' && <Key size={14} weight="fill" color="var(--accent-amber)" />}
                {kind === 'manual' && <Warning size={14} weight="fill" color="var(--accent-amber)" />}
                <strong style={{ fontSize: '0.84rem', color: 'var(--text-primary)' }}>{label}</strong>
                {jobsNote && (
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        {jobsNote}
                    </span>
                )}
            </div>

            {ok ? (
                <p style={{
                    margin: 0, fontSize: '0.78rem', color: 'var(--accent-green)',
                    display: 'flex', alignItems: 'center', gap: 5,
                }}>
                    <CheckCircle size={13} weight="fill" />
                    Đã ghi nhận — Copo sẽ thử lại ở lần ứng tuyển tiếp theo.
                </p>
            ) : kind === 'verify' ? (
                <VerifyBody onRetry={retry} busy={busy} error={error} />
            ) : kind === 'override' ? (
                <OverrideBody
                    account={account} siteUrl={siteUrl}
                    onDone={() => { setOk(true); onChanged?.(); }}
                />
            ) : (
                <ManualBody account={account} siteUrl={siteUrl} />
            )}
        </div>
    );
}

function VerifyBody({ onRetry, busy, error }: {
    onRetry: () => void; busy: boolean; error: string;
}) {
    return (
        <>
            <p style={{
                margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5,
            }}>
                Công ty đã gửi email xác minh tài khoản. Mở hộp thư, bấm link xác minh rồi quay lại đây.
                Email đến <strong style={{ color: 'var(--text-primary)' }}>từ chính công ty</strong>{' '}
                (thường là no-reply@myworkdayjobs.com) — nhớ kiểm tra cả mục Spam.
            </p>
            <button
                onClick={onRetry} disabled={busy}
                style={{
                    border: '1px solid var(--border-default)', background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)', borderRadius: 8, padding: '6px 11px',
                    fontSize: '0.76rem', fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                }}
            >
                {busy ? 'Đang kiểm tra…' : 'Đã xác minh – thử lại'}
            </button>
            {error && (
                <div style={{ fontSize: '0.74rem', color: 'var(--accent-red)', marginTop: 6 }}>
                    {error}
                </div>
            )}
        </>
    );
}

function OverrideBody({ account, siteUrl, onDone }: {
    account: AtsAccount; siteUrl: string; onDone: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [show, setShow] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async () => {
        setBusy(true); setError('');
        try {
            await atsAccounts.setTenantCredential(account.tenantKey, email.trim(), password, {
                canonicalHost: account.canonicalHost,
                careerSiteKey: account.careerSiteKey ?? undefined,
            });
            onDone();
        } catch (e) {
            const status = (e as { status?: number })?.status;
            setError(status === 409
                ? 'Thông tin này trùng với thông tin đã thử. Hãy nhập mật khẩu khác.'
                : 'Không lưu được. Vui lòng thử lại.');
        } finally {
            setBusy(false);
        }
    };

    const input: React.CSSProperties = {
        width: '100%', padding: '7px 10px', fontSize: '0.8rem', borderRadius: 8,
        border: '1px solid var(--border-default)', background: 'var(--bg-secondary)',
        color: 'var(--text-primary)', outline: 'none',
    };

    return (
        <>
            <p style={{
                margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5,
            }}>
                Công ty này đã có tài khoản của bạn nhưng thông tin đăng nhập mặc định không dùng được.
                Nhập thông tin đăng nhập riêng cho công ty này.
            </p>
            {!open ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                        onClick={() => setOpen(true)}
                        style={{
                            border: 'none', background: 'var(--gradient-hero)', color: '#fff',
                            borderRadius: 8, padding: '6px 11px', fontSize: '0.76rem',
                            fontWeight: 600, cursor: 'pointer',
                        }}
                    >
                        Nhập thông tin đăng nhập
                    </button>
                    <a
                        href={siteUrl} target="_blank" rel="noopener noreferrer"
                        style={{
                            border: '1px solid var(--border-default)', background: 'var(--bg-secondary)',
                            color: 'var(--text-secondary)', borderRadius: 8, padding: '6px 11px',
                            fontSize: '0.76rem', fontWeight: 600, textDecoration: 'none',
                            display: 'flex', alignItems: 'center', gap: 5,
                        }}
                    >
                        Tự ứng tuyển <ArrowSquareOut size={12} />
                    </a>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <input
                        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                        placeholder="Email của tài khoản ở công ty này"
                        autoComplete="username" style={input} disabled={busy}
                    />
                    <div style={{ position: 'relative' }}>
                        <input
                            type={show ? 'text' : 'password'} value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Mật khẩu" autoComplete="current-password"
                            style={{ ...input, paddingRight: 36 }} disabled={busy}
                        />
                        <button
                            type="button" onClick={() => setShow((s) => !s)}
                            aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                            style={{
                                position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)',
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--text-muted)', display: 'flex', padding: 2,
                            }}
                        >
                            {show ? <EyeSlash size={14} /> : <Eye size={14} />}
                        </button>
                    </div>
                    {/* The exit for the user who genuinely can't remember — without
                        this the row is a dead end for exactly the people it serves. */}
                    <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        Không nhớ mật khẩu? Bấm “Forgot password” trên trang{' '}
                        <a
                            href={siteUrl} target="_blank" rel="noopener noreferrer"
                            style={{ color: 'var(--accent-blue)' }}
                        >
                            {account.canonicalHost}
                        </a>
                        , đặt mật khẩu mới rồi nhập vào đây.
                    </p>
                    {error && (
                        <div style={{ fontSize: '0.74rem', color: 'var(--accent-red)' }}>{error}</div>
                    )}
                    <div style={{ display: 'flex', gap: 7 }}>
                        <button
                            onClick={() => setOpen(false)} disabled={busy}
                            style={{
                                border: '1px solid var(--border-default)', background: 'var(--bg-secondary)',
                                color: 'var(--text-secondary)', borderRadius: 8, padding: '6px 11px',
                                fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer',
                            }}
                        >
                            Huỷ
                        </button>
                        <button
                            onClick={submit}
                            disabled={busy || !email.trim() || !password}
                            style={{
                                border: 'none', background: 'var(--gradient-hero)', color: '#fff',
                                borderRadius: 8, padding: '6px 13px', fontSize: '0.76rem',
                                fontWeight: 600,
                                cursor: busy || !email.trim() || !password ? 'default' : 'pointer',
                                opacity: busy || !email.trim() || !password ? 0.55 : 1,
                            }}
                        >
                            {busy ? 'Đang lưu…' : 'Lưu & thử lại'}
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}

const MANUAL_REASON: Record<string, string> = {
    challenge_required: 'Trang này yêu cầu xác minh thủ công (CAPTCHA) nên Copo không thể tự ứng tuyển.',
    consent_required: 'Trang này có điều khoản riêng cần chính bạn xác nhận.',
    unsupported: 'Quy trình ứng tuyển của trang này Copo chưa hỗ trợ tự động.',
};

function ManualBody({ account, siteUrl }: { account: AtsAccount; siteUrl: string }) {
    return (
        <>
            <p style={{
                margin: '0 0 8px', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5,
            }}>
                {MANUAL_REASON[account.accountState] ?? 'Cần bạn xử lý trực tiếp trên trang tuyển dụng.'}
            </p>
            <a
                href={siteUrl} target="_blank" rel="noopener noreferrer"
                style={{
                    border: '1px solid var(--border-default)', background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)', borderRadius: 8, padding: '6px 11px',
                    fontSize: '0.76rem', fontWeight: 600, textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                }}
            >
                Tự ứng tuyển <ArrowSquareOut size={12} />
            </a>
        </>
    );
}
