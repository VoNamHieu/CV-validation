'use client';

// Attempt-over-attempt progress: which dimensions flipped ✗/△ → ✓ since the
// previous try. Shows only the deltas, so improvement is visible at a glance.
import { ArrowRight } from '@phosphor-icons/react';
import type { Checklist } from '@/lib/skills/interview/types';
import { AXIS_META, checklistAxes } from '@/components/interview/checklist-axes';

const RANK = { fail: 0, partial: 1, pass: 2 } as const;

export default function CompareAttempts({ previous, current }: { previous: Checklist; current: Checklist }) {
    const prev = checklistAxes(previous);
    const cur = checklistAxes(current);
    const changed = cur
        .map((a, i) => ({ axis: a, before: prev[i]?.status }))
        .filter(({ axis, before }) => before && before !== axis.status);

    if (changed.length === 0) return null;

    return (
        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'rgba(52, 211, 153, 0.06)', border: '1px solid rgba(52, 211, 153, 0.2)' }}>
            <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>So với lần trước</div>
            {changed.map(({ axis, before }) => {
                const improved = RANK[axis.status] > RANK[before!];
                return (
                    <div key={axis.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', marginTop: 2 }}>
                        <span style={{ minWidth: 150 }}>{axis.label_vi}</span>
                        <span aria-hidden style={{ color: AXIS_META[before!].color, fontWeight: 700 }}>{AXIS_META[before!].symbol}</span>
                        <ArrowRight size={11} weight="bold" style={{ color: 'var(--text-muted)' }} />
                        <span aria-hidden style={{ color: AXIS_META[axis.status].color, fontWeight: 700 }}>{AXIS_META[axis.status].symbol}</span>
                        <span style={{ fontSize: '0.72rem', color: improved ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
                            {improved ? 'đã cải thiện' : 'cần chú ý'}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}
