'use client';

// Deep gap-analysis section, shown inside the match panel's gap area. One click
// generates an AI report: where the CV falls short of the JD, split into
// "chưa thể hiện" (you likely have it — surface it) vs "cần bổ sung" (a real
// gap — close it), each with a concrete recommendation. Credit-metered.
import {
    MagnifyingGlassPlus, CircleNotch, Warning, CheckCircle, Sparkle,
    Eye, GraduationCap, ArrowsClockwise,
} from '@phosphor-icons/react';
import { generateGapReport } from '@/lib/api';
import { useAuthGate } from '@/lib/auth';
import { useCredits } from '@/lib/credits-context';
import { useAppStore } from '@/store/useAppStore';
import type { GapItem, GapSeverity } from '@/lib/gap-report';
import type { CVData, JDData, MatchResult } from '@/lib/types';

const SEV: Record<GapSeverity, { label: string; color: string }> = {
    critical: { label: 'Quan trọng', color: 'var(--accent-red, #ef4444)' },
    moderate: { label: 'Vừa', color: 'var(--accent-amber, #f59e0b)' },
    minor: { label: 'Nhẹ', color: 'var(--text-muted)' },
};

function GapCard({ g }: { g: GapItem }) {
    const sev = SEV[g.severity] ?? SEV.minor;
    return (
        <div style={{
            border: '1px solid var(--border-subtle)', borderLeft: `3px solid ${sev.color}`,
            borderRadius: 8, padding: '10px 12px', background: 'var(--bg-card)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>{g.area}</span>
                <span style={{
                    fontSize: '0.62rem', fontWeight: 700, padding: '1px 7px', borderRadius: 10,
                    color: sev.color, background: `color-mix(in srgb, ${sev.color} 14%, transparent)`,
                }}>{sev.label}</span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 6px' }}>{g.detail}</p>
            <div style={{ display: 'flex', gap: 6, fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                <Sparkle size={13} weight="fill" style={{ color: 'var(--accent-purple, #8b5cf6)', flexShrink: 0, marginTop: 2 }} />
                <span><strong>Nên làm:</strong> {g.recommendation}</span>
            </div>
        </div>
    );
}

export default function GapReportSection(
    { entryId, cv, jd, match, embedded = false }: {
        entryId: string; cv: CVData; jd?: JDData; match?: MatchResult;
        // true when shown as the full-width "Phân tích" tab (vs inline in the
        // match panel) — lets the layout drop the inline top border/spacing.
        embedded?: boolean;
    },
) {
    void embedded;
    const gate = useAuthGate();
    const { refresh } = useCredits();
    // State lives on the jdEntry (store), not here — so switching tabs/jobs
    // mid-analysis doesn't throw away a credit-charged report, and the result is
    // written even if this component has unmounted by the time the call resolves.
    const updateJdEntry = useAppStore((s) => s.updateJdEntry);
    const entry = useAppStore((s) => s.jdEntries.find((e) => e.id === entryId));
    const report = entry?.gapReport ?? null;
    const loading = entry?.gapLoading ?? false;
    const error = entry?.gapError ?? '';

    const run = async () => {
        if (!jd || loading) return;
        if (!gate('Đăng nhập để tạo báo cáo gap bằng AI (tặng 50 credit).')) return;
        updateJdEntry(entryId, { gapLoading: true, gapError: undefined });
        try {
            const r = await generateGapReport(cv, jd, match);
            updateJdEntry(entryId, { gapReport: r, gapLoading: false });
            refresh();
        } catch (e) {
            updateJdEntry(entryId, {
                gapError: e instanceof Error ? e.message : 'Tạo báo cáo thất bại',
                gapLoading: false,
            });
        }
    };

    if (!jd) return null;

    const presentation = report?.gaps.filter((g) => g.type === 'presentation') ?? [];
    const capability = report?.gaps.filter((g) => g.type === 'capability') ?? [];

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <MagnifyingGlassPlus size={15} weight="duotone" style={{ color: 'var(--accent-purple, #8b5cf6)' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>Phân tích gap chuyên sâu</span>
            </div>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.5 }}>
                AI chỉ ra CV của bạn còn thiếu/yếu gì so với job này và nên làm gì để khớp hơn.
            </p>

            {!report && (
                <button
                    onClick={run} disabled={loading}
                    className="btn-primary"
                    style={{
                        display: 'flex', alignItems: 'center', gap: 7, width: '100%', justifyContent: 'center',
                        padding: '9px 14px', fontSize: '0.82rem', opacity: loading ? 0.7 : 1,
                    }}
                >
                    {loading
                        ? <><CircleNotch size={14} className="spin" /> Đang phân tích…</>
                        : <><MagnifyingGlassPlus size={15} weight="bold" /> Tạo báo cáo gap (~5 credit)</>}
                </button>
            )}

            {error && (
                <div style={{
                    marginTop: 8, padding: '8px 10px', borderRadius: 8, fontSize: '0.78rem',
                    background: 'rgba(239,68,68,0.08)', color: 'var(--accent-red, #ef4444)',
                    display: 'flex', alignItems: 'center', gap: 6,
                }}>
                    <Warning size={13} /> {error}
                </div>
            )}

            {report && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Summary + readiness */}
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Mức sẵn sàng
                            </span>
                            <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)' }}>{report.readiness}/100</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 999, background: 'var(--border-subtle)', overflow: 'hidden', marginBottom: 8 }}>
                            <div style={{ width: `${report.readiness}%`, height: '100%', background: 'var(--gradient-hero)' }} />
                        </div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>{report.summary}</p>
                    </div>

                    {/* Strengths */}
                    {report.strengths.length > 0 && (
                        <div>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-green)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                                <CheckCircle size={13} weight="fill" /> Điểm đã khớp
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {report.strengths.map((s, i) => (
                                    <li key={i} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{s}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Presentation gaps */}
                    {presentation.length > 0 && (
                        <div>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-blue)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                                <Eye size={14} weight="duotone" /> Chưa thể hiện trong CV ({presentation.length})
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {presentation.map((g, i) => <GapCard key={i} g={g} />)}
                            </div>
                        </div>
                    )}

                    {/* Capability gaps */}
                    {capability.length > 0 && (
                        <div>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-amber, #f59e0b)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                                <GraduationCap size={14} weight="duotone" /> Cần bổ sung năng lực ({capability.length})
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {capability.map((g, i) => <GapCard key={i} g={g} />)}
                            </div>
                        </div>
                    )}

                    <button
                        onClick={run} disabled={loading}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
                            background: 'none', border: 'none', cursor: loading ? 'default' : 'pointer',
                            color: 'var(--text-muted)', fontSize: '0.76rem', fontWeight: 600, padding: 0,
                        }}
                    >
                        <ArrowsClockwise size={13} className={loading ? 'spin' : undefined} /> Tạo lại
                    </button>
                </div>
            )}
        </div>
    );
}
