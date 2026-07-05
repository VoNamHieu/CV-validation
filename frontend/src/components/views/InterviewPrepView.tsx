'use client';

// Interview-prep view: for the job selected from history, load (or generate)
// the dossier, load past practice attempts, and render the readiness bars +
// per-section question accordions with the practice loop. Container only —
// the interactive pieces live in components/interview/.
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Sparkle, ChatCircleDots } from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { getAuthHeaders } from '@/lib/auth-headers';
import { account } from '@/lib/db';
import {
    type Dossier, type Question, type Section, type Checklist,
    SECTION_LABEL_VI, SECTION_ORDER,
} from '@/lib/skills/interview/types';
import type { AttemptLike } from '@/lib/skills/interview/evaluate/readiness';
import QuestionAccordion from '@/components/interview/QuestionAccordion';
import type { AttemptRecord } from '@/components/interview/PracticePanel';
import ReadinessBars from '@/components/interview/ReadinessBars';
import PrepList from '@/components/interview/PrepList';

type State =
    | { phase: 'loading' }
    | { phase: 'no-job' }
    | { phase: 'no-cv' }
    | { phase: 'error'; error: string }
    | { phase: 'ready'; dossier: Dossier; prepId: string | null };

function Centered({ children, tone }: { children: React.ReactNode; tone?: 'muted' | 'error' }) {
    return (
        <div style={{ padding: '80px 24px', textAlign: 'center', color: tone === 'error' ? 'var(--accent-red)' : 'var(--text-secondary)', fontSize: '0.92rem' }}>
            {children}
        </div>
    );
}

export default function InterviewPrepView() {
    const prepJobId = useAppStore((s) => s.prepJobId);
    const jobHistory = useAppStore((s) => s.jobHistory);
    const loadJobHistory = useAppStore((s) => s.loadJobHistory);
    const baseCv = useAppStore((s) => s.cvData);
    const openInterviewList = useAppStore((s) => s.openInterviewList);

    const record = useMemo(() => jobHistory.find((r) => r.id === prepJobId), [jobHistory, prepJobId]);

    const [state, setState] = useState<State>({ phase: 'loading' });
    const [attempts, setAttempts] = useState<AttemptRecord[]>([]);

    // Ensure history is hydrated so `record` can resolve on a fresh load.
    useEffect(() => { void loadJobHistory(); }, [loadJobHistory]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!prepJobId) { setState({ phase: 'no-job' }); return; }
            if (!record) { setState({ phase: 'loading' }); return; } // wait for history
            const tailored = record.optimizedCv;
            if (!tailored) { setState({ phase: 'no-cv' }); return; }
            setState({ phase: 'loading' });
            try {
                const res = await fetch('/api/ai/interview-prep', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
                    body: JSON.stringify({
                        jobRef: record.id, cv: baseCv ?? tailored,
                        jd: record.jdData, match: record.matchResult, tailoredCv: tailored,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.detail || 'Không tạo được bộ chuẩn bị phỏng vấn.');
                if (cancelled) return;
                setState({ phase: 'ready', dossier: data.dossier, prepId: data.prep_id ?? null });

                // Load past attempts (best-effort; needs auth + a persisted prep).
                if (data.prep_id) {
                    try {
                        const rows = await account.listPracticeAttempts(data.prep_id);
                        if (!cancelled) {
                            setAttempts(rows.map((r) => ({
                                question_id: r.question_id, attempt_no: r.attempt_no,
                                checklist: r.checklist as unknown as Checklist,
                            })));
                        }
                    } catch { /* no prior attempts / anonymous */ }
                }
            } catch (e) {
                if (!cancelled) setState({ phase: 'error', error: e instanceof Error ? e.message : 'Đã xảy ra lỗi.' });
            }
        })();
        return () => { cancelled = true; };
    }, [prepJobId, record, baseCv]);

    const grouped = useMemo(() => {
        if (state.phase !== 'ready') return [] as Array<{ section: Section; items: Question[] }>;
        const bySection = new Map<Section, Question[]>();
        for (const q of state.dossier.questions) {
            const list = bySection.get(q.section) ?? [];
            list.push(q);
            bySection.set(q.section, list);
        }
        return SECTION_ORDER.filter((s) => bySection.has(s)).map((section) => ({ section, items: bySection.get(section)! }));
    }, [state]);

    const attemptLikes: AttemptLike[] = attempts.map((a) => ({ question_id: a.question_id, checklist: a.checklist }));
    const onSaved = (a: AttemptRecord) => setAttempts((prev) => [...prev, a]);

    // No job selected → show the landing list of created preps.
    if (!prepJobId) return <PrepList />;

    return (
        <div className="animate-fade-in" style={{ maxWidth: 820, margin: '0 auto', padding: '40px 32px' }}>
            <button
                onClick={() => openInterviewList()}
                className="btn-secondary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', marginBottom: 18, padding: '6px 12px' }}
            >
                <ArrowLeft size={13} weight="bold" /> Tất cả buổi luyện
            </button>

            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.03em', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <ChatCircleDots size={22} weight="duotone" style={{ color: 'var(--accent-purple)' }} />
                Chuẩn bị phỏng vấn
            </h1>
            {record && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 24 }}>
                    {record.jobTitle}{record.company ? ` · ${record.company}` : ''}
                </p>
            )}

            {state.phase === 'loading' && (
                <Centered>
                    <Sparkle size={26} weight="duotone" style={{ color: 'var(--accent-purple)', marginBottom: 10 }} className="animate-pulse-glow" />
                    <p>Đang chuẩn bị bộ câu hỏi dựa trên JD và CV của bạn…</p>
                </Centered>
            )}
            {state.phase === 'no-job' && <Centered>Hãy chọn một việc từ tab Lịch sử rồi bấm “Chuẩn bị phỏng vấn”.</Centered>}
            {state.phase === 'no-cv' && <Centered>Việc này chưa có CV đã tối ưu. Hãy mở lại và tối ưu CV trước.</Centered>}
            {state.phase === 'error' && <Centered tone="error">{state.error}</Centered>}

            {state.phase === 'ready' && (
                <>
                    <ReadinessBars dossier={state.dossier} attempts={attemptLikes} />
                    {state.dossier.questions.length === 0 ? (
                        <Centered>Chưa đủ dữ liệu để tạo câu hỏi cho việc này.</Centered>
                    ) : (
                        grouped.map(({ section, items }) => (
                            <section key={section} style={{ marginBottom: 22 }}>
                                <h2 style={{ fontSize: '0.9rem', fontWeight: 700, margin: '0 0 10px' }}>{SECTION_LABEL_VI[section]}</h2>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {items.map((q) => (
                                        <QuestionAccordion
                                            key={q.id}
                                            question={q}
                                            defaultOpen={section === 'probe'}
                                            prepId={state.prepId}
                                            cv={(baseCv ?? record?.optimizedCv)!}
                                            priorAttempts={attempts.filter((a) => a.question_id === q.id).sort((x, y) => x.attempt_no - y.attempt_no)}
                                            onSaved={onSaved}
                                        />
                                    ))}
                                </div>
                            </section>
                        ))
                    )}
                </>
            )}
        </div>
    );
}
