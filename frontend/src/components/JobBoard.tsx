'use client';

import { useState } from 'react';
import { useAppStore, JobRecord } from '@/store/useAppStore';
import {
    Table, ArrowSquareOut, Trash, CaretDown, CaretUp,
    Trophy, Crosshair, TrendUp, Warning, Clock, Globe, Sparkle,
} from '@phosphor-icons/react';

function ScoreBadge({ score }: { score: number }) {
    let color = 'var(--accent-red)';
    let bg = 'rgba(248, 113, 113, 0.12)';
    if (score >= 80) { color = 'var(--accent-green)'; bg = 'rgba(52, 211, 153, 0.12)'; }
    else if (score >= 60) { color = 'var(--accent-blue)'; bg = 'rgba(99, 102, 241, 0.12)'; }
    else if (score >= 40) { color = 'var(--accent-amber)'; bg = 'rgba(251, 191, 36, 0.12)'; }

    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 20,
            background: bg, color, fontWeight: 700, fontSize: '0.85rem',
        }}>
            <Trophy size={13} weight="fill" />
            {score}%
        </span>
    );
}

function formatDate(ts: number) {
    const d = new Date(ts);
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function ExpandedRow({ record }: { record: JobRecord }) {
    const match = record.matchResult;
    if (!match) return null;

    const categories = [
        { label: 'Must-Have Skills', data: match.must_have_match, icon: Crosshair },
        { label: 'Experience', data: match.experience_match, icon: TrendUp },
        { label: 'Domain Fit', data: match.domain_match, icon: Globe },
        { label: 'Seniority', data: match.seniority_match, icon: Trophy },
    ];

    return (
        <div style={{
            padding: '16px 20px',
            background: 'rgba(99, 102, 241, 0.03)',
            borderBottom: '1px solid var(--border-subtle)',
        }}>
            {/* Score breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
                {categories.map(({ label, data, icon: Icon }) => (
                    <div key={label} style={{
                        padding: '10px 14px', borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <Icon size={13} weight="duotone" style={{ color: 'var(--accent-cyan)' }} />
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{label}</span>
                            <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: '0.85rem' }}>{data.score}%</span>
                        </div>
                        <div style={{
                            width: '100%', height: 4, borderRadius: 2,
                            background: 'var(--border-subtle)', overflow: 'hidden',
                        }}>
                            <div style={{
                                width: `${data.score}%`, height: '100%', borderRadius: 2,
                                background: data.score >= 70 ? 'var(--accent-green)' : data.score >= 40 ? 'var(--accent-amber)' : 'var(--accent-red)',
                                transition: 'width 0.5s ease',
                            }} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Strengths */}
            {match.strength_summary && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <Sparkle size={13} weight="fill" style={{ color: 'var(--accent-green)', marginTop: 3, flexShrink: 0 }} />
                    {match.strength_summary}
                </p>
            )}

            {/* Risk flags */}
            {match.risk_flags && match.risk_flags.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {match.risk_flags.map((flag, i) => (
                        <span key={i} style={{
                            fontSize: '0.72rem', padding: '3px 8px', borderRadius: 12,
                            background: 'rgba(248, 113, 113, 0.08)', color: 'var(--accent-red)',
                            display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                            <Warning size={10} weight="fill" /> {flag}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function JobBoard() {
    const { jobHistory, clearJobHistory } = useAppStore();
    const [expandedId, setExpandedId] = useState<string | null>(null);

    if (jobHistory.length === 0) return null;

    return (
        <div style={{
            marginTop: 32, borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-card)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-card)',
        }}>
            {/* Header */}
            <div style={{
                padding: '16px 20px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderBottom: '1px solid var(--border-subtle)',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.06), rgba(167, 139, 250, 0.04))',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: 'var(--gradient-hero)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Table size={16} weight="bold" color="white" />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700 }}>Job Search History</h3>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {jobHistory.length} job{jobHistory.length !== 1 ? 's' : ''} analyzed
                        </span>
                    </div>
                </div>
                <button
                    onClick={clearJobHistory}
                    aria-label="Clear all job history"
                    style={{
                        padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)',
                        background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                        fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4,
                        transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-red)'; e.currentTarget.style.borderColor = 'var(--accent-red)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
                >
                    <Trash size={12} weight="bold" /> Clear All
                </button>
            </div>

            {/* Table Header */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 140px 80px 90px 40px',
                padding: '10px 20px',
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontWeight: 600,
                borderBottom: '1px solid var(--border-subtle)',
                background: 'rgba(0,0,0,0.15)',
            }}>
                <span>Job</span>
                <span>Site</span>
                <span>Score</span>
                <span>Date</span>
                <span></span>
            </div>

            {/* Rows */}
            {jobHistory.map((record) => (
                <div key={record.id}>
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 140px 80px 90px 40px',
                            padding: '14px 20px',
                            alignItems: 'center',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--border-subtle)',
                            transition: 'background 0.15s',
                        }}
                        onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                        {/* Job Title + Company */}
                        <div>
                            <div style={{ fontWeight: 600, fontSize: '0.88rem', lineHeight: 1.3 }}>
                                {record.jobTitle || 'Untitled Job'}
                            </div>
                            {record.company && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                    {record.company}
                                </div>
                            )}
                        </div>

                        {/* Site */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Globe size={12} weight="duotone" style={{ color: 'var(--text-muted)' }} />
                            <a
                                href={record.jobUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                    fontSize: '0.78rem', color: 'var(--accent-cyan)',
                                    textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 3,
                                }}
                            >
                                {record.siteName} <ArrowSquareOut size={10} />
                            </a>
                        </div>

                        {/* Score */}
                        <ScoreBadge score={record.overallScore} />

                        {/* Date */}
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={11} weight="regular" />
                            {formatDate(record.timestamp)}
                        </span>

                        {/* Expand */}
                        {expandedId === record.id
                            ? <CaretUp size={16} weight="bold" style={{ color: 'var(--text-muted)' }} />
                            : <CaretDown size={16} weight="bold" style={{ color: 'var(--text-muted)' }} />
                        }
                    </div>

                    {/* Expanded details */}
                    {expandedId === record.id && <ExpandedRow record={record} />}
                </div>
            ))}
        </div>
    );
}
