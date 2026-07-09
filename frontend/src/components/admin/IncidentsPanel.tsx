'use client';

// Admin incident log — monitors system / DB / API / extension errors captured
// across the stack (backend global handler + frontend reporters). Summary by
// type/module over a time window + a filterable, resolvable list. Mirrors
// AnalyticsPanel's shape (RANGES selector, glass cards, dependency-free charts).
import { useCallback, useEffect, useState } from 'react';
import {
    ArrowsClockwise, Bug, CheckCircle, CaretDown, Check,
} from '@phosphor-icons/react';
import { admin, type Incident, type IncidentSummary, type IncidentType } from '@/lib/db';
import { BarList } from './charts';

const RANGES: { days: number; label: string }[] = [
    { days: 1, label: '24 giờ' },
    { days: 7, label: '7 ngày' },
    { days: 30, label: '30 ngày' },
    { days: 0, label: 'Tất cả' },
];

const TYPE_META: Record<IncidentType, { label: string; color: string }> = {
    system_error: { label: 'Lỗi hệ thống', color: 'var(--accent-red, #ef4444)' },
    db_error: { label: 'Lỗi DB', color: '#e11d48' },
    api_error: { label: 'Lỗi API', color: 'var(--accent-amber, #f59e0b)' },
    extension_error: { label: 'Lỗi extension', color: 'var(--accent-blue, #3b82f6)' },
    cron_error: { label: 'Lỗi cron', color: '#ea580c' },
};

const TYPE_FILTERS: { value: '' | IncidentType; label: string }[] = [
    { value: '', label: 'Tất cả loại' },
    { value: 'system_error', label: 'Hệ thống' },
    { value: 'db_error', label: 'DB' },
    { value: 'api_error', label: 'API' },
    { value: 'extension_error', label: 'Extension' },
    { value: 'cron_error', label: 'Cron' },
];

const nf = (n: number) => n.toLocaleString('vi-VN');

function ago(iso: string): string {
    const t = new Date(iso).getTime();
    if (!t) return '-';
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return `${s}s trước`;
    if (s < 3600) return `${Math.floor(s / 60)}m trước`;
    if (s < 86400) return `${Math.floor(s / 3600)}h trước`;
    return `${Math.floor(s / 86400)}d trước`;
}

function typeMeta(t: string) {
    return TYPE_META[t as IncidentType] ?? { label: t, color: 'var(--text-muted)' };
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone: string }) {
    return (
        <div className="glass-card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', color: tone, lineHeight: 1.1 }}>
                {value}
            </div>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="glass-card" style={{ padding: 18 }}>
            <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>{title}</div>
            {children}
        </div>
    );
}

