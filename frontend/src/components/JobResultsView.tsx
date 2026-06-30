'use client';

import { useState } from 'react';
import {
    X, MapPin, Buildings, Plus, ArrowRight, ArrowLeft, Sparkle,
    ArrowSquareOut, CaretDown, CaretUp, CircleNotch,
} from '@phosphor-icons/react';
import type { CandidateJob } from '@/store/useAppStore';
import { fetchPage } from '@/lib/api';

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

// ── Lightweight JD formatter ─────────────────────────────────────────────────
// fetchPage returns the whole page's text (nav, metadata, repeated title, then
// the JD) as flat lines. Rather than dump it raw, we trim the leading nav/meta
// noise and render headings / bullets / paragraphs with real typography. No AI.

const HEADING_RX = /(responsibilit|requirement|qualificat|benefit|compensation|what you|we offer|about (the )?(role|us|company|team)|overview|job description|job purpose|key (responsibilit|skill|requirement)|mô tả công việc|mô tả|yêu cầu|quyền lợi|phúc lợi|kỹ năng|kinh nghiệm|học vấn|nhiệm vụ|trách nhiệm|đãi ngộ)/i;

function looksHeading(line: string): boolean {
    if (line.length > 64) return false;
    const words = line.split(/\s+/).length;
    if (/[:：]\s*$/.test(line) && words <= 9) return true;
    return HEADING_RX.test(line) && words <= 9;
}

function bulletText(line: string): string | null {
    const m = line.match(/^\s*(?:[-–—•*·▪◦‣]|\d+[.)]|[a-zA-Z][.)])\s+(.*\S)\s*$/);
    return m ? m[1].trim() : null;
}

// Drop the leading run of nav / metadata lines (short labels like "Back",
// "Full Time", a city, a date) up to the first real JD content — the first
// heading keyword or the first long sentence. Only trims when every dropped
// line is short, so we never eat real content.
function trimLeadingNoise(lines: string[]): string[] {
    let start = -1;
    for (let i = 0; i < Math.min(lines.length, 16); i++) {
        const l = lines[i].trim();
        if (!l) continue;
        if (looksHeading(l) || l.length > 60) { start = i; break; }
    }
    if (start <= 0) return lines;
    const dropped = lines.slice(0, start).map((l) => l.trim()).filter(Boolean);
    return dropped.every((l) => l.length <= 48) ? lines.slice(start) : lines;
}

function JdBody({ text }: { text: string }) {
    const lines = trimLeadingNoise(text.replace(/\r/g, '').split('\n'));
    const blocks: React.ReactNode[] = [];
    let first = true;
    lines.forEach((raw, i) => {
        const line = raw.trim();
        if (!line) return;
        const bt = bulletText(line);
        if (bt !== null) {
            blocks.push(
                <div key={i} style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <span style={{ color: 'var(--accent-purple, #8b5cf6)', flexShrink: 0 }}>•</span>
                    <span>{bt}</span>
                </div>,
            );
        } else if (looksHeading(line)) {
            blocks.push(
                <div key={i} style={{
                    fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.84rem',
                    marginTop: first ? 0 : 14, marginBottom: 2,
                }}>
                    {line.replace(/[:：]\s*$/, '')}
                </div>,
            );
        } else {
            blocks.push(<p key={i} style={{ margin: first ? '0' : '6px 0 0' }}>{line}</p>);
        }
        first = false;
    });
    return <>{blocks}</>;
}

// One job card with a collapsible JD. The description is shown from the search
// prefetch when present; otherwise it's lazily fetched from the posting page on
// first expand (fetchPage renders SPA/IP-blocked pages server-side). This is a
// plain crawl — no AI credits — so it isn't gated.
function JobCard({ c, busy, onRemove }: { c: CandidateJob; busy: boolean; onRemove: (id: string) => void }) {
    const jdLink = c.applyUrl || c.url;
    const prefetched = c.description?.trim() || '';
    const [open, setOpen] = useState(false);
    const [jd, setJd] = useState<string | null>(prefetched || null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const toggle = async () => {
        const next = !open;
        setOpen(next);
        if (!next || jd !== null || loading) return;
        if (!jdLink) { setError('Không có liên kết mô tả cho việc này.'); return; }
        setLoading(true);
        setError('');
        try {
            const r = await fetchPage(jdLink);
            if (r.success && r.text?.trim()) setJd(r.text.trim());
            else setError(r.blocked
                ? 'Trang mô tả chặn truy cập tự động — mở ở tab mới để xem đầy đủ.'
                : 'Chưa lấy được mô tả công việc.');
        } catch {
            setError('Chưa lấy được mô tả công việc.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="glass-card" style={{ padding: '14px 16px', borderRadius: 'var(--radius-lg)', opacity: busy ? 0.6 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    {jdLink ? (
                        <a
                            href={jdLink} target="_blank" rel="noopener noreferrer"
                            title="Mở trang tuyển dụng (tab mới)"
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

                    {jdLink && (
                        <button
                            onClick={toggle}
                            disabled={busy}
                            style={{
                                marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 5,
                                background: 'none', border: 'none', padding: 0,
                                color: 'var(--accent-purple, #8b5cf6)', fontSize: '0.78rem', fontWeight: 600,
                                cursor: busy ? 'default' : 'pointer',
                            }}
                        >
                            {open ? <CaretUp size={13} weight="bold" /> : <CaretDown size={13} weight="bold" />}
                            {open ? 'Thu gọn mô tả' : 'Xem mô tả công việc'}
                        </button>
                    )}
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

            {open && (
                <div style={{
                    marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)',
                }}>
                    {loading ? (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            fontSize: '0.8rem', color: 'var(--text-muted)', padding: '6px 0',
                        }}>
                            <CircleNotch size={15} className="spin" /> Đang tải mô tả công việc…
                        </div>
                    ) : error ? (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                            {error}{' '}
                            {jdLink && (
                                <a href={jdLink} target="_blank" rel="noopener noreferrer"
                                    style={{ color: 'var(--accent-purple, #8b5cf6)', fontWeight: 600 }}>
                                    Mở trang →
                                </a>
                            )}
                        </div>
                    ) : jd ? (
                        <div style={{
                            maxHeight: 340, overflowY: 'auto',
                            fontSize: '0.82rem', lineHeight: 1.6, color: 'var(--text-secondary)',
                            wordBreak: 'break-word',
                        }}>
                            <JdBody text={jd} />
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}

export default function JobResultsView({
    candidates, poolRemaining, busy, onRemove, onFindMore, onOptimize, onBack,
}: Props) {
    const count = candidates.length;

    return (
        <div>
            {/* Job cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {candidates.map((c) => (
                    <JobCard key={c.id} c={c} busy={busy} onRemove={onRemove} />
                ))}

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
