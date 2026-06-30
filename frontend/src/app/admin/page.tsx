'use client';

// Admin tooling — grant credits to a target user by email. The page is gated
// twice: the backend enforces the ADMIN_EMAILS allowlist on every call, and on
// mount we probe /api/admin/check so non-admins see a clean "no access" screen
// instead of a broken form.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    ShieldCheck, MagnifyingGlass, Coins, ArrowLeft, SpinnerGap, CheckCircle, WarningCircle,
} from '@phosphor-icons/react';
import { useAuth } from '@/lib/auth';
import { admin } from '@/lib/db';

type Access = 'checking' | 'granted' | 'denied';

const QUICK_AMOUNTS = [50, 100, 250, 500];

export default function AdminPage() {
    const router = useRouter();
    const { user, enabled, loading: authLoading } = useAuth();
    const [access, setAccess] = useState<Access>('checking');

    const [email, setEmail] = useState('');
    const [amount, setAmount] = useState<number>(50);
    const [reason, setReason] = useState('');

    const [lookup, setLookup] = useState<{ balance: number; email: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Probe admin access once auth has settled.
    useEffect(() => {
        if (enabled && authLoading) return;          // wait for session restore
        if (enabled && !user) { setAccess('denied'); return; }
        admin.check()
            .then(() => setAccess('granted'))
            .catch(() => setAccess('denied'));
    }, [enabled, authLoading, user]);

    const doLookup = useCallback(async () => {
        if (!email.trim()) return;
        setError(''); setSuccess(''); setLookup(null); setBusy(true);
        try {
            const r = await admin.lookupUser(email.trim());
            setLookup({ balance: r.balance, email: r.email });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Tra cứu thất bại');
        } finally {
            setBusy(false);
        }
    }, [email]);

    const doGrant = useCallback(async () => {
        setError(''); setSuccess('');
        if (!email.trim()) { setError('Nhập email người dùng'); return; }
        if (!amount || amount <= 0) { setError('Số credit phải lớn hơn 0'); return; }
        setBusy(true);
        try {
            const r = await admin.grantCredits({ email: email.trim(), amount, reason: reason.trim() || undefined });
            setSuccess(`Đã cấp ${r.granted} credit cho ${r.email}. Số dư mới: ${r.balance}.`);
            setLookup({ balance: r.balance, email: r.email });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Cấp credit thất bại');
        } finally {
            setBusy(false);
        }
    }, [email, amount, reason]);

    const shell = (children: React.ReactNode) => (
        <div style={{
            minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24, background: 'var(--bg-secondary)',
        }}>
            <div style={{ width: '100%', maxWidth: 460 }}>{children}</div>
        </div>
    );

    if (access === 'checking') {
        return shell(
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, color: 'var(--text-muted)' }}>
                <SpinnerGap size={32} style={{ animation: 'spin 0.8s linear infinite' }} />
                <span style={{ fontSize: '0.9rem' }}>Đang kiểm tra quyền truy cập…</span>
                <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>,
        );
    }

    if (access === 'denied') {
        return shell(
            <div className="glass-card" style={{ padding: 32, textAlign: 'center' }}>
                <WarningCircle size={40} weight="duotone" style={{ color: 'var(--accent-red, #ef4444)', marginBottom: 12 }} />
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
                    Không có quyền truy cập
                </h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
                    Trang này chỉ dành cho quản trị viên. Hãy đăng nhập bằng tài khoản admin được cấp quyền.
                </p>
                <button className="btn-secondary" onClick={() => router.replace('/')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <ArrowLeft size={16} weight="bold" /> Về trang chủ
                </button>
            </div>,
        );
    }

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '10px 12px', borderRadius: 10,
        border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
        color: 'var(--text-primary)', fontSize: '0.88rem', outline: 'none',
    };
    const labelStyle: React.CSSProperties = {
        fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)',
        marginBottom: 6, display: 'block',
    };

    return shell(
        <div className="glass-card" style={{ padding: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <ShieldCheck size={22} weight="duotone" style={{ color: 'var(--accent-purple, #8b5cf6)' }} />
                <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>Cấp credit</h1>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 22, lineHeight: 1.5 }}>
                Cộng credit cho người dùng theo email. Mọi lần cấp được ghi vào lịch sử (ledger).
            </p>

            {/* Email + lookup */}
            <label style={labelStyle}>Email người dùng</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                    type="email" placeholder="user@example.com" value={email}
                    autoComplete="off"
                    onChange={(e) => { setEmail(e.target.value); setLookup(null); setSuccess(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') doLookup(); }}
                    style={{ ...inputStyle, flex: 1 }}
                />
                <button className="btn-secondary" onClick={doLookup} disabled={busy || !email.trim()}
                    title="Tra cứu số dư hiện tại"
                    style={{ padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MagnifyingGlass size={16} weight="bold" />
                </button>
            </div>

            {lookup && (
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', borderRadius: 10, marginBottom: 16,
                    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                    fontSize: '0.82rem', color: 'var(--text-secondary)',
                }}>
                    <span>{lookup.email}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--text-primary)' }}>
                        <Coins size={15} weight="duotone" /> {lookup.balance}
                    </span>
                </div>
            )}

            {/* Amount */}
            <label style={{ ...labelStyle, marginTop: 6 }}>Số credit cộng thêm</label>
            <input
                type="number" min={1} value={amount}
                onChange={(e) => setAmount(parseInt(e.target.value || '0', 10))}
                style={{ ...inputStyle, marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                {QUICK_AMOUNTS.map((a) => (
                    <button key={a} onClick={() => setAmount(a)} type="button"
                        style={{
                            padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
                            fontSize: '0.78rem', fontWeight: 600,
                            border: '1px solid var(--border-subtle)',
                            background: amount === a ? 'var(--accent-purple, #8b5cf6)' : 'var(--bg-card)',
                            color: amount === a ? 'white' : 'var(--text-secondary)',
                        }}>
                        +{a}
                    </button>
                ))}
            </div>

            {/* Reason */}
            <label style={labelStyle}>Lý do (tuỳ chọn)</label>
            <input
                type="text" placeholder="vd: khuyến mãi, hoàn credit, hỗ trợ…" value={reason}
                onChange={(e) => setReason(e.target.value)} maxLength={64}
                style={{ ...inputStyle, marginBottom: 20 }}
            />

            {error && (
                <div role="alert" style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
                    fontSize: '0.8rem', color: 'var(--accent-red, #ef4444)',
                }}>
                    <WarningCircle size={16} weight="fill" /> {error}
                </div>
            )}
            {success && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
                    fontSize: '0.8rem', color: 'var(--accent-green, #22c55e)',
                }}>
                    <CheckCircle size={16} weight="fill" /> {success}
                </div>
            )}

            <button
                className="btn-primary" onClick={doGrant} disabled={busy}
                style={{
                    width: '100%', height: 48, fontSize: '0.92rem', fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    opacity: busy ? 0.7 : 1,
                }}>
                {busy
                    ? <><SpinnerGap size={18} style={{ animation: 'spin 0.8s linear infinite' }} /> Đang xử lý…</>
                    : <><Coins size={18} weight="fill" /> Cấp {amount > 0 ? amount : ''} credit</>}
            </button>

            <button onClick={() => router.replace('/')}
                style={{
                    marginTop: 16, width: '100%', background: 'none', border: 'none',
                    color: 'var(--text-muted)', fontSize: '0.8rem', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                <ArrowLeft size={14} weight="bold" /> Về ứng dụng
            </button>

            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>,
    );
}
