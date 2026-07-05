'use client';

// Comprehensive admin analytics dashboard. One shared time-window drives three
// backend calls (summary KPIs + distributions, daily trend series, and the
// funnel), rendered with the dependency-free chart primitives in ./charts.
// Replaces the old funnel-only panel.
import { useCallback, useEffect, useState } from 'react';
import {
    ArrowsClockwise, Users, Lightning, Briefcase, Coins, Megaphone,
    ChatCircleDots, Buildings, TrendDown, GraduationCap,
} from '@phosphor-icons/react';
import { admin, type AnalyticsSummary, type AnalyticsTimeseries } from '@/lib/db';
import { FUNNEL_STEPS } from '@/lib/analytics';
import { AreaChart, BarList } from './charts';

const RANGES: { days: number; label: string }[] = [
    { days: 7, label: '7 ngày' },
    { days: 30, label: '30 ngày' },
    { days: 90, label: '90 ngày' },
    { days: 0, label: 'Tất cả' },
];

const STATUS_LABEL: Record<string, string> = {
    tailored: 'Đã tối ưu', filled: 'Đã điền', submitted: 'Đã nộp',
    callback: 'Được liên hệ', interview: 'Phỏng vấn', offer: 'Offer', rejected: 'Từ chối',
};
const STATUS_ORDER = ['tailored', 'filled', 'submitted', 'callback', 'interview', 'offer', 'rejected'];

const REASON_LABEL: Record<string, string> = {
    signup_grant: 'Tặng khi đăng ký', spend: 'Tiêu dùng', topup: 'Nạp thêm',
    free_topup: 'Nạp miễn phí', refund: 'Hoàn lại', admin_grant: 'Admin cấp',
};

const nf = (n: number) => n.toLocaleString('vi-VN');

function KpiCard({ icon, label, value, sub, tone = 'var(--accent-purple)' }: {
    icon: React.ReactNode; label: string; value: string; sub?: React.ReactNode; tone?: string;
}) {
    return (
        <div className="glass-card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center',
                    color: tone, background: 'color-mix(in srgb, currentColor 14%, transparent)',
                }}>{icon}</span>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1.1 }}>
                {value}
            </div>
            {sub != null && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{sub}</div>}
        </div>
    );
}

function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
    return (
        <div className="glass-card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</span>
                {right}
            </div>
            {children}
        </div>
    );
}

function Trend({ label, values, dates, total, color }: {
    label: string; values: number[]; dates: string[]; total: number; color: string;
}) {
    return (
        <div className="glass-card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
                <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>{nf(total)}</span>
            </div>
            <AreaChart data={values} dates={dates} color={color} />
        </div>
    );
}

