'use client';

// Interview-prep dossier viewer. Opened from the history board for a scored
// job: POSTs to /api/ai/interview-prep, which checks the cache, generates on a
// miss, and persists. Read-only for now — the full practice view + accordion
// components land in Phase 4.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkle, Quotes, ListChecks } from '@phosphor-icons/react';
import { useAppStore, JobRecord } from '@/store/useAppStore';
import { getAuthHeaders } from '@/lib/auth-headers';
import { useModalA11y } from '@/lib/useModalA11y';
import {
    type Dossier, type Question, type Section,
    SECTION_LABEL_VI, SECTION_ORDER,
} from '@/lib/skills/interview/types';

type State =
    | { phase: 'loading' }
    | { phase: 'no-cv' }
    | { phase: 'ready'; dossier: Dossier }
    | { phase: 'error'; error: string };

function EvidenceChips({ question }: { question: Question }) {
    if (question.evidence.length === 0) return null;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {question.evidence.map((e, i) => (
                <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 6,
                    padding: '6px 10px', borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                }}>
                    <Quotes size={12} weight="fill" style={{ color: 'var(--accent-cyan)', marginTop: 3, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{e.quote}</span>
                </div>
            ))}
        </div>
    );
}

function StarOutline({ question }: { question: Question }) {
    const o = question.star_outline;
    const rows: [string, string][] = [['S', o.s], ['T', o.t], ['A', o.a], ['R', o.r]];
    if (rows.every(([, v]) => !v)) return null;
    return (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                <ListChecks size={12} weight="duotone" /> Khung trả lời gợi ý (STAR)
            </div>
            {rows.filter(([, v]) => v).map(([k, v]) => (
                <p key={k} style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    <strong style={{ color: 'var(--accent-purple)' }}>{k}:</strong> {v}
                </p>
            ))}
        </div>
    );
}

function DossierBody({ dossier }: { dossier: Dossier }) {
    if (dossier.questions.length === 0) {
        return <p style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Chưa đủ dữ liệu để tạo câu hỏi cho việc này.
        </p>;
    }
    const bySection = new Map<Section, Question[]>();
    for (const q of dossier.questions) {
        const list = bySection.get(q.section) ?? [];
        list.push(q);
        bySection.set(q.section, list);
    }
    return (
        <div>
            {SECTION_ORDER.filter(s => bySection.has(s)).map(section => (
                <section key={section} style={{ marginTop: 20 }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 10px', letterSpacing: '-0.01em' }}>
                        {SECTION_LABEL_VI[section]}
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {bySection.get(section)!.map(q => (
                            <div key={q.id} style={{
                                padding: '12px 14px', borderRadius: 'var(--radius-sm)',
                                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                            }}>
                                <p style={{ fontSize: '0.88rem', fontWeight: 600, margin: 0, lineHeight: 1.4 }}>{q.text_vi}</p>
                                {q.why_vi && (
                                    <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: '4px 0 0' }}>{q.why_vi}</p>
                                )}
                                <EvidenceChips question={q} />
                                <StarOutline question={q} />
                            </div>
                        ))}
                    </div>
                </section>
            ))}
        </div>
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
                const res = await fetch('/api/ai/interview-prep', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
                    body: JSON.stringify({
                        jobRef: record.id,
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
                if (!cancelled) setState({ phase: 'ready', dossier });
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
                    <button onClick={onClose} aria-label="Đóng" className="btn-secondary" style={{ padding: 8, display: 'flex', flexShrink: 0 }}>
                        <X size={16} weight="bold" />
                    </button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 24px' }}>
                    {state.phase === 'loading' && (
                        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                            <Sparkle size={28} weight="duotone" style={{ color: 'var(--accent-purple)', marginBottom: 12 }} className="animate-pulse-glow" />
                            <p style={{ fontSize: '0.9rem' }}>Đang soạn bộ câu hỏi và khung trả lời dựa trên JD và CV của bạn…</p>
                        </div>
                    )}
                    {state.phase === 'no-cv' && (
                        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                            <p style={{ fontSize: '0.9rem' }}>Cần có CV đã tối ưu cho việc này trước. Hãy mở lại việc và tối ưu CV, rồi quay lại đây.</p>
                        </div>
                    )}
                    {state.phase === 'error' && (
                        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--accent-red)' }}>
                            <p style={{ fontSize: '0.9rem' }}>{state.error}</p>
                        </div>
                    )}
                    {state.phase === 'ready' && <DossierBody dossier={state.dossier} />}
                </div>
            </div>
        </div>,
        document.body,
    );
}
