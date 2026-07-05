'use client';

// Interview-prep dossier viewer. Opened from the history board for a scored
// job: computes the tailored-CV hash, serves a cached dossier if one exists,
// otherwise generates one via the free /api/ai/interview-dossier route and
// caches it. Read-only for now (the practice loop is a later phase).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkle, Question, Target, ShieldWarning, Lightning } from '@phosphor-icons/react';
import { useAppStore, JobRecord } from '@/store/useAppStore';
import { account } from '@/lib/db';
import { cvHash } from '@/lib/interview/cv-hash';
import { useModalA11y } from '@/lib/useModalA11y';
import type { Dossier, DossierQuestion } from '@/lib/interview/dossier';

type State =
    | { phase: 'loading' }
    | { phase: 'no-cv' }
    | { phase: 'ready'; dossier: Dossier }
    | { phase: 'error'; error: string };

const DIFF_META: Record<DossierQuestion['difficulty'], { label: string; color: string }> = {
    easy: { label: 'Dễ', color: 'var(--accent-green)' },
    medium: { label: 'Trung bình', color: 'var(--accent-amber)' },
    hard: { label: 'Khó', color: 'var(--accent-red)' },
};

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <h3 style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: '0.95rem', fontWeight: 700, margin: '22px 0 12px',
            letterSpacing: '-0.01em',
        }}>
            {icon} {children}
        </h3>
    );
}

