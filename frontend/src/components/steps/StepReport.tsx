'use client';

import { useState } from 'react';
import {
    ArrowLeft, Sparkle, ArrowSquareOut, Warning,
    CheckCircle, XCircle, CaretDown, CaretUp, DownloadSimple,
    ArrowCounterClockwise, SpinnerGap, Lightning,
    ShieldWarning, ChartBar, Eye, PencilSimple,
} from '@phosphor-icons/react';
import { useAppStore, JDEntry } from '@/store/useAppStore';
import type { CVData, JDData, MatchResult, CategoryScore } from '@/lib/types';
import ScoreRing from '@/components/ScoreRing';
import EditableCvPreview from '@/components/EditableCvPreview';
import CvTemplatePicker from '@/components/CvTemplatePicker';
import { optimizeCv } from '@/lib/api';
import { renderCvHtml, DEFAULT_TEMPLATE_ID } from '@/lib/cv-templates';
import type { CvTemplateId } from '@/lib/cv-templates';

/* ─── Score color helper ─── */
function getColor(score: number) {
    if (score >= 80) return 'var(--accent-green)';
    if (score >= 60) return 'var(--accent-cyan)';
    if (score >= 40) return 'var(--accent-amber)';
    return 'var(--accent-red)';
}

function getVerdict(score: number) {
    if (score >= 85) return 'Excellent';
    if (score >= 70) return 'Strong';
    if (score >= 55) return 'Moderate';
    if (score >= 40) return 'Weak';
    return 'Poor';
}

/* ─── HTML generation now lives in /lib/cv-templates — see renderCvHtml(cv, templateId) ─── */

