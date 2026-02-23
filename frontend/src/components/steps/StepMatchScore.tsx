'use client';

import { ArrowLeft, Sparkles, ExternalLink, Trophy, AlertTriangle, TrendingUp } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import ScoreRing from '@/components/ScoreRing';

export default function StepMatchScore() {
    const {
        jdEntries, setSelectedJdId, selectedJdId, setStep,
        matchResult, setMatchResult, setJdData, setOptimizedCv,
        cvData,
    } = useAppStore();

    const rankedEntries = [...jdEntries]
        .filter(e => e.status === 'done' && e.matchResult)
        .sort((a, b) => (b.matchResult?.overall_score ?? 0) - (a.matchResult?.overall_score ?? 0));

    const errorEntries = jdEntries.filter(e => e.status === 'error');

    const selectedEntry = selectedJdId
        ? jdEntries.find(e => e.id === selectedJdId)
        : rankedEntries[0];

    const m = selectedEntry?.matchResult;

    const handleSelectForOptimize = (entryId: string) => {
        const entry = jdEntries.find(e => e.id === entryId);
        if (entry?.matchResult && entry?.jdData) {
            setSelectedJdId(entryId);
            setMatchResult(entry.matchResult);
            setJdData(entry.jdData);
            setOptimizedCv(null); // reset so it re-optimizes
            setStep(4);
        }
    };

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'var(--accent-green)';
        if (score >= 60) return 'var(--accent-cyan)';
        if (score >= 40) return 'var(--accent-amber)';
        return 'var(--accent-red)';
    };

    const getMedal = (rank: number) => {
        if (rank === 0) return '🥇';
        if (rank === 1) return '🥈';
        if (rank === 2) return '🥉';
        return `#${rank + 1}`;
    };

    if (rankedEntries.length === 0) {
        return (
            <div className="animate-fade-in" style={{ maxWidth: 600, margin: '0 auto', padding: '60px 20px', textAlign: 'center' }}>
                <p style={{ color: 'var(--text-secondary)' }}>No scored JDs yet. Go back and add some URLs.</p>
                <button className="btn-secondary" onClick={() => setStep(2)} style={{ marginTop: 20 }}>
                    <ArrowLeft size={16} /> Back
                </button>
            </div>
        );
    }

    return (
        <div className="animate-fade-in" style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 20px' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
                <Trophy size={22} style={{ display: 'inline', marginRight: 8, color: 'var(--accent-amber)' }} />
                Job Fit Ranking
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32, textAlign: 'center', fontSize: '0.9rem' }}>
                {rankedEntries.length} JD{rankedEntries.length > 1 ? 's' : ''} ranked by compatibility with your CV
            </p>

            {/* Ranking Table */}
            <div className="glass-card" style={{ overflow: 'hidden', marginBottom: 28 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                            <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Rank</th>
                            <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Source</th>
                            <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Score</th>
                            <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Skills</th>
                            <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Exp.</th>
                            <th style={{ padding: '12px 16px', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Domain</th>
                            <th style={{ padding: '12px 16px', textAlign: 'right', fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rankedEntries.map((entry, i) => (
                            <tr
                                key={entry.id}
                                onClick={() => setSelectedJdId(entry.id)}
                                style={{
                                    borderBottom: '1px solid var(--border-subtle)',
                                    cursor: 'pointer',
                                    background: selectedEntry?.id === entry.id ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                                    transition: 'background 0.2s',
                                }}
                            >
                                <td style={{ padding: '14px 16px', fontSize: '1.1rem' }}>
                                    {getMedal(i)}
                                </td>
                                <td style={{ padding: '14px 16px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ fontSize: '0.88rem', fontWeight: 500 }}>{entry.label}</span>
                                        {entry.source.startsWith('http') && (
                                            <a href={entry.source} target="_blank" rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                style={{ color: 'var(--text-muted)' }}>
                                                <ExternalLink size={12} />
                                            </a>
                                        )}
                                    </div>
                                    {entry.jdData && (
                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                            {entry.jdData.domain} · {entry.jdData.seniority_expected}
                                        </span>
                                    )}
                                </td>
                                <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                                    <span style={{
                                        fontSize: '1.1rem', fontWeight: 700,
                                        color: getScoreColor(entry.matchResult?.overall_score ?? 0),
                                    }}>
                                        {entry.matchResult?.overall_score}
                                    </span>
                                </td>
                                <td style={{ padding: '14px 16px', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    {entry.matchResult?.must_have_match.score}
                                </td>
                                <td style={{ padding: '14px 16px', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    {entry.matchResult?.experience_match.score}
                                </td>
                                <td style={{ padding: '14px 16px', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    {entry.matchResult?.domain_match.score}
                                </td>
                                <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                                    <button
                                        className="btn-primary"
                                        onClick={(e) => { e.stopPropagation(); handleSelectForOptimize(entry.id); }}
                                        style={{ padding: '6px 14px', fontSize: '0.78rem' }}
                                    >
                                        <Sparkles size={12} /> Optimize
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Error entries */}
            {errorEntries.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                    <p style={{ fontSize: '0.8rem', color: 'var(--accent-red)', marginBottom: 8 }}>
                        <AlertTriangle size={14} style={{ display: 'inline', marginRight: 4 }} />
                        {errorEntries.length} URL{errorEntries.length > 1 ? 's' : ''} failed
                    </p>
                    {errorEntries.map(e => (
                        <p key={e.id} style={{ fontSize: '0.78rem', color: 'var(--text-muted)', paddingLeft: 16 }}>
                            {e.label}: {e.error}
                        </p>
                    ))}
                </div>
            )}

            {/* Selected JD Detail */}
            {m && selectedEntry && (
                <div className="glass-card" style={{ padding: '28px 32px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 20 }}>
                        <ScoreRing score={m.overall_score} size={100} label="Fit Score" />
                        <div style={{ flex: 1 }}>
                            <h3 style={{ fontWeight: 600, fontSize: '1rem', marginBottom: 6 }}>
                                {selectedEntry.label}
                                {selectedEntry.source.startsWith('http') && (
                                    <a href={selectedEntry.source} target="_blank" rel="noopener noreferrer"
                                        style={{ color: 'var(--accent-blue)', marginLeft: 8 }}>
                                        <ExternalLink size={13} style={{ display: 'inline' }} />
                                    </a>
                                )}
                            </h3>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                                {m.strength_summary}
                            </p>
                        </div>
                    </div>

                    {/* Gaps */}
                    {(() => {
                        const gaps = [
                            ...m.must_have_match.gaps,
                            ...m.experience_match.gaps,
                            ...m.domain_match.gaps,
                        ].slice(0, 5);
                        return gaps.length > 0 ? (
                            <div>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <TrendingUp size={13} /> Key Gaps
                                </p>
                                {gaps.map((gap, i) => (
                                    <p key={i} style={{
                                        fontSize: '0.82rem', color: 'var(--text-secondary)',
                                        paddingLeft: 12, borderLeft: '2px solid var(--accent-amber)',
                                        marginBottom: 6,
                                    }}>{gap}</p>
                                ))}
                            </div>
                        ) : null;
                    })()}
                </div>
            )}

            {/* Actions */}
            <div style={{ marginTop: 28, display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn-secondary" onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ArrowLeft size={16} /> Back
                </button>
                {selectedEntry && (
                    <button className="btn-primary" onClick={() => handleSelectForOptimize(selectedEntry.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Sparkles size={16} /> Optimize CV for #{rankedEntries.indexOf(selectedEntry) + 1} Ranked JD
                    </button>
                )}
            </div>
        </div>
    );
}
