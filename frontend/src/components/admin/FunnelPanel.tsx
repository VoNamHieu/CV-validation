'use client';

// Admin funnel analytics — how far users get in the wizard and where they drop.
// Reads per-step distinct-session counts from /api/admin/analytics/funnel and
// renders a funnel with conversion-from-start + drop-from-previous per step.
import { useCallback, useEffect, useState } from 'react';
import { ArrowsClockwise, TrendDown, Users } from '@phosphor-icons/react';
import { FUNNEL_STEPS } from '@/lib/analytics';
import { getAuthHeaders } from '@/lib/auth-headers';

type Counts = Record<string, number>;

export default function FunnelPanel() {
    const [counts, setCounts] = useState<Counts | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true); setError('');
        try {
            const res = await fetch('/api/admin/analytics/funnel', { headers: { ...(await getAuthHeaders()) } });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.detail || `HTTP ${res.status}`);
            }
            const data = await res.json();
            // Accept { counts: {...} } or a flat { event: n } map.
            setCounts((data && data.counts) ? data.counts : data);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Không tải được dữ liệu funnel');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const firstCount = counts ? (counts[FUNNEL_STEPS[0].event] ?? 0) : 0;
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

    return (
        <div className="glass-card" style={{ padding: 24, maxWidth: 640 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Users size={17} weight="duotone" /> Funnel người dùng
                </span>
                <button className="btn-secondary" onClick={load} disabled={loading}
                    style={{ padding: '6px 12px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <ArrowsClockwise size={14} weight="bold" style={loading ? { animation: 'spin 0.8s linear infinite' } : undefined} />
                    Tải lại
                </button>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 18px', lineHeight: 1.5 }}>
                Số phiên (session) đạt từng bước. % theo bước đầu + tỉ lệ rớt so với bước trước.
            </p>

            {error && (
                <div style={{ fontSize: '0.8rem', color: 'var(--accent-red, #ef4444)', marginBottom: 12 }}>
                    {error}
                </div>
            )}

            {!error && counts && firstCount === 0 && (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '12px 0' }}>
                    Chưa có dữ liệu sự kiện nào.
                </div>
            )}

            {counts && firstCount > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {FUNNEL_STEPS.map((step, i) => {
                        const n = counts[step.event] ?? 0;
                        const prev = i === 0 ? n : (counts[FUNNEL_STEPS[i - 1].event] ?? 0);
                        const fromStart = pct(n, firstCount);
                        const drop = i === 0 ? 0 : (prev > 0 ? Math.max(0, prev - n) : 0);
                        const dropPct = i === 0 ? 0 : pct(drop, prev);
                        return (
                            <div key={step.event}>
                                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                        {i + 1}. {step.label}
                                    </span>
                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                        <b style={{ color: 'var(--text-primary)' }}>{n}</b> · {fromStart}%
                                        {i > 0 && drop > 0 && (
                                            <span style={{ marginLeft: 8, color: 'var(--accent-red, #ef4444)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                                <TrendDown size={12} weight="bold" /> {dropPct}%
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <div style={{ height: 10, borderRadius: 999, background: 'var(--bg-card)', overflow: 'hidden' }}>
                                    <div style={{
                                        height: '100%', width: `${fromStart}%`, borderRadius: 999,
                                        background: 'var(--gradient-hero)', transition: 'width 0.3s ease',
                                    }} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
    );
}
