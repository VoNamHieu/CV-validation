'use client';

// Admin console — operator tooling behind the ADMIN_EMAILS allowlist. Gated
// twice: the backend enforces the allowlist on every call, and on mount we
// probe /api/admin/check so non-admins get a clean "no access" screen. Tabs:
// credit grants, the link-health monitor, the compatibility prober, and a
// reader for user feedback. Monitor/compat moved here from their old public
// routes (which now redirect in).
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    ShieldCheck, MagnifyingGlass, Coins, ArrowLeft, SpinnerGap, CheckCircle, WarningCircle,
    Heartbeat, PlugsConnected, ChatCircleDots, FunnelSimple, Briefcase, Megaphone,
} from '@phosphor-icons/react';
import { useAuth } from '@/lib/auth';
import { admin } from '@/lib/db';
import MonitorPanel from '@/components/admin/MonitorPanel';
import CompatPanel from '@/components/admin/CompatPanel';
import FeedbackPanel from '@/components/admin/FeedbackPanel';
import AnalyticsPanel from '@/components/admin/AnalyticsPanel';
import JobSearchPanel from '@/components/admin/JobSearchPanel';
import PromotedPanel from '@/components/admin/PromotedPanel';

type Access = 'checking' | 'granted' | 'denied' | 'error';
type Tab = 'credits' | 'jobs' | 'promoted' | 'analytics' | 'monitor' | 'compat' | 'feedback';

const QUICK_AMOUNTS = [50, 100, 250, 500];
const TABS: { id: Tab; label: string; icon: typeof Coins }[] = [
    { id: 'credits', label: 'Cấp credit', icon: Coins },
    { id: 'jobs', label: 'Tìm job', icon: Briefcase },
    { id: 'promoted', label: 'Trang truyền thông', icon: Megaphone },
    { id: 'analytics', label: 'Thống kê', icon: FunnelSimple },
    { id: 'monitor', label: 'Link monitor', icon: Heartbeat },
    { id: 'compat', label: 'Compatibility', icon: PlugsConnected },
    { id: 'feedback', label: 'Feedback', icon: ChatCircleDots },
];

