'use client';

// The evaluation result: each dimension as ✓ / △ / ✗ with a short explanation
// and, on a miss, the verbatim CV correction. Deliberately NO number/score.
import type { Checklist } from '@/lib/skills/interview/types';
import { AXIS_META, checklistAxes } from '@/components/interview/checklist-axes';

export default function ChecklistResult({ checklist }: { checklist: Checklist }) {
    const axes = checklistAxes(checklist);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {axes.map(axis => {
                const meta = AXIS_META[axis.status];
                return (
                    <div key={axis.key} style={{
                        padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span aria-hidden style={{ color: meta.color, fontWeight: 700, fontSize: '0.95rem', width: 16, textAlign: 'center' }}>{meta.symbol}</span>
                            <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>{axis.label_vi}</span>
                        </div>
                        {axis.detail_vi && (
                            <p style={{ margin: '4px 0 0 24px', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>{axis.detail_vi}</p>
                        )}
                        {axis.cv_quote && (
                            <p style={{ margin: '4px 0 0 24px', fontSize: '0.76rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                CV bạn ghi: “{axis.cv_quote}”
                            </p>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
