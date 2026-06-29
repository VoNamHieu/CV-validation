'use client';

import { useMemo, useState } from 'react';
import {
    Briefcase, MagnifyingGlass, ArrowSquareOut, Trash, CaretDown, CaretUp,
    Trophy, Crosshair, TrendUp, Warning, Clock, Globe, Sparkle,
    ArrowClockwise, NotePencil, FunnelSimple,
} from '@phosphor-icons/react';
import { useAppStore, JobRecord, JobStatus, JOB_STATUS_ORDER } from '@/store/useAppStore';

// ── Status presentation ──
const STATUS_META: Record<JobStatus, { label: string; color: string; bg: string; border: string }> = {
    saved: { label: 'Đã lưu', color: 'var(--text-secondary)', bg: 'var(--bg-elevated)', border: 'var(--border-default)' },
    applied: { label: 'Đã ứng tuyển', color: 'var(--accent-blue)', bg: 'rgba(99, 102, 241, 0.12)', border: 'rgba(99, 102, 241, 0.3)' },
    interviewing: { label: 'Phỏng vấn', color: 'var(--accent-purple)', bg: 'rgba(167, 139, 250, 0.12)', border: 'rgba(167, 139, 250, 0.3)' },
    offer: { label: 'Nhận offer', color: 'var(--accent-green)', bg: 'rgba(52, 211, 153, 0.12)', border: 'rgba(52, 211, 153, 0.3)' },
    rejected: { label: 'Bị từ chối', color: 'var(--accent-red)', bg: 'rgba(248, 113, 113, 0.1)', border: 'rgba(248, 113, 113, 0.25)' },
};

type StatusFilter = 'all' | JobStatus;
type SortKey = 'date-desc' | 'date-asc' | 'score-desc' | 'score-asc';

function ScoreBadge({ score }: { score: number }) {
    let color = 'var(--accent-red)';
    let bg = 'rgba(248, 113, 113, 0.12)';
    if (score >= 80) { color = 'var(--accent-green)'; bg = 'rgba(52, 211, 153, 0.12)'; }
    else if (score >= 60) { color = 'var(--accent-blue)'; bg = 'rgba(99, 102, 241, 0.12)'; }
    else if (score >= 40) { color = 'var(--accent-amber)'; bg = 'rgba(251, 191, 36, 0.12)'; }

    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 20,
            background: bg, color, fontWeight: 700, fontSize: '0.85rem',
        }}>
            <Trophy size={13} weight="fill" />
            {score}%
        </span>
    );
}

function StatusPill({
    status, onChange,
}: { status: JobStatus; onChange: (s: JobStatus) => void }) {
    const meta = STATUS_META[status];
    return (
        <select
            value={status}
            onChange={(e) => onChange(e.target.value as JobStatus)}
            onClick={(e) => e.stopPropagation()}
            aria-label="Trạng thái ứng tuyển"
            style={{
                appearance: 'none',
                background: meta.bg,
                color: meta.color,
                border: `1px solid ${meta.border}`,
                borderRadius: 20,
                padding: '4px 26px 4px 10px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path fill='${encodeURIComponent(meta.color)}' d='M1 3l4 4 4-4z'/></svg>")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 8px center',
                backgroundSize: '8px',
            }}
        >
            {JOB_STATUS_ORDER.map((s) => (
                <option key={s} value={s} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
                    {STATUS_META[s].label}
                </option>
            ))}
        </select>
    );
}