export default function InterviewPrepModal({ record, onClose }: { record: JobRecord; onClose: () => void }) {
    const contentRef = useModalA11y<HTMLDivElement>(onClose);
    const baseCv = useAppStore((s) => s.cvData);
    const [state, setState] = useState<State>({ phase: 'loading' });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const tailored = record.optimizedCv;
            if (!tailored) { setState({ phase: 'no-cv' }); return; }
            try {
                const hash = await cvHash(tailored);
                // Cache lookup is best-effort — any failure (miss, not logged in)
                // just falls through to generation.
                try {
                    const cached = await account.getInterviewPrep(record.id, hash);
                    if (cached?.dossier) { if (!cancelled) setState({ phase: 'ready', dossier: cached.dossier }); return; }
                } catch { /* fall through to generate */ }

                const res = await fetch('/api/ai/interview-dossier', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        cv: baseCv ?? tailored,
                        jd: record.jdData,
                        match: record.matchResult,
                        tailoredCv: tailored,
                    }),
                });
                if (!res.ok) {
                    const j = await res.json().catch(() => ({}));
                    throw new Error(j.detail || 'Không tạo được bộ chuẩn bị phỏng vấn.');
                }
                const { dossier } = await res.json();
                if (cancelled) return;
                setState({ phase: 'ready', dossier });
                // Cache for next time (needs auth; harmless if it fails).
                account.putInterviewPrep(record.id, hash, dossier).catch(() => {});
            } catch (e) {
                if (!cancelled) setState({ phase: 'error', error: e instanceof Error ? e.message : 'Đã xảy ra lỗi.' });
            }
        })();
        return () => { cancelled = true; };
    }, [record, baseCv]);

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            role="presentation"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 130, background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 16,
            }}
        >
            <div
                ref={contentRef}
                role="dialog"
                aria-modal="true"
                aria-label="Chuẩn bị phỏng vấn"
                tabIndex={-1}
                style={{
                    width: '100%', maxWidth: 720, height: '88vh', background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)', borderRadius: 16,
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                }}
            >
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px',
                    borderBottom: '1px solid var(--border-subtle)', flexShrink: 0,
                }}>
                    <Sparkle size={20} weight="fill" style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.01em' }}>Chuẩn bị phỏng vấn</div>
                        <div style={{
                            fontSize: '0.78rem', color: 'var(--text-muted)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                            {record.jobTitle}{record.company ? ` · ${record.company}` : ''}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Đóng"
                        className="btn-secondary"
                        style={{ padding: 8, display: 'flex', flexShrink: 0 }}
                    >
                        <X size={16} weight="bold" />
                    </button>
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 24px' }}>
                    {state.phase === 'loading' && (
                        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                            <Sparkle size={28} weight="duotone" style={{ color: 'var(--accent-purple)', marginBottom: 12 }} className="animate-pulse-glow" />
                            <p style={{ fontSize: '0.9rem' }}>Đang soạn bộ câu hỏi và luận điểm dựa trên JD và CV của bạn…</p>
                        </div>
                    )}

                    {state.phase === 'no-cv' && (
                        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                            <p style={{ fontSize: '0.9rem' }}>
                                Cần có CV đã tối ưu cho việc này trước. Hãy mở lại việc và tối ưu CV, rồi quay lại đây.
                            </p>
                        </div>
                    )}

                    {state.phase === 'error' && (
                        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--accent-red)' }}>
                            <p style={{ fontSize: '0.9rem' }}>{state.error}</p>
                        </div>
                    )}

                    {state.phase === 'ready' && (
                        <DossierBody dossier={state.dossier} />
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}

function DossierBody({ dossier }: { dossier: Dossier }) {
    return (
        <div>
            {dossier.likely_questions.length > 0 && (
                <>
                    <SectionTitle icon={<Question size={16} weight="duotone" style={{ color: 'var(--accent-blue)' }} />}>
                        Câu hỏi khả năng cao
                    </SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {dossier.likely_questions.map((q) => {
                            const diff = DIFF_META[q.difficulty] ?? DIFF_META.medium;
                            return (
                                <div key={q.id} style={{
                                    padding: '12px 14px', borderRadius: 'var(--radius-sm)',
                                    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                        <p style={{ fontSize: '0.88rem', fontWeight: 600, lineHeight: 1.4, margin: 0, flex: 1 }}>{q.question}</p>
                                        <span style={{ fontSize: '0.68rem', color: diff.color, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>{diff.label}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                                        <span style={{
                                            fontSize: '0.68rem', padding: '2px 8px', borderRadius: 10,
                                            background: 'var(--bg-elevated)', color: 'var(--text-muted)',
                                        }}>{q.category}</span>
                                        {q.why && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{q.why}</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {dossier.flagged_claims.length > 0 && (
                <>
                    <SectionTitle icon={<ShieldWarning size={16} weight="duotone" style={{ color: 'var(--accent-amber)' }} />}>
                        Câu cần sẵn sàng bảo vệ
                    </SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {dossier.flagged_claims.map((c, i) => (
                            <div key={i} style={{
                                padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                                background: 'rgba(251, 191, 36, 0.06)', border: '1px solid rgba(251, 191, 36, 0.2)',
                            }}>
                                <p style={{ fontSize: '0.84rem', fontWeight: 600, margin: 0, lineHeight: 1.4 }}>{c.claim}</p>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>{c.note}</p>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {dossier.gaps.length > 0 && (
                <>
                    <SectionTitle icon={<Target size={16} weight="duotone" style={{ color: 'var(--accent-red)' }} />}>
                        Điểm còn thiếu — cách chuẩn bị
                    </SectionTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {dossier.gaps.map((g, i) => (
                            <div key={i} style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
                                <p style={{ fontSize: '0.84rem', fontWeight: 600, margin: 0 }}>{g.gap}</p>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '4px 0 0', lineHeight: 1.5 }}>{g.how_to_prepare}</p>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {dossier.talking_points.length > 0 && (
                <>
                    <SectionTitle icon={<Lightning size={16} weight="duotone" style={{ color: 'var(--accent-green)' }} />}>
                        Luận điểm nên chủ động nêu
                    </SectionTitle>
                    <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {dossier.talking_points.map((t, i) => (
                            <li key={i} style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{t}</li>
                        ))}
                    </ul>
                </>
            )}
        </div>
    );
}
