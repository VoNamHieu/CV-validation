'use client';

import { X, MapPin, Buildings, Plus, ArrowRight, ArrowLeft, Sparkle, ArrowSquareOut } from '@phosphor-icons/react';
import type { CandidateJob } from '@/store/useAppStore';

// Results page shown between the search step and the editor. Lets the user
// curate the discovered jobs — remove ones they don't want, reveal more from
// the ranked pool — before we spend credits crawling + scoring + tailoring.
interface Props {
    candidates: CandidateJob[];
    poolRemaining: number;
    busy: boolean;
    onRemove: (id: string) => void;
    onFindMore: () => void;
    onOptimize: () => void;
    onBack: () => void;
}

export default function JobResultsView({
    candidates, poolRemaining, busy, onRemove, onFindMore, onOptimize, onBack,
}: Props) {
    const count = candidates.length;

    return (
        <div>
            {/* Job cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {candidates.map((c) => {
                    const jdLink = c.applyUrl || c.url;
                    return (
                    <div
                        key={c.id}
                        className="glass-card"
                        style={{
                            display: 'flex', alignItems: 'flex-start', gap: 12,
                            padding: '14px 16px', borderRadius: 'var(--radius-lg)',
                            opacity: busy ? 0.6 : 1,
                        }}
                    >
                        <div style={{ flex: 1, minWidth: 0 }}>
                            {jdLink ? (
                                <a
                                    href={jdLink} target="_blank" rel="noopener noreferrer"
                                    title="Xem mô tả công việc (mở tab mới)"
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%',
                                        fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)',
                                        marginBottom: 4, textDecoration: 'none',
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-purple, #8b5cf6)'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                                >
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                                    <ArrowSquareOut size={14} weight="bold" style={{ flexShrink: 0, opacity: 0.7 }} />
                                </a>
                            ) : (
                                <div style={{
                                    fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)',
                                    marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                    {c.title}
                                </div>
                            )}
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                                fontSize: '0.78rem', color: 'var(--text-secondary)',
                            }}>
                                {c.company && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        <Buildings size={14} weight="duotone" /> {c.company}
                                    </span>
                                )}
                                {c.location && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        <MapPin size={14} weight="duotone" /> {c.location}
                                    </span>
                                )}
                                {c.locationNote && (
                                    <span style={{
                                        fontSize: '0.7rem', padding: '1px 8px', borderRadius: 20,
                                        background: 'rgba(245,158,11,0.12)', color: 'var(--accent-amber, #f59e0b)',
                                        fontWeight: 600,
                                    }}>
                                        {c.locationNote}
                                    </span>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={() => onRemove(c.id)}
                            disabled={busy}
                            aria-label={`Bỏ ${c.title}`}
                            title="Bỏ việc này"
                            style={{
                                flexShrink: 0, width: 30, height: 30, borderRadius: 8,
                                border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
                                color: 'var(--text-muted)', cursor: busy ? 'default' : 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                        >
                            <X size={15} weight="bold" />
                        </button>
                    </div>
                    );
                })}

                {count === 0 && (
                    <div style={{
                        padding: '24px 16px', textAlign: 'center',
                        fontSize: '0.85rem', color: 'var(--text-muted)',
                        border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-lg)',
                    }}>
                        Bạn đã bỏ hết việc. Bấm “Tìm thêm việc” để xem các gợi ý khác.
                    </div>
                )}
            </div>

            {/* Find more */}
            <button
                onClick={onFindMore}
                disabled={busy || poolRemaining === 0}
                style={{
                    width: '100%', marginBottom: 16, padding: '11px 12px',
                    borderRadius: 'var(--radius-lg)', border: '1px dashed var(--border-subtle)',
                    background: 'var(--bg-card)', color: 'var(--text-secondary)',
                    fontSize: '0.85rem', fontWeight: 600,
                    cursor: (busy || poolRemaining === 0) ? 'default' : 'pointer',
                    opacity: (busy || poolRemaining === 0) ? 0.5 : 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
            >
                <Plus size={16} weight="bold" />
                {poolRemaining > 0 ? `Tìm thêm việc (còn ${poolRemaining})` : 'Đã hết gợi ý'}
            </button>

            {/* Primary CTA: spend credits to score + tailor the kept jobs */}
            <button
                className="btn-primary"
                onClick={onOptimize}
                disabled={busy || count === 0}
                style={{
                    width: '100%', height: 56, fontSize: '0.98rem', fontWeight: 600,
                    borderRadius: 'var(--radius-lg)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    opacity: (busy || count === 0) ? 0.7 : 1,
                }}
            >
                <Sparkle size={18} weight="fill" />
                {busy ? 'Đang tối ưu…' : `Tối ưu CV cho ${count} việc`}
                {!busy && count > 0 && <ArrowRight size={18} weight="bold" />}
            </button>

            <div style={{
                marginTop: 8, textAlign: 'center',
                fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4,
            }}>
                AI sẽ chấm điểm và viết lại CV phù hợp cho từng việc bạn giữ lại
            </div>

            {/* Back to search */}
            <div style={{ marginTop: 24 }}>
                <button
                    className="btn-secondary"
                    onClick={onBack}
                    disabled={busy}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                    <ArrowLeft size={16} weight="bold" /> Tìm kiếm lại
                </button>
            </div>
        </div>
    );
}