function formatDate(ts: number) {
    const d = new Date(ts);
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ── Score breakdown (expanded row) ──
function ScoreBreakdown({ record }: { record: JobRecord }) {
    const match = record.matchResult;
    if (!match) {
        return (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
                Không có chi tiết điểm cho mục này.
            </p>
        );
    }

    const categories = [
        { label: 'Kỹ năng bắt buộc', data: match.must_have_match, icon: Crosshair },
        { label: 'Kinh nghiệm', data: match.experience_match, icon: TrendUp },
        { label: 'Lĩnh vực', data: match.domain_match, icon: Globe },
        { label: 'Cấp bậc', data: match.seniority_match, icon: Trophy },
    ];

    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
                {categories.map(({ label, data, icon: Icon }) => (
                    <div key={label} style={{
                        padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <Icon size={13} weight="duotone" style={{ color: 'var(--accent-cyan)' }} />
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{label}</span>
                            <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: '0.82rem' }}>{data.score}%</span>
                        </div>
                        <div style={{ width: '100%', height: 4, borderRadius: 2, background: 'var(--border-subtle)', overflow: 'hidden' }}>
                            <div style={{
                                width: `${data.score}%`, height: '100%', borderRadius: 2,
                                background: data.score >= 70 ? 'var(--accent-green)' : data.score >= 40 ? 'var(--accent-amber)' : 'var(--accent-red)',
                                transition: 'width 0.5s ease',
                            }} />
                        </div>
                    </div>
                ))}
            </div>

            {match.strength_summary && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <Sparkle size={13} weight="fill" style={{ color: 'var(--accent-green)', marginTop: 3, flexShrink: 0 }} />
                    {match.strength_summary}
                </p>
            )}

            {match.risk_flags && match.risk_flags.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {match.risk_flags.map((flag, i) => (
                        <span key={i} style={{
                            fontSize: '0.72rem', padding: '3px 8px', borderRadius: 12,
                            background: 'rgba(248, 113, 113, 0.08)', color: 'var(--accent-red)',
                            display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                            <Warning size={10} weight="fill" /> {flag}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Notes editor (autosave on blur) ──
function NotesEditor({ recordId, initial }: { recordId: string; initial: string }) {
    const updateJobRecord = useAppStore((s) => s.updateJobRecord);
    const [value, setValue] = useState(initial);

    return (
        <div style={{ marginTop: 14 }}>
            <label style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: '0.72rem', color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600,
                marginBottom: 6,
            }}>
                <NotePencil size={12} weight="duotone" /> Ghi chú
            </label>
            <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => {
                    if (value !== initial) updateJobRecord(recordId, { notes: value });
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder="Liên hệ nhà tuyển dụng, chuẩn bị phỏng vấn, bước tiếp theo..."
                rows={2}
                className="input-field"
                style={{
                    fontSize: '0.82rem',
                    padding: '8px 12px',
                    minHeight: 60,
                }}
            />
        </div>
    );
}

// ── Empty state ──
function EmptyState() {
    return (
        <div style={{
            padding: '64px 24px',
            textAlign: 'center',
            border: '1px dashed var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--gradient-card)',
        }}>
            <div style={{
                width: 56, height: 56, borderRadius: 14,
                background: 'var(--gradient-hero-subtle)',
                border: '1px solid var(--border-subtle)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 16,
            }}>
                <Briefcase size={24} weight="duotone" style={{ color: 'var(--accent-blue)' }} />
            </div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 6, letterSpacing: '-0.02em' }}>
                Chưa có hồ sơ ứng tuyển nào
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', maxWidth: 360, margin: '0 auto' }}>
                Hãy tìm việc ở tab Ứng tuyển — các việc đã chấm điểm sẽ hiện ở đây để bạn theo dõi tiến trình.
            </p>
        </div>
    );
}

export default function HistoryView() {
    const jobHistory = useAppStore((s) => s.jobHistory);
    const updateJobRecord = useAppStore((s) => s.updateJobRecord);
    const removeJobRecord = useAppStore((s) => s.removeJobRecord);
    const clearJobHistory = useAppStore((s) => s.clearJobHistory);
    const loadJobRecordIntoWizard = useAppStore((s) => s.loadJobRecordIntoWizard);

    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [sortKey, setSortKey] = useState<SortKey>('date-desc');

    const visible = useMemo(() => {
        const q = query.trim().toLowerCase();
        const filtered = jobHistory.filter((r) => {
            if (statusFilter !== 'all' && r.status !== statusFilter) return false;
            if (!q) return true;
            return (
                r.jobTitle?.toLowerCase().includes(q) ||
                r.company?.toLowerCase().includes(q) ||
                r.siteName?.toLowerCase().includes(q) ||
                r.notes?.toLowerCase().includes(q)
            );
        });
        const sorted = [...filtered].sort((a, b) => {
            switch (sortKey) {
                case 'date-asc': return a.timestamp - b.timestamp;
                case 'score-desc': return b.overallScore - a.overallScore;
                case 'score-asc': return a.overallScore - b.overallScore;
                case 'date-desc':
                default: return b.timestamp - a.timestamp;
            }
        });
        return sorted;
    }, [jobHistory, query, statusFilter, sortKey]);

    // Counts per status for filter pill
    const statusCounts = useMemo(() => {
        const counts: Record<StatusFilter, number> = {
            all: jobHistory.length,
            saved: 0, applied: 0, interviewing: 0, offer: 0, rejected: 0,
        };
        for (const r of jobHistory) counts[r.status] = (counts[r.status] ?? 0) + 1;
        return counts;
    }, [jobHistory]);

    return (
        <div className="animate-fade-in" style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
                <div>
                    <h1 style={{
                        fontSize: '1.7rem', fontWeight: 800, marginBottom: 6,
                        letterSpacing: '-0.03em',
                        display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                        <Briefcase size={24} weight="duotone" style={{ color: 'var(--accent-blue)' }} />
                        Hồ sơ ứng tuyển
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        Theo dõi mọi việc bạn đã chấm điểm — trạng thái, ghi chú và mở lại chỉ với một cú bấm.
                    </p>
                </div>
                {jobHistory.length > 0 && (
                    <button
                        onClick={() => {
                            if (confirm(`Xoá toàn bộ ${jobHistory.length} hồ sơ ứng tuyển? Hành động này không thể hoàn tác.`)) {
                                clearJobHistory();
                            }
                        }}
                        className="btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem' }}
                    >
                        <Trash size={14} weight="bold" /> Xoá tất cả
                    </button>
                )}
            </div>

            {jobHistory.length === 0 ? (
                <EmptyState />
            ) : (
                <>
                    {/* Toolbar */}
                    <div style={{
                        display: 'flex', flexWrap: 'wrap', gap: 10,
                        marginBottom: 18, alignItems: 'center',
                    }}>
                        {/* Search */}
                        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
                            <MagnifyingGlass
                                size={15}
                                weight="bold"
                                style={{
                                    position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                                    color: 'var(--text-muted)', pointerEvents: 'none',
                                }}
                            />
                            <input
                                className="input-field"
                                type="search"
                                placeholder="Tìm theo việc, công ty, ghi chú…"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                style={{ paddingLeft: 36, fontSize: '0.85rem', padding: '10px 14px 10px 36px' }}
                            />
                        </div>

                        {/* Status filter */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <FunnelSimple size={14} weight="duotone" style={{ color: 'var(--text-muted)' }} />
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                                className="input-field"
                                style={{ padding: '9px 12px', fontSize: '0.82rem', width: 'auto', cursor: 'pointer' }}
                                aria-label="Lọc theo trạng thái"
                            >
                                <option value="all">Tất cả trạng thái ({statusCounts.all})</option>
                                {JOB_STATUS_ORDER.map((s) => (
                                    <option key={s} value={s}>
                                        {STATUS_META[s].label} ({statusCounts[s]})
                                    </option>
                                ))}
                            </select>
                        </div>

                        {/* Sort */}
                        <select
                            value={sortKey}
                            onChange={(e) => setSortKey(e.target.value as SortKey)}
                            className="input-field"
                            style={{ padding: '9px 12px', fontSize: '0.82rem', width: 'auto', cursor: 'pointer' }}
                            aria-label="Sắp xếp theo"
                        >
                            <option value="date-desc">Mới nhất</option>
                            <option value="date-asc">Cũ nhất</option>
                            <option value="score-desc">Điểm cao nhất</option>
                            <option value="score-asc">Điểm thấp nhất</option>
                        </select>
                    </div>

                    {/* Result count when filtered */}
                    {(query || statusFilter !== 'all') && (
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                            Hiển thị {visible.length} / {jobHistory.length}
                        </p>
                    )}

                    {visible.length === 0 ? (
                        <div style={{
                            padding: '40px 20px', textAlign: 'center',
                            border: '1px dashed var(--border-default)',
                            borderRadius: 'var(--radius-lg)',
                            fontSize: '0.88rem', color: 'var(--text-muted)',
                        }}>
                            Không có hồ sơ nào khớp bộ lọc.
                        </div>
                    ) : (
                        <div style={{
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--border-subtle)',
                            background: 'var(--bg-card)',
                            overflow: 'hidden',
                            boxShadow: 'var(--shadow-card)',
                        }}>
                            {/* Table Header */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'minmax(0, 1fr) 130px 130px 80px 90px 40px',
                                padding: '10px 18px',
                                fontSize: '0.7rem',
                                color: 'var(--text-muted)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                fontWeight: 600,
                                borderBottom: '1px solid var(--border-subtle)',
                                background: 'rgba(0,0,0,0.15)',
                                alignItems: 'center',
                            }}>
                                <span>Việc làm</span>
                                <span>Nguồn</span>
                                <span>Trạng thái</span>
                                <span>Điểm</span>
                                <span>Ngày</span>
                                <span></span>
                            </div>

                            {visible.map((record) => {
                                const isExpanded = expandedId === record.id;
                                return (
                                    <div key={record.id}>
                                        <div
                                            onClick={() => setExpandedId(isExpanded ? null : record.id)}
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'minmax(0, 1fr) 130px 130px 80px 90px 40px',
                                                padding: '14px 18px',
                                                alignItems: 'center',
                                                cursor: 'pointer',
                                                borderBottom: '1px solid var(--border-subtle)',
                                                transition: 'background 0.15s',
                                                background: isExpanded ? 'var(--bg-card-hover)' : 'transparent',
                                            }}
                                            onMouseEnter={(e) => {
                                                if (!isExpanded) e.currentTarget.style.background = 'var(--bg-card-hover)';
                                            }}
                                            onMouseLeave={(e) => {
                                                if (!isExpanded) e.currentTarget.style.background = 'transparent';
                                            }}
                                        >
                                            {/* Job Title + Company */}
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{
                                                    fontWeight: 600, fontSize: '0.88rem', lineHeight: 1.3,
                                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                }}>
                                                    {record.jobTitle || 'Việc chưa đặt tên'}
                                                </div>
                                                {record.company && (
                                                    <div style={{
                                                        fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2,
                                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                    }}>
                                                        {record.company}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Site */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                                                <Globe size={12} weight="duotone" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                                <a
                                                    href={record.jobUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    style={{
                                                        fontSize: '0.78rem', color: 'var(--accent-cyan)',
                                                        textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3,
                                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                    }}
                                                >
                                                    {record.siteName} <ArrowSquareOut size={10} />
                                                </a>
                                            </div>

                                            {/* Status */}
                                            <StatusPill
                                                status={record.status}
                                                onChange={(s) => updateJobRecord(record.id, { status: s })}
                                            />

                                            {/* Score */}
                                            <ScoreBadge score={record.overallScore} />

                                            {/* Date */}
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <Clock size={11} weight="regular" />
                                                {formatDate(record.timestamp)}
                                            </span>

                                            {/* Expand */}
                                            {isExpanded
                                                ? <CaretUp size={16} weight="bold" style={{ color: 'var(--text-muted)' }} />
                                                : <CaretDown size={16} weight="bold" style={{ color: 'var(--text-muted)' }} />
                                            }
                                        </div>

                                        {isExpanded && (
                                            <div style={{
                                                padding: '16px 22px 18px',
                                                background: 'rgba(99, 102, 241, 0.03)',
                                                borderBottom: '1px solid var(--border-subtle)',
                                            }}>
                                                <ScoreBreakdown record={record} />
                                                <NotesEditor recordId={record.id} initial={record.notes ?? ''} />

                                                {/* Row actions */}
                                                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); loadJobRecordIntoWizard(record.id); }}
                                                        className="btn-primary"
                                                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: '0.82rem' }}
                                                    >
                                                        <ArrowClockwise size={13} weight="bold" /> Mở lại
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (confirm(`Xoá hồ sơ ứng tuyển này?`)) removeJobRecord(record.id);
                                                        }}
                                                        className="btn-secondary"
                                                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: '0.82rem', color: 'var(--accent-red)' }}
                                                    >
                                                        <Trash size={13} weight="bold" /> Xoá
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
