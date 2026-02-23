'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Sparkles, AlertTriangle, TrendingUp, Target } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { scoreFit } from '@/lib/api';
import ScoreRing from '@/components/ScoreRing';

interface BarProps {
    label: string;
    score: number;
    weight: string;
    color: string;
}

function CategoryBar({ label, score, weight, color }: BarProps) {
    return (
        <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{label}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{score}/100 · {weight}</span>
            </div>
            <div className="category-bar">
                <div className="category-bar-fill" style={{ width: `${score}%`, background: color }} />
            </div>
        </div>
    );
}

export default function StepMatchScore() {
    const { cvData, jdData, matchResult, setMatchResult, setStep, setLoading, isLoading } = useAppStore();
    const [error, setError] = useState('');

    useEffect(() => {
        if (!matchResult && cvData && jdData && !isLoading) {
            (async () => {
                setLoading(true, 'Scoring your job fit with AI...');
                try {
                    const result = await scoreFit(cvData, jdData);
                    setMatchResult(result);
                    setLoading(false);
                } catch (e: unknown) {
                    setError(e instanceof Error ? e.message : 'Scoring failed');
                    setLoading(false);
                }
            })();
        }
    }, [cvData, jdData, matchResult, setMatchResult, setLoading, isLoading]);

    if (!matchResult) {
        return (
            <div className="animate-fade-in" style={{ maxWidth: 700, margin: '0 auto', padding: '60px 20px', textAlign: 'center' }}>
                {error ? (
                    <p style={{ color: 'var(--accent-red)' }}>{error}</p>
                ) : (
                    <>
                        <div className="shimmer-loading" style={{ width: 160, height: 160, borderRadius: '50%', margin: '0 auto 24px' }} />
                        <p style={{ color: 'var(--text-secondary)' }}>Analyzing your fit...</p>
                    </>
                )}
            </div>
        );
    }

    const m = matchResult;

    return (
        <div className="animate-fade-in" style={{ maxWidth: 800, margin: '0 auto', padding: '40px 20px' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 32, textAlign: 'center' }}>
                Match Analysis
            </h2>

            {/* Score Hero */}
            <div className="glass-card" style={{ padding: '40px 32px', textAlign: 'center', marginBottom: 28 }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
                    <ScoreRing score={m.overall_score} size={180} label="Overall Fit" />
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', maxWidth: 500, margin: '0 auto' }}>
                    {m.strength_summary}
                </p>
            </div>

            {/* Category Breakdown */}
            <div className="glass-card" style={{ padding: '28px 32px', marginBottom: 28 }}>
                <h3 style={{ fontWeight: 600, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Target size={18} style={{ color: 'var(--accent-blue)' }} /> Score Breakdown
                </h3>
                <CategoryBar label="Must-Have Skills" score={m.must_have_match.score} weight="40%" color="var(--accent-blue)" />
                <CategoryBar label="Experience Depth" score={m.experience_match.score} weight="25%" color="var(--accent-purple)" />
                <CategoryBar label="Domain Alignment" score={m.domain_match.score} weight="15%" color="var(--accent-cyan)" />
                <CategoryBar label="Seniority Fit" score={m.seniority_match.score} weight="10%" color="var(--accent-green)" />
                <CategoryBar label="Nice-to-Have" score={m.nice_to_have_match.score} weight="10%" color="var(--accent-amber)" />
            </div>

            {/* Gaps & Risk */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 28 }}>
                {/* Gaps */}
                <div className="glass-card" style={{ padding: '24px' }}>
                    <h3 style={{ fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.95rem' }}>
                        <TrendingUp size={16} style={{ color: 'var(--accent-amber)' }} /> Key Gaps
                    </h3>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {[
                            ...m.must_have_match.gaps,
                            ...m.experience_match.gaps,
                            ...m.domain_match.gaps,
                        ].slice(0, 6).map((gap, i) => (
                            <li key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 8, paddingLeft: 12, borderLeft: '2px solid var(--accent-amber)' }}>
                                {gap}
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Risk Flags */}
                <div className="glass-card" style={{ padding: '24px' }}>
                    <h3 style={{ fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.95rem' }}>
                        <AlertTriangle size={16} style={{ color: 'var(--accent-red)' }} /> Risk Flags
                    </h3>
                    {m.risk_flags.length > 0 ? (
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {m.risk_flags.map((flag, i) => (
                                <li key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 8, paddingLeft: 12, borderLeft: '2px solid var(--accent-red)' }}>
                                    {flag}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p style={{ fontSize: '0.85rem', color: 'var(--accent-green)' }}>No major risk flags detected.</p>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn-secondary" onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ArrowLeft size={16} /> Back
                </button>
                <button className="btn-primary" onClick={() => setStep(4)} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Sparkles size={16} /> Optimize My CV
                </button>
            </div>
        </div>
    );
}
