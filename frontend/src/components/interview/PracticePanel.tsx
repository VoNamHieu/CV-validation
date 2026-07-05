'use client';

// One question's practice loop: type an answer, optionally a one-line self-
// reflection (skippable), submit → /api/ai/practice-eval → checklist + coaching
// + (from attempt 2) the STAR outline reveal + attempt-over-attempt compare.
import { useState } from 'react';
import { PaperPlaneRight, Lightbulb, PencilSimple, Sparkle } from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { getAuthHeaders } from '@/lib/auth-headers';
import { useCredits } from '@/lib/credits-context';
import type { CVData } from '@/lib/types';
import type { Checklist, Question } from '@/lib/skills/interview/types';
import type { Coaching } from '@/lib/skills/interview/evaluate/coaching';
import ChecklistResult from '@/components/interview/ChecklistResult';
import CompareAttempts from '@/components/interview/CompareAttempts';
import OutOfCreditsNotice from '@/components/interview/OutOfCreditsNotice';

// Mirrors COSTS["practice"] in backend/app/routers/credits.py.
const PRACTICE_COST = 2;

export interface AttemptRecord {
    question_id: string;
    attempt_no: number;
    checklist: Checklist;
}

interface EvalResult {
    checklist: Checklist;
    coaching: Coaching;
    outline_reveal_allowed: boolean;
    previous?: Checklist;
}

export default function PracticePanel({
    question, prepId, cv, priorAttempts, onSaved,
}: {
    question: Question; prepId: string | null; cv: CVData;
    priorAttempts: AttemptRecord[]; onSaved: (a: AttemptRecord) => void;
}) {
    const draft = useAppStore((s) => s.practiceDrafts[question.id] ?? '');
    const setPracticeDraft = useAppStore((s) => s.setPracticeDraft);
    const setView = useAppStore((s) => s.setView);
    const setStep = useAppStore((s) => s.setStep);
    const { refresh: refreshCredits } = useCredits();

    const [reflection, setReflection] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [creditMsg, setCreditMsg] = useState<string | null>(null);
    const [result, setResult] = useState<EvalResult | null>(null);

    const attemptNo = priorAttempts.length + 1;

    async function submit() {
        if (!draft.trim() || busy) return;
        setBusy(true); setError(''); setCreditMsg(null);
        const previous = priorAttempts.at(-1)?.checklist;
        try {
            const res = await fetch('/api/ai/practice-eval', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
                body: JSON.stringify({
                    prep_id: prepId, question_id: question.id, attempt_no: attemptNo,
                    answer: draft, self_reflection: reflection || undefined, question, cv,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 402) {
                setCreditMsg(data.detail || `Bạn đã hết credit. Mỗi lần đánh giá tốn ${PRACTICE_COST} credit.`);
                return;
            }
            if (res.status === 401) {
                setCreditMsg('Vui lòng đăng nhập để dùng tính năng đánh giá.');
                return;
            }
            if (!res.ok) {
                throw new Error(data.detail || 'Không đánh giá được câu trả lời.');
            }
            setResult({ ...data, previous });
            onSaved({ question_id: question.id, attempt_no: attemptNo, checklist: data.checklist });
            refreshCredits(); // reflect the debit in the balance widget
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Đã xảy ra lỗi.');
        } finally {
            setBusy(false);
        }
    }

    const o = question.star_outline;
    const starRows: [string, string][] = [['S', o.s], ['T', o.t], ['A', o.a], ['R', o.r]];

    return (
        <div style={{ marginTop: 12 }}>
            <label htmlFor={`ans-${question.id}`} style={{ display: 'block', fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>
                Câu trả lời của bạn {attemptNo > 1 && `(lần ${attemptNo})`}
            </label>
            <textarea
                id={`ans-${question.id}`}
                value={draft}
                onChange={(e) => setPracticeDraft(question.id, e.target.value)}
                placeholder="Trả lời bằng lời của bạn, nêu bối cảnh, việc bạn làm và kết quả cụ thể…"
                rows={4}
                className="input-field"
                style={{ fontSize: '0.84rem', minHeight: 90 }}
            />
            <input
                value={reflection}
                onChange={(e) => setReflection(e.target.value)}
                placeholder="Tự nhận xét 1 câu (không bắt buộc): bạn thấy câu trả lời còn yếu ở đâu?"
                className="input-field"
                style={{ fontSize: '0.8rem', marginTop: 8, padding: '8px 12px' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <button
                    onClick={submit}
                    disabled={!draft.trim() || busy}
                    className="btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', fontSize: '0.82rem', opacity: (!draft.trim() || busy) ? 0.6 : 1 }}
                >
                    <PaperPlaneRight size={13} weight="bold" /> {busy ? 'Đang đánh giá…' : 'Đánh giá câu trả lời'}
                </button>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Tốn {PRACTICE_COST} credit</span>
                {error && <span style={{ fontSize: '0.78rem', color: 'var(--accent-red)' }}>{error}</span>}
            </div>

            {creditMsg && <OutOfCreditsNotice message={creditMsg} />}

            {result && (
                <>
                    <ChecklistResult checklist={result.checklist} />
                    {result.previous && <CompareAttempts previous={result.previous} current={result.checklist} />}

                    {result.coaching.praise_vi && (
                        <p style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--accent-green)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <Sparkle size={13} weight="fill" style={{ marginTop: 2, flexShrink: 0 }} /> {result.coaching.praise_vi}
                        </p>
                    )}
                    {result.coaching.hint_vi && (
                        <p style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <Lightbulb size={13} weight="duotone" style={{ color: 'var(--accent-amber)', marginTop: 2, flexShrink: 0 }} /> {result.coaching.hint_vi}
                        </p>
                    )}
                    {result.coaching.recommend_bullet_edit && (
                        <button
                            onClick={() => { setView('apply'); setStep(3); }}
                            className="btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '7px 14px', fontSize: '0.8rem', color: 'var(--accent-purple)' }}
                        >
                            <PencilSimple size={13} weight="bold" /> Gạch đầu dòng này khó diễn đạt lại, sửa trong CV
                        </button>
                    )}

                    {result.outline_reveal_allowed && starRows.some(([, v]) => v) && (
                        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                            <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>Khung trả lời gợi ý (STAR)</div>
                            {starRows.filter(([, v]) => v).map(([k, v]) => (
                                <p key={k} style={{ margin: '2px 0', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                                    <strong style={{ color: 'var(--accent-purple)' }}>{k}:</strong> {v}
                                </p>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