export default function AnalyticsPanel() {
    const [days, setDays] = useState(30);
    const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
    const [ts, setTs] = useState<AnalyticsTimeseries | null>(null);
    const [funnel, setFunnel] = useState<Record<string, number> | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true); setError('');
        // All-time keeps the KPIs/funnel unbounded, but the daily series needs a
        // finite span — cap it at a year so the chart stays readable.
        const tsDays = days > 0 ? days : 365;
        try {
            const [s, t, f] = await Promise.all([
                admin.analyticsSummary(days),
                admin.analyticsTimeseries(tsDays),
                admin.analyticsFunnel(days),
            ]);
            setSummary(s); setTs(t); setFunnel(f);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Không tải được dữ liệu thống kê');
        } finally {
            setLoading(false);
        }
    }, [days]);

    useEffect(() => { load(); }, [load]);

    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Header + window selector */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, letterSpacing: '-0.02em' }}>Thống kê tổng quan</div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Người dùng, ứng tuyển, credit, việc làm & phễu chuyển đổi.</div>
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
                    fontSize: '0.82rem', color: 'var(--accent-red)', background: 'rgba(220,38,38,0.08)',
                    border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, padding: '10px 14px',
                }}>{error}</div>
            )}

            {!summary && loading && (
                <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.86rem' }}>Đang tải…</div>
            )}

            {summary && (
                <>
                    {/* KPI cards */}
                    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
                        <KpiCard icon={<Users size={17} weight="duotone" />} tone="var(--accent-purple)"
                            label="Người dùng" value={nf(summary.users.total)}
                            sub={<><b style={{ color: 'var(--accent-green)' }}>+{nf(summary.users.new)}</b> trong kỳ</>} />
                        <KpiCard icon={<Lightning size={17} weight="duotone" />} tone="var(--accent-blue)"
                            label="Phiên hoạt động" value={nf(summary.engagement.sessions)}
                            sub={`${nf(summary.engagement.events)} sự kiện`} />
                        <KpiCard icon={<Briefcase size={17} weight="duotone" />} tone="var(--accent-green)"
                            label="Đơn ứng tuyển" value={nf(summary.applications.total)}
                            sub={<><b style={{ color: 'var(--accent-green)' }}>+{nf(summary.applications.new)}</b> trong kỳ</>} />
                        <KpiCard icon={<Coins size={17} weight="duotone" />} tone="var(--accent-red)"
                            label="Credit đã tiêu" value={nf(summary.credits.spent)}
                            sub={`đã cấp ${nf(summary.credits.granted)} trong kỳ`} />
                        <KpiCard icon={<Briefcase size={17} weight="duotone" />} tone="var(--accent-blue)"
                            label="Việc làm đang mở" value={nf(summary.jobs.active)}
                            sub={`${nf(summary.jobs.dead)} đã đóng · ${nf(summary.jobs.total)} tổng`} />
                        <KpiCard icon={<Buildings size={17} weight="duotone" />} tone="var(--accent-purple)"
                            label="Công ty" value={nf(summary.jobs.companies)} />
                        <KpiCard icon={<Megaphone size={17} weight="duotone" />} tone="var(--accent-purple)"
                            label="Lượt xem trang TT" value={nf(summary.promoted.views)}
                            sub={`${nf(summary.promoted.published)}/${nf(summary.promoted.total)} đang công bố`} />
                        <KpiCard icon={<GraduationCap size={17} weight="duotone" />} tone="var(--accent-blue)"
                            label="Luyện phỏng vấn" value={nf(summary.interview.preps)}
                            sub={`${nf(summary.interview.attempts)} lượt trả lời`} />
                        <KpiCard icon={<ChatCircleDots size={17} weight="duotone" />} tone="var(--accent-green)"
                            label="Phản hồi" value={nf(summary.feedback.total)}
                            sub={summary.feedback.avg_rating != null ? `★ ${summary.feedback.avg_rating.toFixed(1)}/5` : 'chưa có đánh giá'} />
                    </div>

                    {/* Trends */}
                    {ts && (
                        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                            <Trend label="Đăng ký mới" values={ts.signups} dates={ts.dates} total={sum(ts.signups)} color="var(--accent-purple)" />
                            <Trend label="Phiên hoạt động" values={ts.sessions} dates={ts.dates} total={sum(ts.sessions)} color="var(--accent-blue)" />
                            <Trend label="Đơn ứng tuyển" values={ts.applications} dates={ts.dates} total={sum(ts.applications)} color="var(--accent-green)" />
                            <Trend label="Credit tiêu" values={ts.spend} dates={ts.dates} total={sum(ts.spend)} color="var(--accent-red)" />
                        </div>
                    )}

                    {/* Funnel */}
                    {funnel && <FunnelSection counts={funnel} />}

                    {/* Distributions */}
                    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                        <Section title="Đơn theo trạng thái">
                            <BarList color="var(--accent-green)"
                                items={STATUS_ORDER
                                    .filter((s) => (summary.applications.by_status[s] ?? 0) > 0)
                                    .map((s) => ({ label: STATUS_LABEL[s] ?? s, value: summary.applications.by_status[s] ?? 0 }))} />
                        </Section>
                        <Section title="Credit theo lý do">
                            <BarList color="var(--accent-red)"
                                items={Object.entries(summary.credits.by_reason)
                                    .map(([r, v]) => ({ label: REASON_LABEL[r] ?? r, value: Math.abs(v.total), hint: `· ${nf(v.count)} lần` }))
                                    .sort((a, b) => b.value - a.value)} />
                        </Section>
                        <Section title="Đánh giá phản hồi">
                            <BarList color="var(--accent-amber, #f59e0b)" emptyLabel="Chưa có đánh giá"
                                items={[5, 4, 3, 2, 1]
                                    .map((r) => ({ label: `${r} ★`, value: summary.feedback.rating_dist[r] ?? 0 }))
                                    .filter((i) => i.value > 0)} />
                        </Section>
                        <Section title="Sự kiện phổ biến">
                            <BarList color="var(--accent-blue)"
                                items={summary.top_events.map((e) => ({ label: e.event, value: e.count }))} />
                        </Section>
                        <Section title="Việc theo nhóm vai trò">
                            <BarList color="var(--accent-purple)"
                                items={(summary.facets.role_family ?? []).slice(0, 8).map((f) => ({ label: f.value, value: f.count }))} />
                        </Section>
                        <Section title="Việc theo lĩnh vực">
                            <BarList color="var(--accent-purple)"
                                items={(summary.facets.industry ?? []).slice(0, 8).map((f) => ({ label: f.value, value: f.count }))} />
                        </Section>
                    </div>
                </>
            )}
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
    );
}

// ── Funnel (distinct sessions per wizard step + drop-off) ──
function FunnelSection({ counts }: { counts: Record<string, number> }) {
    const first = counts[FUNNEL_STEPS[0].event] ?? 0;
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
    return (
        <Section title="Phễu chuyển đổi người dùng"
            right={<span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>số phiên đạt từng bước · % từ bước đầu</span>}>
            {first === 0 ? (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', padding: '8px 0' }}>Chưa có dữ liệu sự kiện nào.</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                    {FUNNEL_STEPS.map((step, i) => {
                        const n = counts[step.event] ?? 0;
                        const prev = i === 0 ? n : (counts[FUNNEL_STEPS[i - 1].event] ?? 0);
                        const fromStart = pct(n, first);
                        const drop = i === 0 ? 0 : Math.max(0, prev - n);
                        const dropPct = i === 0 ? 0 : pct(drop, prev);
                        return (
                            <div key={step.event}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{i + 1}. {step.label}</span>
                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                        <b style={{ color: 'var(--text-primary)' }}>{nf(n)}</b> · {fromStart}%
                                        {i > 0 && drop > 0 && (
                                            <span style={{ marginLeft: 8, color: 'var(--accent-red)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                                <TrendDown size={12} weight="bold" /> {dropPct}%
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <div style={{ height: 10, borderRadius: 999, background: 'var(--bg-secondary)', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${fromStart}%`, borderRadius: 999, background: 'var(--gradient-hero)', transition: 'width 0.3s ease' }} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </Section>
    );
}