function AdminConsole() {
    const router = useRouter();
    const params = useSearchParams();
    const { user, enabled, loading: authLoading } = useAuth();
    const [access, setAccess] = useState<Access>('checking');
    const [tab, setTab] = useState<Tab>(() => {
        const t = params.get('tab');
        return (TABS.some((x) => x.id === t) ? t : 'credits') as Tab;
    });

    const [email, setEmail] = useState('');
    const [amount, setAmount] = useState<number>(50);
    const [reason, setReason] = useState('');
    const [lookup, setLookup] = useState<{ balance: number; email: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // Verify admin access. Only a genuine 403 means "not an admin" → denied.
    // A 401 (token not refreshed yet) or 5xx/network blip is TRANSIENT — retry a
    // few times, and if it never succeeds show a "connection error / retry"
    // screen instead of the misleading "no access" (which made real admins think
    // they'd been locked out). This is why the page occasionally flashed denied.
    const [checkNonce, setCheckNonce] = useState(0);
    // Key on the user's id, not the `user` object: Supabase hands out a brand
    // new session/user object on every silent token refresh (autoRefreshToken),
    // so depending on `user` re-ran this effect — and re-flashed the "checking"
    // spinner — every refresh cycle even though nobody actually signed in/out.
    const userId = user?.id ?? null;
    useEffect(() => {
        if (enabled && authLoading) return;
        if (enabled && !userId) { setAccess('denied'); return; }
        let cancelled = false;
        setAccess('checking');
        (async () => {
            for (let attempt = 0; attempt < 4; attempt++) {
                try {
                    await admin.check();
                    if (!cancelled) setAccess('granted');
                    return;
                } catch (e) {
                    const status = (e as { status?: number })?.status;
                    if (status === 403) { if (!cancelled) setAccess('denied'); return; }
                    // transient (401 / 5xx / network) → back off and retry
                    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
                }
            }
            if (!cancelled) setAccess('error');
        })();
        return () => { cancelled = true; };
    }, [enabled, authLoading, userId, checkNonce]);

    const doLookup = useCallback(async () => {
        if (!email.trim()) return;
        setError(''); setSuccess(''); setLookup(null); setBusy(true);
        try {
            const r = await admin.lookupUser(email.trim());
            setLookup({ balance: r.balance, email: r.email });
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Tra cứu thất bại');
        } finally { setBusy(false); }
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
        } finally { setBusy(false); }
    }, [email, amount, reason]);

    const centered = (children: React.ReactNode) => (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg-secondary)' }}>
            <div style={{ width: '100%', maxWidth: 460 }}>{children}</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
    );

    if (access === 'checking') {
        return centered(
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, color: 'var(--text-muted)' }}>
                <SpinnerGap size={32} style={{ animation: 'spin 0.8s linear infinite' }} />
                <span style={{ fontSize: '0.9rem' }}>Đang kiểm tra quyền truy cập…</span>
            </div>,
        );
    }
    if (access === 'error') {
        return centered(
            <div className="glass-card" style={{ padding: 32, textAlign: 'center' }}>
                <WarningCircle size={40} weight="duotone" style={{ color: 'var(--accent-amber, #d97706)', marginBottom: 12 }} />
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>Không kiểm tra được quyền</h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
                    Kết nối tới máy chủ đang trục trặc (không phải do tài khoản). Thử lại sau giây lát.
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                    <button className="btn-primary" onClick={() => setCheckNonce((n) => n + 1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        Thử lại
                    </button>
                    <button className="btn-secondary" onClick={() => router.replace('/')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <ArrowLeft size={16} weight="bold" /> Về trang chủ
                    </button>
                </div>
            </div>,
        );
    }
    if (access === 'denied') {
        return centered(
            <div className="glass-card" style={{ padding: 32, textAlign: 'center' }}>
                <WarningCircle size={40} weight="duotone" style={{ color: 'var(--accent-red, #ef4444)', marginBottom: 12 }} />
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>Không có quyền truy cập</h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
                    Trang này chỉ dành cho quản trị viên. Hãy đăng nhập bằng tài khoản admin được cấp quyền.
                </p>
                <button className="btn-secondary" onClick={() => router.replace('/')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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
        fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, display: 'block',
    };

    const creditsTab = (
        <div className="glass-card" style={{ padding: 28, maxWidth: 480 }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 22, lineHeight: 1.5 }}>
                Cộng credit cho người dùng theo email. Mọi lần cấp được ghi vào lịch sử (ledger).
            </p>
            <label style={labelStyle}>Email người dùng</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input type="email" placeholder="user@example.com" value={email} autoComplete="off"
                    onChange={(e) => { setEmail(e.target.value); setLookup(null); setSuccess(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') doLookup(); }}
                    style={{ ...inputStyle, flex: 1 }} />
                <button className="btn-secondary" onClick={doLookup} disabled={busy || !email.trim()}
                    title="Tra cứu số dư hiện tại" style={{ padding: '0 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MagnifyingGlass size={16} weight="bold" />
                </button>
            </div>
            {lookup && (
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px',
                    borderRadius: 10, marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                    fontSize: '0.82rem', color: 'var(--text-secondary)',
                }}>
                    <span>{lookup.email}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: 'var(--text-primary)' }}>
                        <Coins size={15} weight="duotone" /> {lookup.balance}
                    </span>
                </div>
            )}
            <label style={{ ...labelStyle, marginTop: 6 }}>Số credit cộng thêm</label>
            <input type="number" min={1} value={amount}
                onChange={(e) => setAmount(parseInt(e.target.value || '0', 10))}
                style={{ ...inputStyle, marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                {QUICK_AMOUNTS.map((a) => (
                    <button key={a} onClick={() => setAmount(a)} type="button" style={{
                        padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                        border: '1px solid var(--border-subtle)',
                        background: amount === a ? 'var(--accent-purple, #8b5cf6)' : 'var(--bg-card)',
                        color: amount === a ? 'white' : 'var(--text-secondary)',
                    }}>+{a}</button>
                ))}
            </div>
            <label style={labelStyle}>Lý do (tuỳ chọn)</label>
            <input type="text" placeholder="vd: khuyến mãi, hoàn credit, hỗ trợ…" value={reason}
                onChange={(e) => setReason(e.target.value)} maxLength={64} style={{ ...inputStyle, marginBottom: 20 }} />
            {error && (
                <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: '0.8rem', color: 'var(--accent-red, #ef4444)' }}>
                    <WarningCircle size={16} weight="fill" /> {error}
                </div>
            )}
            {success && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: '0.8rem', color: 'var(--accent-green, #22c55e)' }}>
                    <CheckCircle size={16} weight="fill" /> {success}
                </div>
            )}
            <button className="btn-primary" onClick={doGrant} disabled={busy} style={{
                width: '100%', height: 48, fontSize: '0.92rem', fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: busy ? 0.7 : 1,
            }}>
                {busy
                    ? <><SpinnerGap size={18} style={{ animation: 'spin 0.8s linear infinite' }} /> Đang xử lý…</>
                    : <><Coins size={18} weight="fill" /> Cấp {amount > 0 ? amount : ''} credit</>}
            </button>
        </div>
    );

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg-secondary)', padding: '24px 20px 48px' }}>
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <ShieldCheck size={22} weight="duotone" style={{ color: 'var(--accent-purple, #8b5cf6)' }} />
                        <h1 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>Admin console</h1>
                    </div>
                    <button onClick={() => router.replace('/')} style={{
                        background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.8rem',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <ArrowLeft size={14} weight="bold" /> Về ứng dụng
                    </button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
                    {TABS.map((t) => {
                        const Icon = t.icon;
                        const active = tab === t.id;
                        return (
                            <button key={t.id} onClick={() => setTab(t.id)} style={{
                                display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10,
                                cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
                                border: '1px solid', borderColor: active ? 'transparent' : 'var(--border-subtle)',
                                background: active ? 'var(--gradient-hero)' : 'var(--bg-card)',
                                color: active ? '#fff' : 'var(--text-secondary)',
                            }}>
                                <Icon size={15} weight={active ? 'fill' : 'duotone'} /> {t.label}
                            </button>
                        );
                    })}
                </div>

                {tab === 'credits' && creditsTab}
                {tab === 'jobs' && <JobSearchPanel />}
                {tab === 'promoted' && <PromotedPanel />}
                {tab === 'analytics' && <AnalyticsPanel />}
                {tab === 'monitor' && <MonitorPanel />}
                {tab === 'compat' && <CompatPanel />}
                {tab === 'feedback' && <FeedbackPanel />}
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
    );
}

export default function AdminPage() {
    return (
        <Suspense fallback={null}>
            <AdminConsole />
        </Suspense>
    );
}
