'use client';

// One collapsible question. Header is a real <button aria-expanded> (keyboard +
// screen-reader friendly); 'probe' questions open by default since they're the
// highest-priority gaps. Body = why + verbatim evidence + the practice loop.
import { useState } from 'react';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import type { CVData } from '@/lib/types';
import type { Question } from '@/lib/skills/interview/types';
import EvidenceChips from '@/components/interview/EvidenceChips';
import PracticePanel, { type AttemptRecord } from '@/components/interview/PracticePanel';

export default function QuestionAccordion({
    question, defaultOpen, prepId, cv, priorAttempts, onSaved,
}: {
    question: Question; defaultOpen: boolean; prepId: string | null; cv: CVData;
    priorAttempts: AttemptRecord[]; onSaved: (a: AttemptRecord) => void;
}) {
    const [open, setOpen] = useState(defaultOpen);
    const bodyId = `q-body-${question.id}`;

    return (
        <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)', overflow: 'hidden' }}>
            <button
                type="button"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => setOpen(o => !o)}
                style={{
                    width: '100%', display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '12px 14px', background: 'transparent', border: 'none',
                    cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)',
                }}
            >
                <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 600, lineHeight: 1.4 }}>{question.text_vi}</span>
                {priorAttempts.length > 0 && (
                    <span style={{ fontSize: '0.68rem', color: 'var(--accent-green)', background: 'rgba(52,211,153,0.12)', padding: '2px 7px', borderRadius: 10, flexShrink: 0, marginTop: 2 }}>
                        đã luyện {priorAttempts.length}×
                    </span>
                )}
                {open
                    ? <CaretUp size={15} weight="bold" style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 3 }} />
                    : <CaretDown size={15} weight="bold" style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 3 }} />}
            </button>

            {open && (
                <div id={bodyId} style={{ padding: '0 14px 14px' }}>
                    {question.why_vi && (
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: '0 0 4px' }}>{question.why_vi}</p>
                    )}
                    <EvidenceChips evidence={question.evidence} />
                    <PracticePanel question={question} prepId={prepId} cv={cv} priorAttempts={priorAttempts} onSaved={onSaved} />
                </div>
            )}
        </div>
    );
}
