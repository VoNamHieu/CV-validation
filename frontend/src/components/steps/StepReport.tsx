'use client';

import { useState } from 'react';
import {
    ArrowLeft, Sparkle, ArrowSquareOut, Trophy, Warning,
    CheckCircle, XCircle, CaretDown, CaretUp, DownloadSimple,
    ArrowCounterClockwise, SpinnerGap, Lightning, Crosshair,
    TrendUp, ThumbsUp, XSquare, ShieldWarning, ChartBar,
} from '@phosphor-icons/react';
import { useAppStore, MatchResult, CategoryScore, CVData, JDData } from '@/store/useAppStore';
import ScoreRing from '@/components/ScoreRing';
import { optimizeCv } from '@/lib/api';

/* ─── Category collapsible section ─── */
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Mini bar */}
                    <div style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--bg-card)', overflow: 'hidden' }}>
                        <div style={{
                            width: `${data.score}%`, height: '100%', borderRadius: 3,
                            background: accentColor, transition: 'width 0.8s ease',
                        }} />
                    </div>
                    {open ? <CaretUp size={16} style={{ color: 'var(--text-muted)' }} /> : <CaretDown size={16} style={{ color: 'var(--text-muted)' }} />}
                </div>
            </button>
            {open && (
                <div style={{
                    padding: '14px 16px', background: 'var(--bg-secondary)', borderRadius: '0 0 10px 10px',
                    borderTop: '1px solid var(--border-subtle)',
                }}>
                    <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
                        {data.reasoning}
                    </p>
                    {(data.gaps?.length || 0) > 0 && (
                        <div>
                            <p style={{ fontSize: '0.75rem', color: 'var(--accent-red)', fontWeight: 600, marginBottom: 6 }}>Gaps:</p>
                            {(data.gaps || []).map((gap, i) => (
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

/* ─── Score verdict label ─── */
function getVerdict(score: number) {
    if (score >= 85) return { text: 'Excellent Match', icon: Crosshair, color: 'var(--accent-green)' };
    if (score >= 70) return { text: 'Strong Match', icon: TrendUp, color: 'var(--accent-green)' };
    if (score >= 55) return { text: 'Moderate Match', icon: ThumbsUp, color: 'var(--accent-cyan)' };
    if (score >= 40) return { text: 'Weak Match', icon: Warning, color: 'var(--accent-amber)' };
    return { text: 'Poor Match', icon: XSquare, color: 'var(--accent-red)' };
}

function getColor(score: number) {
    if (score >= 80) return 'var(--accent-green)';
    if (score >= 60) return 'var(--accent-cyan)';
    if (score >= 40) return 'var(--accent-amber)';
    return 'var(--accent-red)';
}

/* ─── CV Panel for side-by-side ─── */
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
                    {(data.skills || []).map((s, i) => (
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

/* ─── XSS-safe HTML escaping (M3) ─── */
function esc(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* ─── HTML generation for download ─── */
function generateHtml(cv: CVData): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a2e; padding: 40px 48px; line-height: 1.55; font-size: 11pt; }
    h1 { font-size: 22pt; margin-bottom: 4px; color: #111; }
    h2 { font-size: 12pt; color: #2563eb; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1.5px solid #2563eb; padding-bottom: 4px; margin: 20px 0 10px; }
    .summary { color: #444; font-size: 10.5pt; margin-bottom: 10px; }
    .skills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .skill { background: #f0f4ff; border: 1px solid #d0d8f0; border-radius: 4px; padding: 2px 8px; font-size: 9pt; }
    .exp-item { margin-bottom: 14px; }
    .exp-title { font-weight: 700; font-size: 11pt; }
    .exp-meta { font-size: 9pt; color: #666; margin-bottom: 3px; }
    .exp-desc { font-size: 10pt; color: #333; white-space: pre-wrap; }
    .edu-item { margin-bottom: 8px; }
    .disclaimer { margin-top: 24px; font-size: 8pt; color: #999; text-align: center; border-top: 1px solid #eee; padding-top: 8px; }
  </style>
</head>
<body>
  <h1>${esc(cv.name)}</h1>
  <h2>Summary</h2>
  <p class="summary">${esc(cv.summary)}</p>
  <h2>Skills</h2>
  <div class="skills">${(cv.skills || []).map(s => `<span class="skill">${esc(s)}</span>`).join('')}</div>
  <h2>Experience</h2>
  ${(cv.experience || []).map(e => `
    <div class="exp-item">
      <div class="exp-title">${esc(e.title)} — ${esc(e.company)}</div>
      <div class="exp-meta">${e.duration_months} months</div>
      <div class="exp-desc">${esc(e.description)}</div>
    </div>
  `).join('')}
  <h2>Education</h2>
  ${(cv.education || []).map(e => `
    <div class="edu-item">
      <strong>${esc(e.degree)}</strong> — ${esc(e.institution)} (${esc(e.year)})
    </div>
  `).join('')}
  ${(cv.projects || []).length > 0 ? `
    <h2>Projects</h2>
    ${cv.projects.map(p => `
      <div class="exp-item">
        <div class="exp-title">${esc(p.name)}</div>
        <div class="exp-desc">${esc(p.description)}</div>
      </div>
    `).join('')}
  ` : ''}
  <div class="disclaimer">AI-assisted optimization · Generated by AI Job Fit Optimizer</div>
</body>
</html>`;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN REPORT BOARD
   ═══════════════════════════════════════════════════════════════════════════════ */

export default function StepReport() {
    const {
        cvData, jdData, matchResult, optimizedCv, setOptimizedCv,
        setStep, jdEntries, resetAll,
    } = useAppStore();

    const [optimizing, setOptimizing] = useState(false);
    const [optimizeError, setOptimizeError] = useState('');
    const [showComparison, setShowComparison] = useState(false);

    const entry = jdEntries[0]; // We only handle 1 JD
    const m = matchResult;
    const jd = jdData;

    if (!m || !jd || !cvData) {
        return (
            <div className="animate-fade-in" style={{ maxWidth: 600, margin: '0 auto', padding: '60px 20px', textAlign: 'center' }}>
                <p style={{ color: 'var(--text-secondary)' }}>No analysis data found. Go back and analyze a URL.</p>
                <button className="btn-secondary" onClick={() => setStep(2)} style={{ marginTop: 20 }}>
                    <ArrowLeft size={16} /> Back
                </button>
            </div>
        );
    }

    const verdict = getVerdict(m.overall_score);
    const cvSkillsLower = (cvData.skills || []).map(s => s.toLowerCase());
    const alignedSkills = (jd.must_have || []).filter(skill =>
        cvSkillsLower.some(cs => cs.includes(skill.toLowerCase()) || skill.toLowerCase().includes(cs))
    );
    const missingSkills = (jd.must_have || []).filter(skill =>
        !cvSkillsLower.some(cs => cs.includes(skill.toLowerCase()) || skill.toLowerCase().includes(cs))
    );
    const niceAligned = (jd.nice_to_have || []).filter(skill =>
        cvSkillsLower.some(cs => cs.includes(skill.toLowerCase()) || skill.toLowerCase().includes(cs))
    );
    const niceMissing = (jd.nice_to_have || []).filter(skill =>
        !cvSkillsLower.some(cs => cs.includes(skill.toLowerCase()) || skill.toLowerCase().includes(cs))
    );

    const handleOptimize = async () => {
        setOptimizing(true);
        setOptimizeError('');
        try {
            const result = await optimizeCv(cvData, jd, m);
            setOptimizedCv(result);
            setShowComparison(true);
        } catch (e: unknown) {
            setOptimizeError(e instanceof Error ? e.message : 'Optimization failed');
        }
        setOptimizing(false);
    };

    const handleDownload = () => {
        const data = optimizedCv || cvData;
        if (!data) return;
        const html = generateHtml(data);
        const blob = new Blob([html], { type: 'text/html' });
        const urlObj = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = urlObj;
        a.download = `${data.name.replace(/\s+/g, '_')}_optimized_cv.html`;
        a.click();
        URL.revokeObjectURL(urlObj);
    };

    return (
        <div className="animate-fade-in" style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 20px' }}>

            {/* ── HERO: Score Overview ── */}
            <div className="glass-card" style={{
                padding: '36px 40px',
                marginBottom: 28,
                background: 'linear-gradient(135deg, rgba(59,130,246,0.06), rgba(139,92,246,0.04), rgba(6,182,212,0.04))',
                textAlign: 'center',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 32, flexWrap: 'wrap' }}>
                    <ScoreRing score={m.overall_score} size={140} label="Overall Fit" />
                    <div style={{ textAlign: 'left', maxWidth: 500 }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4,
                        }}>
                            <verdict.icon size={24} style={{ color: verdict.color, flexShrink: 0 }} />
                            <span style={{
                                fontSize: '1.8rem', fontWeight: 800,
                                background: 'var(--gradient-hero)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                            }}>
                                {verdict.text}
                            </span>
                        </div>
                        {entry?.source.startsWith('http') && (
                            <a href={entry.source} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: '0.82rem', color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
                                <ArrowSquareOut size={12} /> {entry.label}
                            </a>
                        )}
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                            {m.strength_summary}
                        </p>
                        {/* domain + seniority tags */}
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                            {jd.domain && (
                                <span style={{
                                    fontSize: '0.75rem', padding: '4px 12px', borderRadius: 20,
                                    background: 'rgba(59,130,246,0.12)', color: 'var(--accent-blue)', fontWeight: 500,
                                }}>{jd.domain}</span>
                            )}
                            {jd.seniority_expected && (
                                <span style={{
                                    fontSize: '0.75rem', padding: '4px 12px', borderRadius: 20,
                                    background: 'rgba(139,92,246,0.12)', color: 'var(--accent-purple)', fontWeight: 500,
                                }}>{jd.seniority_expected}</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── GRID: 2 columns ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 28 }}>

                {/* LEFT: Skills Alignment */}
                <div className="glass-card" style={{ padding: '24px' }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Trophy size={16} style={{ color: 'var(--accent-amber)' }} />
                        Skills Alignment
                    </h3>

                    {/* Must-have */}
                    <div style={{ marginBottom: 16 }}>
                        <p style={{
                            fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8,
                            textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>
                            Must-Have ({alignedSkills.length}/{(jd.must_have || []).length} matched)
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {alignedSkills.map((s, i) => (
                                <span key={`a-${i}`} style={{
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    padding: '4px 10px', borderRadius: 6, fontSize: '0.78rem',
                                    background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--accent-green)',
                                }}>
                                    <CheckCircle size={11} /> {s}
                                </span>
                            ))}
                            {missingSkills.map((s, i) => (
                                <span key={`m-${i}`} style={{
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    padding: '4px 10px', borderRadius: 6, fontSize: '0.78rem',
                                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--accent-red)',
                                }}>
                                    <XCircle size={11} /> {s}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Nice-to-have */}
                    {(jd.nice_to_have || []).length > 0 && (
                        <div>
                            <p style={{
                                fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8,
                                textTransform: 'uppercase', letterSpacing: '0.05em',
                            }}>
                                Nice-to-Have
                            </p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {niceAligned.map((s, i) => (
                                    <span key={`na-${i}`} style={{
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        padding: '4px 10px', borderRadius: 6, fontSize: '0.78rem',
                                        background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.25)', color: 'var(--accent-cyan)',
                                    }}>
                                        <CheckCircle size={11} /> {s}
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
                </div>

                {/* RIGHT: JD Summary */}
                <div className="glass-card" style={{ padding: '24px' }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Sparkle size={16} style={{ color: 'var(--accent-blue)' }} />
                        JD Summary
                    </h3>
                    {(jd.responsibilities || []).length > 0 && (
                        <div style={{ marginBottom: 16 }}>
                            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Key Responsibilities
                            </p>
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {(jd.responsibilities || []).slice(0, 6).map((r, i) => (
                                    <li key={i} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{r}</li>
                                ))}
                                {(jd.responsibilities || []).length > 6 && (
                                    <li style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                        +{(jd.responsibilities || []).length - 6} more
                                    </li>
                                )}
                            </ul>
                        </div>
                    )}

                    {/* Risk Flags */}
                    {(m.risk_flags || []).length > 0 && (
                        <div>
                            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent-red)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <ShieldWarning size={14} /> Risk Flags
                            </p>
                            {(m.risk_flags || []).map((flag, i) => (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'flex-start', gap: 6,
                                    padding: '8px 12px', marginBottom: 4,
                                    background: 'rgba(239,68,68,0.06)', borderRadius: 8,
                                    fontSize: '0.82rem', color: 'var(--text-secondary)',
                                }}>
                                    <Warning size={13} style={{ color: 'var(--accent-amber)', marginTop: 2, flexShrink: 0 }} />
                                    {flag}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* ── DETAILED BREAKDOWN ── */}
            <div className="glass-card" style={{ padding: '24px', marginBottom: 28 }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ChartBar size={16} style={{ color: 'var(--accent-blue)' }} /> Detailed Scoring Breakdown
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <CategorySection title="Must-Have Skills (40%)" data={m.must_have_match} accentColor={getColor(m.must_have_match.score)} />
                    <CategorySection title="Experience Depth (25%)" data={m.experience_match} accentColor={getColor(m.experience_match.score)} />
                    <CategorySection title="Domain Alignment (15%)" data={m.domain_match} accentColor={getColor(m.domain_match.score)} />
                    <CategorySection title="Seniority Fit (10%)" data={m.seniority_match} accentColor={getColor(m.seniority_match.score)} />
                    <CategorySection title="Nice-to-Have (10%)" data={m.nice_to_have_match} accentColor={getColor(m.nice_to_have_match.score)} />
                </div>
            </div>

            {/* ── OPTIMIZE CV SECTION ── */}
            {!showComparison ? (
                <div className="glass-card" style={{
                    padding: '32px 40px',
                    marginBottom: 28,
                    textAlign: 'center',
                    background: 'linear-gradient(135deg, rgba(139,92,246,0.06), rgba(59,130,246,0.04))',
                }}>
                    <Lightning size={40} weight="duotone" style={{ color: 'var(--accent-purple)', marginBottom: 12 }} />
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 8 }}>
                        Optimize Your CV for This Job
                    </h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 20, maxWidth: 500, margin: '0 auto 20px' }}>
                        Let AI rewrite your CV to better align with this job description. Only uses information already in your CV — no fabrication.
                    </p>
                    {optimizeError && (
                        <p style={{ color: 'var(--accent-red)', fontSize: '0.85rem', marginBottom: 16 }}>{optimizeError}</p>
                    )}
                    <button
                        className="btn-primary animate-pulse-glow"
                        onClick={handleOptimize}
                        disabled={optimizing}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '1rem', padding: '14px 36px' }}
                    >
                        {optimizing ? (
                            <>
                                <SpinnerGap size={18} style={{ animation: 'spin 1s linear infinite' }} />
                                Optimizing with AI...
                            </>
                        ) : (
                            <>
                                <Sparkle size={18} /> Optimize CV
                            </>
                        )}
                    </button>
                    <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
                </div>
            ) : (
                /* ── SIDE-BY-SIDE COMPARISON ── */
                <div style={{ marginBottom: 28 }}>
                    <div style={{ textAlign: 'center', marginBottom: 20 }}>
                        <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 4 }}>
                            <Sparkle size={18} style={{ display: 'inline', marginRight: 8, color: 'var(--accent-green)' }} />
                            CV Optimization Complete
                        </h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            Compare your original CV with the AI-optimized version below.
                        </p>
                    </div>

                    {/* Disclaimer */}
                    <div style={{
                        background: 'rgba(245,158,11,0.08)',
                        border: '1px solid rgba(245,158,11,0.25)',
                        borderRadius: 'var(--radius-md)',
                        padding: '10px 16px',
                        marginBottom: 20,
                        fontSize: '0.82rem',
                        color: 'var(--accent-amber)',
                        textAlign: 'center',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}>
                        <Warning size={14} /> AI-assisted optimization · Only information from the original CV was used
                    </div>

                    {optimizedCv ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                            <CvPanel data={cvData} title="Original CV" accent="var(--text-muted)" />
                            <CvPanel data={optimizedCv} title="Optimized CV" accent="var(--accent-green)" />
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                            <div className="shimmer-loading" style={{ height: 400, borderRadius: 'var(--radius-lg)' }} />
                            <div className="shimmer-loading" style={{ height: 400, borderRadius: 'var(--radius-lg)' }} />
                        </div>
                    )}

                    {/* Download */}
                    {optimizedCv && (
                        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 24 }}>
                            <button className="btn-primary" onClick={handleDownload}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.95rem', padding: '12px 32px' }}>
                                <DownloadSimple size={18} /> Download Optimized CV
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── BOTTOM ACTIONS ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button className="btn-secondary" onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ArrowLeft size={16} /> Try Another URL
                </button>
                <button className="btn-secondary" onClick={() => { resetAll(); setStep(1); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ArrowCounterClockwise size={16} /> Start Over
                </button>
            </div>
        </div>
    );
}