/* ─── Category detail row ─── */
function CategoryRow({ label, data }: { label: string; data: CategoryScore }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button
                onClick={() => setOpen(!open)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '6px 0', background: 'none', border: 'none',
                    cursor: 'pointer', color: 'var(--text-primary)', fontSize: '0.8rem',
                }}
            >
                <span style={{
                    width: 28, height: 28, borderRadius: 6,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: '0.75rem',
                    background: `${getColor(data.score)}18`, color: getColor(data.score),
                }}>{data.score}</span>
                <span style={{ flex: 1, textAlign: 'left', fontWeight: 500 }}>{label}</span>
                {open ? <CaretUp size={12} /> : <CaretDown size={12} />}
            </button>
            {open && (
                <div style={{ padding: '6px 0 10px 36px', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <p>{data.reasoning}</p>
                    {(data.gaps?.length || 0) > 0 && (
                        <div style={{ marginTop: 6 }}>
                            {data.gaps.map((g, i) => (
                                <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'flex-start', marginBottom: 2 }}>
                                    <XCircle size={11} style={{ color: 'var(--accent-red)', marginTop: 2, flexShrink: 0 }} />
                                    <span>{g}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </>
    );
}

/* ─── CvPanel — side-by-side comparison ─── */
function CvPanel({ data, title, accent }: { data: CVData; title: string; accent: string }) {
    return (
        <div className="glass-card" style={{ padding: '24px', flex: 1, minWidth: 0 }}>
            <h4 style={{ fontWeight: 600, marginBottom: 16, color: accent, fontSize: '0.95rem' }}>{title}</h4>
            <div style={{ marginBottom: 20 }}>
                <p style={{ fontWeight: 500, fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Summary</p>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{data.summary || 'N/A'}</p>
            </div>
            <div style={{ marginBottom: 20 }}>
                <p style={{ fontWeight: 500, fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Skills</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(data.skills || []).map((s, i) => (
                        <span key={i} style={{
                            background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                            borderRadius: 6, padding: '3px 10px', fontSize: '0.78rem', color: 'var(--text-secondary)',
                        }}>{s}</span>
                    ))}
                </div>
            </div>
            <div>
                <p style={{ fontWeight: 500, fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Experience</p>
                {(data.experience || []).map((exp, i) => (
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

/* ─── Expanded detail panel for a single job ─── */
function JobDetailPanel({
    entry, cvData, onOptimize, optimizing, onTemplateChange, avatarBase64,
}: {
    entry: JDEntry;
    cvData: CVData;
    onOptimize: () => void;
    optimizing: boolean;
    onTemplateChange: (id: CvTemplateId) => void;
    avatarBase64: string | null;
}) {
    const jd = entry.jdData;
    const m = entry.matchResult;
    if (!jd || !m) return null;

    const cvSkillsLower = (cvData.skills || []).map(s => s.toLowerCase());
    const alignedSkills = (jd.must_have || []).filter(sk =>
        cvSkillsLower.some(cs => cs.includes(sk.toLowerCase()) || sk.toLowerCase().includes(cs))
    );
    const missingSkills = (jd.must_have || []).filter(sk =>
        !cvSkillsLower.some(cs => cs.includes(sk.toLowerCase()) || sk.toLowerCase().includes(cs))
    );

    return (
        <div style={{
            padding: '24px', background: 'var(--bg-card)',
            borderTop: '1px solid var(--border-subtle)',
            animation: 'fadeIn 0.2s ease',
        }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 20 }}>
                {/* Skills */}
                <div>
                    <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
                        Must-Have ({alignedSkills.length}/{(jd.must_have || []).length} matched)
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {alignedSkills.map((s, i) => (
                            <span key={`a-${i}`} style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                padding: '3px 8px', borderRadius: 6, fontSize: '0.75rem',
                                background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--accent-green)',
                            }}><CheckCircle size={10} /> {s}</span>
                        ))}
                        {missingSkills.map((s, i) => (
                            <span key={`m-${i}`} style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                padding: '3px 8px', borderRadius: 6, fontSize: '0.75rem',
                                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--accent-red)',
                            }}><XCircle size={10} /> {s}</span>
                        ))}
                    </div>
                </div>

                {/* Scoring Breakdown */}
                <div>
                    <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
                        Scoring Breakdown
                    </p>
                    <CategoryRow label="Must-Have Skills (40%)" data={m.must_have_match} />
                    <CategoryRow label="Experience (25%)" data={m.experience_match} />
                    <CategoryRow label="Domain (15%)" data={m.domain_match} />
                    <CategoryRow label="Seniority (10%)" data={m.seniority_match} />
                    <CategoryRow label="Nice-to-Have (10%)" data={m.nice_to_have_match} />
                </div>
            </div>

            {/* Risk Flags */}
            {(m.risk_flags || []).length > 0 && (
                <div style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-red)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ShieldWarning size={13} /> Risk Flags
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {m.risk_flags.map((flag, i) => (
                            <span key={i} style={{
                                padding: '4px 10px', borderRadius: 6, fontSize: '0.75rem',
                                background: 'rgba(239,68,68,0.06)', color: 'var(--text-secondary)',
                                display: 'flex', alignItems: 'center', gap: 4,
                            }}><Warning size={11} style={{ color: 'var(--accent-amber)' }} /> {flag}</span>
                        ))}
                    </div>
                </div>
            )}

            {/* Strength summary */}
            <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
                {m.strength_summary}
            </p>

            {/* Optimize & Comparison */}
            {!entry.optimizedCv ? (
                <button
                    className="btn-primary"
                    onClick={onOptimize}
                    disabled={optimizing}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem', padding: '10px 24px' }}
                >
                    {optimizing ? (
                        <><SpinnerGap size={16} className="spin" /> Optimizing...</>
                    ) : (
                        <><Sparkle size={16} /> Optimize CV for this job</>
                    )}
                </button>
            ) : (
                <div>
                    <div style={{
                        background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
                        borderRadius: 'var(--radius-md)', padding: '8px 14px', marginBottom: 16,
                        fontSize: '0.78rem', color: 'var(--accent-amber)',
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <Warning size={12} /> AI-assisted optimization · Edit below then Save & Download
                    </div>
                    <div style={{ marginBottom: 8 }}>
                        <div style={{
                            fontSize: '0.78rem', fontWeight: 600,
                            color: 'var(--text-secondary)', marginBottom: 6,
                        }}>
                            Mẫu CV
                        </div>
                        <CvTemplatePicker
                            selected={entry.selectedTemplateId ?? DEFAULT_TEMPLATE_ID}
                            onSelect={onTemplateChange}
                        />
                    </div>
                    <EditableCvPreview
                        originalCv={cvData}
                        optimizedCv={entry.optimizedCv}
                        onSave={(editedCv) => {
                            const html = renderCvHtml(editedCv, entry.selectedTemplateId, {
                                avatarBase64: avatarBase64 ?? undefined,
                            });
                            const blob = new Blob([html], { type: 'text/html' });
                            const urlObj = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = urlObj;
                            a.download = `${editedCv.name.replace(/\s+/g, '_')}_optimized.html`;
                            a.click();
                            URL.revokeObjectURL(urlObj);
                        }}
                    />
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN REPORT — Sheet/Table View
   ═══════════════════════════════════════════════════════════════════════════════ */

export default function StepReport() {
    const {
        cvData, jdEntries, updateJdEntry, setStep, setSelectedJdId, resetAll,
        userAvatarBase64,
    } = useAppStore();

    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [optimizingIds, setOptimizingIds] = useState<Set<string>>(new Set());

    const doneEntries = jdEntries.filter(e => e.status === 'done');
    const errorEntries = jdEntries.filter(e => e.status === 'error');
    const pendingEntries = jdEntries.filter(e => !['done', 'error'].includes(e.status));

    if (!cvData || jdEntries.length === 0) {
        return (
            <div className="animate-fade-in" style={{ maxWidth: 600, margin: '0 auto', padding: '60px 20px', textAlign: 'center' }}>
                <p style={{ color: 'var(--text-secondary)' }}>No analysis data found. Go back and analyze a URL.</p>
                <button className="btn-secondary" onClick={() => setStep(2)} style={{ marginTop: 20 }}>
                    <ArrowLeft size={16} /> Back
                </button>
            </div>
        );
    }

    const optimizedCount = doneEntries.filter(e => e.optimizedCv).length;

    const handleOptimize = async (entry: JDEntry) => {
        if (!cvData || !entry.jdData || !entry.matchResult) return;
        setOptimizingIds(prev => new Set(prev).add(entry.id));
        try {
            const result = await optimizeCv(cvData, entry.jdData, entry.matchResult);

            // Render PDF eagerly so the extension can upload it during auto-apply
            // without paying the render cost per job. Render failure is non-fatal —
            // the batch flow will fall back to rendering on demand.
            let pdfCache: { optimizedCvPdfBase64?: string; optimizedCvFileName?: string } = {};
            try {
                const html = renderCvHtml(result, entry.selectedTemplateId, {
                    avatarBase64: userAvatarBase64 ?? undefined,
                });
                const safeTitle = (entry.jobTitle || 'job').replace(/\s+/g, '_').slice(0, 40);
                const filename = `${result.name.replace(/\s+/g, '_')}_${safeTitle}.pdf`;
                const res = await fetch('/api/render-cv-pdf', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ html, filename }),
                });
                if (res.ok) {
                    const { base64, filename: outName } = await res.json() as { base64: string; filename: string };
                    pdfCache = { optimizedCvPdfBase64: base64, optimizedCvFileName: outName };
                }
            } catch (pdfErr) {
                console.warn('[Optimize] PDF cache render failed (non-fatal):', pdfErr);
            }

            updateJdEntry(entry.id, { optimizedCv: result, ...pdfCache });
        } catch (e) {
            console.error('Optimization failed:', e);
        }
        setOptimizingIds(prev => {
            const next = new Set(prev);
            next.delete(entry.id);
            return next;
        });
    };

    // Sort by score descending
    const sortedDone = [...doneEntries].sort((a, b) =>
        (b.matchResult?.overall_score ?? 0) - (a.matchResult?.overall_score ?? 0)
    );

    return (
        <div className="animate-fade-in" style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 20px' }}>

            {/* ── Header ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
                <div>
                    <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <ChartBar size={22} weight="duotone" style={{ color: 'var(--accent-blue)' }} />
                        Job Match Results
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                        {doneEntries.length} jobs analyzed
                        {errorEntries.length > 0 && ` · ${errorEntries.length} failed`}
                        {pendingEntries.length > 0 && ` · ${pendingEntries.length} processing`}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    {optimizedCount > 0 && (
                        <button
                            className="btn-primary"
                            onClick={() => setStep(4)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 7,
                                fontSize: '0.85rem', padding: '10px 22px',
                            }}
                        >
                            <PencilSimple size={15} weight="fill" />
                            View All CVs ({optimizedCount})
                        </button>
                    )}
                    <button className="btn-secondary" onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                        <ArrowLeft size={14} /> Try Another
                    </button>
                    <button className="btn-secondary" onClick={() => { resetAll(); setStep(1); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                        <ArrowCounterClockwise size={14} /> Start Over
                    </button>
                </div>
            </div>

            {/* ── Summary Stats ── */}
            {doneEntries.length > 0 && (
                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28,
                }}>
                    {[
                        { label: 'Best Match', value: `${Math.max(...doneEntries.map(e => e.matchResult?.overall_score ?? 0))}%`, color: 'var(--accent-green)' },
                        { label: 'Average', value: `${Math.round(doneEntries.reduce((s, e) => s + (e.matchResult?.overall_score ?? 0), 0) / doneEntries.length)}%`, color: 'var(--accent-cyan)' },
                        { label: 'Jobs Found', value: `${doneEntries.length}`, color: 'var(--accent-blue)' },
                        { label: 'Optimized', value: `${doneEntries.filter(e => e.optimizedCv).length}`, color: 'var(--accent-purple)' },
                    ].map((stat, i) => (
                        <div key={i} className="glass-card" style={{
                            padding: '16px 20px', textAlign: 'center',
                            background: `linear-gradient(135deg, ${stat.color}08, transparent)`,
                        }}>
                            <p style={{ fontSize: '1.5rem', fontWeight: 800, color: stat.color }}>{stat.value}</p>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{stat.label}</p>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Table ── */}
            <div className="glass-card" style={{ overflow: 'hidden' }}>
                {/* Table Header */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '52px 2fr 1fr 1fr 100px 120px 80px',
                    padding: '12px 20px',
                    background: 'var(--bg-secondary)',
                    borderBottom: '1px solid var(--border-subtle)',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                }}>
                    <span>#</span>
                    <span>Job / Source</span>
                    <span>Domain</span>
                    <span>Top Gaps</span>
                    <span style={{ textAlign: 'center' }}>Score</span>
                    <span style={{ textAlign: 'center' }}>Optimize</span>
                    <span style={{ textAlign: 'center' }}>Detail</span>
                </div>

                {/* Table Rows — Done */}
                {sortedDone.map((entry, idx) => {
                    const m = entry.matchResult!;
                    const jd = entry.jdData!;
                    const score = m.overall_score;
                    const isExpanded = expandedId === entry.id;

                    // Top 2 gaps
                    const topGaps = [
                        ...(m.must_have_match.gaps || []),
                        ...(m.experience_match.gaps || []),
                        ...(m.domain_match.gaps || []),
                    ].slice(0, 2);

                    return (
                        <div key={entry.id}>
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '52px 2fr 1fr 1fr 100px 120px 80px',
                                    padding: '14px 20px',
                                    alignItems: 'center',
                                    borderBottom: '1px solid var(--border-subtle)',
                                    background: isExpanded ? 'rgba(59,130,246,0.04)' : 'transparent',
                                    transition: 'background 0.15s',
                                }}
                            >
                                {/* Rank */}
                                <span style={{
                                    width: 28, height: 28, borderRadius: '50%',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.78rem', fontWeight: 700,
                                    background: idx === 0 ? 'rgba(245,158,11,0.15)' : 'var(--bg-secondary)',
                                    color: idx === 0 ? 'var(--accent-amber)' : 'var(--text-muted)',
                                }}>{idx + 1}</span>

                                {/* Job Title + URL */}
                                <div style={{ minWidth: 0 }}>
                                    <p style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {entry.jobTitle || 'Unknown Position'}
                                    </p>
                                    <a href={entry.source} target="_blank" rel="noopener noreferrer"
                                        style={{ fontSize: '0.72rem', color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                        <ArrowSquareOut size={10} />
                                        {entry.company ? `${entry.company} · ` : ''}{entry.label}
                                    </a>
                                </div>

                                {/* Domain + Seniority */}
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                    {jd.domain && (
                                        <span style={{
                                            fontSize: '0.7rem', padding: '2px 8px', borderRadius: 12,
                                            background: 'rgba(59,130,246,0.1)', color: 'var(--accent-blue)',
                                        }}>{jd.domain}</span>
                                    )}
                                    {jd.seniority_expected && (
                                        <span style={{
                                            fontSize: '0.7rem', padding: '2px 8px', borderRadius: 12,
                                            background: 'rgba(139,92,246,0.1)', color: 'var(--accent-purple)',
                                        }}>{jd.seniority_expected}</span>
                                    )}
                                </div>

                                {/* Top Gaps */}
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden' }}>
                                    {topGaps.length > 0 ? topGaps.map((g, i) => (
                                        <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {g}
                                        </div>
                                    )) : <span style={{ color: 'var(--accent-green)' }}>No major gaps</span>}
                                </div>

                                {/* Score */}
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    <ScoreRing score={score} size={48} label="" />
                                </div>

                                {/* Optimize button */}
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    {entry.optimizedCv ? (
                                        <span
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 4,
                                                padding: '6px 14px', borderRadius: 'var(--radius-sm)',
                                                fontSize: '0.75rem', fontWeight: 500,
                                                background: 'rgba(16,185,129,0.1)',
                                                border: '1px solid rgba(16,185,129,0.3)',
                                                color: 'var(--accent-green)',
                                            }}
                                        >
                                            <CheckCircle size={12} weight="fill" /> Optimized
                                        </span>
                                    ) : (
                                        <button
                                            className="btn-primary"
                                            onClick={(e) => { e.stopPropagation(); handleOptimize(entry); }}
                                            disabled={optimizingIds.has(entry.id)}
                                            style={{
                                                padding: '6px 14px', fontSize: '0.75rem',
                                                display: 'flex', alignItems: 'center', gap: 4,
                                            }}
                                        >
                                            {optimizingIds.has(entry.id) ? (
                                                <><SpinnerGap size={12} className="spin" /> ...</>
                                            ) : (
                                                <><Lightning size={12} weight="fill" /> Optimize</>
                                            )}
                                        </button>
                                    )}
                                </div>

                                {/* View detail */}
                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                    <button
                                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                                        style={{
                                            width: 32, height: 32, borderRadius: 8,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            background: isExpanded ? 'var(--accent-blue)' : 'var(--bg-secondary)',
                                            border: 'none', cursor: 'pointer',
                                            color: isExpanded ? 'white' : 'var(--text-muted)',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        <Eye size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* Expanded Detail */}
                            {isExpanded && (
                                <JobDetailPanel
                                    entry={entry}
                                    cvData={cvData}
                                    onOptimize={() => handleOptimize(entry)}
                                    optimizing={optimizingIds.has(entry.id)}
                                    avatarBase64={userAvatarBase64}
                                    onTemplateChange={(id) =>
                                        updateJdEntry(entry.id, {
                                            selectedTemplateId: id,
                                            optimizedCvPdfBase64: undefined,
                                            optimizedCvFileName: undefined,
                                        })
                                    }
                                />
                            )}
                        </div>
                    );
                })}

                {/* Error rows */}
                {errorEntries.map((entry) => (
                    <div key={entry.id} style={{
                        display: 'grid',
                        gridTemplateColumns: '52px 2fr 1fr 1fr 100px 120px 80px',
                        padding: '14px 20px', alignItems: 'center',
                        borderBottom: '1px solid var(--border-subtle)',
                        opacity: 0.5,
                    }}>
                        <span style={{ color: 'var(--accent-red)' }}>✗</span>
                        <div>
                            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {entry.source.slice(0, 60)}
                            </p>
                            <p style={{ fontSize: '0.72rem', color: 'var(--accent-red)' }}>{entry.error}</p>
                        </div>
                        <span>—</span>
                        <span>—</span>
                        <span style={{ textAlign: 'center', color: 'var(--text-muted)' }}>—</span>
                        <span style={{ textAlign: 'center', color: 'var(--text-muted)' }}>—</span>
                        <span style={{ textAlign: 'center', color: 'var(--text-muted)' }}>—</span>
                    </div>
                ))}

                {/* Pending rows */}
                {pendingEntries.map((entry) => (
                    <div key={entry.id} style={{
                        display: 'grid',
                        gridTemplateColumns: '52px 2fr 1fr 1fr 100px 120px 80px',
                        padding: '14px 20px', alignItems: 'center',
                        borderBottom: '1px solid var(--border-subtle)',
                    }}>
                        <SpinnerGap size={16} className="spin" style={{ color: 'var(--accent-blue)' }} />
                        <div>
                            <p style={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {entry.source.slice(0, 60)}
                            </p>
                            <p style={{ fontSize: '0.72rem', color: 'var(--accent-blue)' }}>{entry.status}...</p>
                        </div>
                        <span>—</span>
                        <span>—</span>
                        <span style={{ textAlign: 'center' }}>
                            <div className="shimmer-loading" style={{ width: 40, height: 40, borderRadius: '50%', margin: '0 auto' }} />
                        </span>
                        <span style={{ textAlign: 'center', color: 'var(--text-muted)' }}>—</span>
                        <span style={{ textAlign: 'center', color: 'var(--text-muted)' }}>—</span>
                    </div>
                ))}
            </div>

            <style>{`
                @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
                .spin { animation: spin 1s linear infinite; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
}
