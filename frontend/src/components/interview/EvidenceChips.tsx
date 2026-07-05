'use client';

// Verbatim CV evidence for a question, rendered as quote chips (same visual
// language as GapReportSection). Quotes are already asserted verbatim server-
// side by repair-dossier, so we render them as-is.
import { Quotes } from '@phosphor-icons/react';
import type { Evidence } from '@/lib/skills/interview/types';

export default function EvidenceChips({ evidence }: { evidence: Evidence[] }) {
    if (evidence.length === 0) return null;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {evidence.map((e, i) => (
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
