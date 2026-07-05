'use client';

// "Đã luyện" — per-topic progress bars from readiness.ts (pure arithmetic:
// best ✓-count over attempts / items). Shown only once at least one topic has
// ≥2 attempts, so a single try doesn't masquerade as a readiness signal.
import { computeReadiness, type AttemptLike } from '@/lib/skills/interview/evaluate/readiness';
import type { Dossier } from '@/lib/skills/interview/types';

export default function ReadinessBars({ dossier, attempts }: { dossier: Dossier; attempts: AttemptLike[] }) {
    const topics = computeReadiness(dossier, attempts);
    if (!topics.some(t => t.show)) return null;
    const shown = topics.filter(t => t.attempts > 0);

    return (
        <section style={{ marginBottom: 20, padding: '14px 16px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, margin: '0 0 10px' }}>Đã luyện</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {shown.map(t => (
                    <div key={t.topic}>
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginBottom: 3 }}>{t.label_vi}</div>
                        <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'var(--border-subtle)', overflow: 'hidden' }}>
                            <div style={{
                                width: `${Math.round(t.ratio * 100)}%`, height: '100%', borderRadius: 3,
                                background: t.ratio >= 0.7 ? 'var(--accent-green)' : t.ratio >= 0.4 ? 'var(--accent-amber)' : 'var(--accent-red)',
                            }} />
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
