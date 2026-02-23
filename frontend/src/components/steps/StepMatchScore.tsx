'use client';

import { useState } from 'react';
import { ArrowLeft, Sparkles, ExternalLink, Trophy, AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useAppStore, JDEntry, MatchResult, CategoryScore } from '@/store/useAppStore';
import ScoreRing from '@/components/ScoreRing';

function CategorySection({ title, data, accentColor }: { title: string; data: CategoryScore; accentColor: string }) {
    const [open, setOpen] = useState(false);
    return (
        <div style={{ marginBottom: 2 }}>
            <button
                onClick={() => setOpen(!open)}
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                    padding: '12px 16px', background: 'var(--bg-secondary)', border: 'none',
                    borderRadius: open ? '10px 10px 0 0' : 10, cursor: 'pointer', color: 'var(--text-primary)',
                    transition: 'background 0.2s',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                        width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: '0.85rem',
                        background: `${accentColor}18`, color: accentColor,
                    }}>
                        {data.score}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{title}</span>
                </div>
                {open ? <ChevronUp size={16} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />}
            </button>
            {open && (
                <div style={{
                    padding: '14px 16px', background: 'var(--bg-secondary)', borderRadius: '0 0 10px 10px',
                    borderTop: '1px solid var(--border-subtle)',
                }}>
                    <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
                        {data.reasoning}
                    </p>
                    {data.gaps.length > 0 && (
                        <div>
                            <p style={{ fontSize: '0.75rem', color: 'var(--accent-red)', fontWeight: 600, marginBottom: 6 }}>Gaps:</p>
                            {data.gaps.map((gap, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
                                    <XCircle size={13} style={{ color: 'var(--accent-red)', marginTop: 2, flexShrink: 0 }} />
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{gap}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function AlignmentPanel({ entry, cvSkills }: { entry: JDEntry; cvSkills: string[] }) {
    const m = entry.matchResult!;
    const jd = entry.jdData!;

    // Determine skill alignment
    const cvSkillsLower = cvSkills.map(s => s.toLowerCase());
    const alignedSkills = jd.must_have.filter(skill =>
        cvSkillsLower.some(cs => cs.includes(skill.toLowerCase()) || skill.toLowerCase().includes(cs))
    );
    const missingSkills = jd.must_have.filter(skill =>
        !cvSkillsLower.some(cs => cs.includes(skill.toLowerCase()) || skill.toLowerCase().includes(cs))
    );
    const niceAligned = jd.nice_to_have.filter(skill =>
        cvSkillsLower.some(cs => cs.includes(skill.toLowerCase()) || skill.toLowerCase().includes(cs))
    );
    const niceMissing = jd.nice_to_have.filter(skill =>
        !cvSkillsLower.some(cs => cs.includes(skill.toLowerCase()) || skill.toLowerCase().includes(cs))
    );

    const getColor = (score: number) => {
        if (score >= 80) return 'var(--accent-green)';
        if (score >= 60) return 'var(--accent-cyan)';
        if (score >= 40) return 'var(--accent-amber)';
        return 'var(--accent-red)';
    };

    return (
        <div className="glass-card animate-fade-in" style={{ padding: '28px 28px', marginTop: 24 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 24 }}>
                <ScoreRing score={m.overall_score} size={90} label="Fit" />
                <div style={{ flex: 1 }}>
                    <h3 style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 4 }}>
                        {entry.label}
                        {entry.source.startsWith('http') && (
                            <a href={entry.source} target="_blank" rel="noopener noreferrer"
                                style={{ color: 'var(--accent-blue)', marginLeft: 8 }}>
                                <ExternalLink size={13} style={{ display: 'inline' }} />
                            </a>
                        )}
                    </h3>
                    {jd.domain && (
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                            {jd.domain} · {jd.seniority_expected}
                        </p>
                    )}
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                        {m.strength_summary}
                    </p>
                </div>
            </div>

            {/* Skills Alignment */}
            <div style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Must-Have Skills Alignment
                </h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {alignedSkills.map((s, i) => (
                        <span key={`a-${i}`} style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            padding: '4px 10px', borderRadius: 6, fontSize: '0.78rem',
                            background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', color: 'var(--accent-green)',
                        }}>
                            <CheckCircle2 size={11} /> {s}
                        </span>
                    ))}
                    {missingSkills.map((s, i) => (
                        <span key={`m-${i}`} style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                            padding: '4px 10px', borderRadius: 6, fontSize: '0.78rem',
                            background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--accent-red)',
                        }}>
                            <XCircle size={11} /> {s}
                        </span>
                    ))}
                </div>
                {jd.must_have.length > 0 && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {alignedSkills.length}/{jd.must_have.length} must-have skills matched
                    </p>
                )}
            </div>

            {/* Nice-to-have */}
            {jd.nice_to_have.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                    <h4 style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Nice-to-Have Skills
                    </h4>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {niceAligned.map((s, i) => (
                            <span key={`na-${i}`} style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                padding: '4px 10px', borderRadius: 6, fontSize: '0.78rem',
                                background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.25)', color: 'var(--accent-cyan)',
                            }}>
                                <CheckCircle2 size={11} /> {s}
                            </span>
                        ))}
                        {niceMissing.map((s, i) => (
                            <span key={`nm-${i}`} style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                padding: '4px 10px', borderRadius: 6, fontSize: '0.78rem',
                                background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)',
                            }}>
                                {s}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Category Breakdown (expandable) */}
            <div style={{ marginBottom: 20 }}>
                <h4 style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Detailed Breakdown
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <CategorySection title="Must-Have Skills (40%)" data={m.must_have_match} accentColor={getColor(m.must_have_match.score)} />
                    <CategorySection title="Experience Depth (25%)" data={m.experience_match} accentColor={getColor(m.experience_match.score)} />
                    <CategorySection title="Domain Alignment (15%)" data={m.domain_match} accentColor={getColor(m.domain_match.score)} />
                    <CategorySection title="Seniority Fit (10%)" data={m.seniority_match} accentColor={getColor(m.seniority_match.score)} />
                    <CategorySection title="Nice-to-Have (10%)" data={m.nice_to_have_match} accentColor={getColor(m.nice_to_have_match.score)} />
                </div>
            </div>

            {/* Risk Flags */}
            {m.risk_flags.length > 0 && (
                <div>
                    <h4 style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent-red)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        ⚠️ Risk Flags
                    </h4>
                    {m.risk_flags.map((flag, i) => (
                        <div key={i} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 6,
                            padding: '8px 12px', marginBottom: 4,
                            background: 'rgba(239, 68, 68, 0.06)', borderRadius: 8,
                            fontSize: '0.82rem', color: 'var(--text-secondary)',
                        }}>
                            <AlertTriangle size={13} style={{ color: 'var(--accent-amber)', marginTop: 2, flexShrink: 0 }} />
                            {flag}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function StepMatchScore() {
    const {
        jdEntries, setSelectedJdId, selectedJdId, setStep,
        setMatchResult, setJdData, setOptimizedCv, cvData,
    } = useAppStore();

    const rankedEntries = [...jdEntries]
        .filter(e => e.status === 'done' && e.matchResult)
        .sort((a, b) => (b.matchResult?.overall_score ?? 0) - (a.matchResult?.overall_score ?? 0));

    const errorEntries = jdEntries.filter(e => e.status === 'error');

    const selectedEntry = selectedJdId
        ? jdEntries.find(e => e.id === selectedJdId)
        : rankedEntries[0];

    const handleSelectForOptimize = (entryId: string) => {
        const entry = jdEntries.find(e => e.id === entryId);
        if (entry?.matchResult && entry?.jdData) {
            setSelectedJdId(entryId);
            setMatchResult(entry.matchResult);
            setJdData(entry.jdData);
            setOptimizedCv(null);
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
                <p style={{ color: 'var(--text-secondary)' }}>No scored JDs yet. Go back and add URLs or paste a JD.</p>
                <button className="btn-secondary" onClick={() => setStep(2)} style={{ marginTop: 20 }}>
                    <ArrowLeft size={16} /> Back
                </button>
            </div>
        );
    }

    return (
        <div className="animate-fade-in" style={{ maxWidth: 1050, margin: '0 auto', padding: '40px 20px' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
                <Trophy size={22} style={{ display: 'inline', marginRight: 8, color: 'var(--accent-amber)' }} />
                Job Fit Ranking
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32, textAlign: 'center', fontSize: '0.9rem' }}>
                {rankedEntries.length} JD{rankedEntries.length > 1 ? 's' : ''} ranked · Click a row to see detailed alignment
            </p>

            {/* Ranking Table */}
            <div className="glass-card" style={{ overflow: 'hidden', marginBottom: 8 }}>
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
                                <td style={{ padding: '14px 16px', fontSize: '1.1rem' }}>{getMedal(i)}</td>
                                <td style={{ padding: '14px 16px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ fontSize: '0.88rem', fontWeight: 500 }}>{entry.label}</span>
                                        {entry.source.startsWith('http') && (
                                            <a href={entry.source} target="_blank" rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()} style={{ color: 'var(--text-muted)' }}>
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
                                    <span style={{ fontSize: '1.1rem', fontWeight: 700, color: getScoreColor(entry.matchResult?.overall_score ?? 0) }}>
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
                <div style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: '0.8rem', color: 'var(--accent-red)', marginBottom: 6 }}>
                        <AlertTriangle size={14} style={{ display: 'inline', marginRight: 4 }} />
                        {errorEntries.length} URL{errorEntries.length > 1 ? 's' : ''} failed
                    </p>
                    {errorEntries.map(e => (
                        <p key={e.id} style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: 16 }}>
                            {e.label}: {e.error}
                        </p>
                    ))}
                </div>
            )}

            {/* Detailed Alignment Panel */}
            {selectedEntry?.matchResult && selectedEntry.jdData && cvData && (
                <AlignmentPanel entry={selectedEntry} cvSkills={cvData.skills} />
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
