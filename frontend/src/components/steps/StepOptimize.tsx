'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import { useAppStore, CVData } from '@/store/useAppStore';
import { optimizeCv } from '@/lib/api';

function CvPanel({ data, title, accent }: { data: CVData; title: string; accent: string }) {
    return (
        <div className="glass-card" style={{ padding: '24px', flex: 1, minWidth: 0 }}>
            <h4 style={{ fontWeight: 600, marginBottom: 16, color: accent, fontSize: '0.95rem' }}>{title}</h4>

            {/* Summary */}
            <div style={{ marginBottom: 20 }}>
                <p style={{ fontWeight: 500, fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Summary</p>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{data.summary || 'N/A'}</p>
            </div>

            {/* Skills */}
            <div style={{ marginBottom: 20 }}>
                <p style={{ fontWeight: 500, fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Skills</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {data.skills.map((s, i) => (
                        <span key={i} style={{
                            background: 'var(--bg-secondary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 6,
                            padding: '3px 10px',
                            fontSize: '0.78rem',
                            color: 'var(--text-secondary)',
                        }}>{s}</span>
                    ))}
                </div>
            </div>

            {/* Experience */}
            <div>
                <p style={{ fontWeight: 500, fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Experience</p>
                {data.experience.map((exp, i) => (
                    <div key={i} style={{ marginBottom: 14, paddingLeft: 12, borderLeft: `2px solid ${accent}` }}>
                        <p style={{ fontWeight: 600, fontSize: '0.88rem' }}>{exp.title} @ {exp.company}</p>
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 4 }}>{exp.duration_months} months</p>
                        <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{exp.description}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function StepOptimize() {
    const { cvData, jdData, matchResult, optimizedCv, setOptimizedCv, setStep, setLoading, isLoading } = useAppStore();
    const [error, setError] = useState('');

    useEffect(() => {
        if (!optimizedCv && cvData && jdData && matchResult && !isLoading) {
            (async () => {
                setLoading(true, 'Optimizing your CV with AI...');
                try {
                    const result = await optimizeCv(cvData, jdData, matchResult);
                    setOptimizedCv(result);
                    setLoading(false);
                } catch (e: unknown) {
                    setError(e instanceof Error ? e.message : 'Optimization failed');
                    setLoading(false);
                }
            })();
        }
    }, [cvData, jdData, matchResult, optimizedCv, setOptimizedCv, setLoading, isLoading]);

    return (
        <div className="animate-fade-in" style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 20px' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
                <Sparkles size={22} style={{ display: 'inline', marginRight: 8, color: 'var(--accent-purple)' }} />
                Side-by-Side Comparison
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32, textAlign: 'center', fontSize: '0.9rem' }}>
                Compare your original CV with the AI-optimized version. No fabricated information was added.
            </p>

            {/* Disclaimer */}
            <div style={{
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                marginBottom: 28,
                fontSize: '0.82rem',
                color: 'var(--accent-amber)',
                textAlign: 'center',
            }}>
                ⚠️ AI-assisted optimization · Only information from the original CV was used
            </div>

            {error && (
                <p style={{ color: 'var(--accent-red)', textAlign: 'center', marginBottom: 20 }}>{error}</p>
            )}

            {!optimizedCv ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                    <div className="shimmer-loading" style={{ height: 400, borderRadius: 'var(--radius-lg)' }} />
                    <div className="shimmer-loading" style={{ height: 400, borderRadius: 'var(--radius-lg)' }} />
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                    {cvData && <CvPanel data={cvData} title="Original CV" accent="var(--text-muted)" />}
                    <CvPanel data={optimizedCv} title="Optimized CV" accent="var(--accent-green)" />
                </div>
            )}

            <div style={{ marginTop: 36, display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn-secondary" onClick={() => setStep(3)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ArrowLeft size={16} /> Back to Scores
                </button>
                <button className="btn-primary" disabled={!optimizedCv} onClick={() => setStep(5)} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    Export PDF <ArrowRight size={16} />
                </button>
            </div>
        </div>
    );
}