export default function IncidentsPanel() {
    const [days, setDays] = useState(7);
    const [typeFilter, setTypeFilter] = useState<'' | IncidentType>('');
    const [onlyUnresolved, setOnlyUnresolved] = useState(true);
    const [summary, setSummary] = useState<IncidentSummary | null>(null);
    const [items, setItems] = useState<Incident[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);
    const [resolving, setResolving] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setError('');
        try {
            const [s, list] = await Promise.all([
                admin.incidentsSummary(days),
                admin.listIncidents({
                    incidentType: typeFilter || undefined,
                    resolved: onlyUnresolved ? false : undefined,
                    limit: 100,
                }),
            ]);
            setSummary(s);
            setItems(list.results);
            setTotal(list.total);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Không tải được nhật ký lỗi');
        } finally {
            setLoading(false);
        }
    }, [days, typeFilter, onlyUnresolved]);

    useEffect(() => { load(); }, [load]);

    const resolve = useCallback(async (id: string) => {
        setResolving(id);
        try {
            await admin.resolveIncident(id);
            // Drop it locally if we're viewing the unresolved queue; else flip flag.
            setItems((prev) => onlyUnresolved
                ? prev.filter((i) => i.id !== id)
                : prev.map((i) => (i.id === id ? { ...i, resolved: true } : i)));
            setSummary((s) => (s ? { ...s, unresolved: Math.max(0, s.unresolved - 1) } : s));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Không đánh dấu được');
        } finally {
            setResolving(null);
        }
    }, [onlyUnresolved]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Header + window selector */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Bug size={20} weight="duotone" style={{ color: 'var(--accent-red, #ef4444)' }} /> Nhật ký lỗi hệ thống
                    </div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Lỗi hệ thống, DB, call API và kết nối extension — bắt tự động.</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {RANGES.map((r) => {
                        const active = days === r.days;
                        return (
                            <button key={r.days} type="button" onClick={() => setDays(r.days)} disabled={loading}
                                style={{
                                    padding: '5px 12px', borderRadius: 20, cursor: loading ? 'default' : 'pointer',
                                    fontSize: '0.76rem', fontWeight: 600, border: '1px solid var(--border-subtle)',
                                    background: active ? 'var(--gradient-hero)' : 'var(--bg-card)',
                                    color: active ? '#fff' : 'var(--text-secondary)',
                                }}>{r.label}</button>
                        );
                    })}
                    <button className="btn-secondary" onClick={load} disabled={loading}
                        style={{ padding: '6px 12px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <ArrowsClockwise size={14} weight="bold" style={loading ? { animation: 'spin 0.8s linear infinite' } : undefined} />
                        Tải lại
                    </button>
                </div>
            </div>

            {error && (
                <div style={{
                    fontSize: '0.82rem', color: 'var(--accent-red, #ef4444)', background: 'rgba(220,38,38,0.08)',
                    border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, padding: '10px 14px',
                }}>{error}</div>
            )}

            {/* Summary */}
            {summary && (
                <>
                    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
                        <KpiCard label="Tổng lỗi (trong kỳ)" value={nf(summary.total)} tone="var(--text-primary)" />
                        <KpiCard label="Chưa xử lý" value={nf(summary.unresolved)}
                            tone={summary.unresolved > 0 ? 'var(--accent-red, #ef4444)' : 'var(--accent-green, #22c55e)'} />
                    </div>
                    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                        <Section title="Theo loại">
                            <BarList color="var(--accent-red, #ef4444)" emptyLabel="Không có lỗi nào 🎉"
                                items={Object.entries(summary.by_type)
                                    .map(([k, v]) => ({ label: typeMeta(k).label, value: v }))
                                    .sort((a, b) => b.value - a.value)} />
                        </Section>
                        <Section title="Module hay lỗi nhất">
                            <BarList color="var(--accent-amber, #f59e0b)" emptyLabel="Không có lỗi nào"
                                items={summary.top_modules.map((m) => ({ label: m.module || 'unknown', value: m.count }))} />
                        </Section>
                    </div>
                </>
            )}

            {!summary && loading && (
                <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.86rem' }}>Đang tải…</div>
            )}

            {/* Filters */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {TYPE_FILTERS.map((f) => {
                    const active = typeFilter === f.value;
                    return (
                        <button key={f.value || 'all'} type="button" onClick={() => setTypeFilter(f.value)}
                            style={{
                                padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontSize: '0.76rem', fontWeight: 600,
                                border: `1px solid ${active ? 'var(--accent-purple)' : 'var(--border-subtle)'}`,
                                background: active ? 'color-mix(in srgb, var(--accent-purple) 14%, transparent)' : 'var(--bg-card)',
                                color: active ? 'var(--accent-purple)' : 'var(--text-secondary)',
                            }}>{f.label}</button>
                    );
                })}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer', marginLeft: 4 }}>
                    <input type="checkbox" checked={onlyUnresolved} onChange={(e) => setOnlyUnresolved(e.target.checked)} />
                    Chỉ chưa xử lý
                </label>
                <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {loading ? 'Đang tải…' : `${nf(total)} lỗi`}
                </span>
            </div>

            {/* List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.length === 0 && !loading && (
                    <div className="glass-card" style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
                        Không có lỗi nào khớp bộ lọc.
                    </div>
                )}
                {items.map((it) => {
                    const meta = typeMeta(it.incident_type);
                    const open = expanded === it.id;
                    return (
                        <div key={it.id} className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                            <button type="button" onClick={() => setExpanded(open ? null : it.id)}
                                style={{
                                    width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                                    padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                                }}>
                                <span style={{ width: 9, height: 9, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: meta.color }}>{meta.label}</span>
                                        {it.module && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{it.module}</span>}
                                        {it.resolved && (
                                            <span style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--accent-green, #22c55e)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                                <CheckCircle size={11} weight="fill" /> đã xử lý
                                            </span>
                                        )}
                                    </div>
                                    <div style={{
                                        fontSize: '0.82rem', color: 'var(--text-primary)', marginTop: 2,
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }} title={it.message ?? ''}>
                                        {it.message || <span style={{ color: 'var(--text-muted)' }}>(không có message)</span>}
                                    </div>
                                </div>
                                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', flexShrink: 0 }}>{ago(it.created_at)}</span>
                                <CaretDown size={14} weight="bold" style={{ color: 'var(--text-muted)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                            </button>
                            {open && (
                                <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border-subtle)' }}>
                                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.74rem', color: 'var(--text-muted)', margin: '12px 0' }}>
                                        <span>Nguồn: <b style={{ color: 'var(--text-secondary)' }}>{it.source}</b></span>
                                        {it.code && <span>Mã: <b style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{it.code}</b></span>}
                                        <span>Lúc: <b style={{ color: 'var(--text-secondary)' }}>{new Date(it.created_at).toLocaleString('vi-VN')}</b></span>
                                        {it.resolved_by && <span>Xử lý bởi: <b style={{ color: 'var(--text-secondary)' }}>{it.resolved_by}</b></span>}
                                    </div>
                                    {it.context && Object.keys(it.context).length > 0 && (
                                        <pre style={{
                                            fontSize: '0.72rem', background: 'var(--bg-secondary)', borderRadius: 8, padding: 10,
                                            overflowX: 'auto', color: 'var(--text-secondary)', margin: '0 0 10px',
                                        }}>{JSON.stringify(it.context, null, 2)}</pre>
                                    )}
                                    {it.stack && (
                                        <pre style={{
                                            fontSize: '0.7rem', background: 'var(--bg-secondary)', borderRadius: 8, padding: 10,
                                            overflowX: 'auto', maxHeight: 240, color: 'var(--text-muted)', margin: '0 0 10px',
                                        }}>{it.stack}</pre>
                                    )}
                                    {!it.resolved && (
                                        <button type="button" onClick={() => resolve(it.id)} disabled={resolving === it.id}
                                            className="btn-secondary"
                                            style={{ padding: '6px 14px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            {resolving === it.id
                                                ? <ArrowsClockwise size={13} weight="bold" style={{ animation: 'spin 0.8s linear infinite' }} />
                                                : <Check size={13} weight="bold" />}
                                            Đánh dấu đã xử lý
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
    );
}
