'use client';

import { useState } from 'react';
import {
    ArrowLeft, ArrowRight, Briefcase, Building, ChartBar,
    CheckCircle, Compass, Globe, LinkSimple,
    MagicWand, SpinnerGap, Sparkle,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import {
    findCareer, crawlUrl, fetchPage, extractJdStructured, scoreFit,
    extensionCrawl, isExtensionAvailable,
    type FinderResult,
} from '@/lib/api';

type Phase = 'idle' | 'resolving' | 'discovering' | 'listing' | 'scoring';

const PHASE_CONFIG: Record<Exclude<Phase, 'idle'>, { label: string; icon: Icon }> = {
    resolving:   { label: 'Resolving company from URL...',     icon: Building },
    discovering: { label: 'Finding the company career page...', icon: Compass },
    listing:     { label: 'Listing open positions...',          icon: LinkSimple },
    scoring:     { label: 'Scoring each job against your CV...', icon: ChartBar },
};

const PHASE_ORDER: Exclude<Phase, 'idle'>[] = ['resolving', 'discovering', 'listing', 'scoring'];

// Cap how many jobs we crawl + score per run. Scoring is the expensive step
// (one Gemini call per job for JD extract + another for fit), so we keep
// this small and let the user request more later if needed.
const MAX_JOBS_TO_SCORE = 5;

const getHostname = (u: string) => {
    try { return new URL(u).hostname; } catch { return u; }
};

const isValidUrl = (u: string) => {
    try {
        const parsed = new URL(u.trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch { return false; }
};

export default function StepFindJobs() {
    const {
        setStep, cvData, setJdData, setMatchResult,
        clearJdEntries, addJdEntry, updateJdEntry, setOptimizedCv, addJobRecord,
        setView, jobHistory,
    } = useAppStore();

    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const [phase, setPhase] = useState<Phase>('idle');
    const [phaseDetail, setPhaseDetail] = useState('');
    const [finder, setFinder] = useState<FinderResult | null>(null);

    const isProcessing = phase !== 'idle';
    const currentPhaseIdx = PHASE_ORDER.indexOf(phase as Exclude<Phase, 'idle'>);

    const handleFind = async () => {
        const trimmed = url.trim();
        if (!trimmed) { setError('Please paste a job site URL or company URL.'); return; }
        if (!isValidUrl(trimmed)) { setError('Please enter a valid URL (http:// or https://)'); return; }
        if (!cvData) { setError('Please upload your CV first.'); return; }

        setError('');
        setOptimizedCv(null);
        setFinder(null);
        clearJdEntries();

        try {
            // ─── Phase 1+2: backend pipeline does Stage 0 → 1 → 2 → 3 ───
            setPhase('resolving');
            setPhaseDetail(`Reading ${getHostname(trimmed)}...`);

            const result = await findCareer({ input_url: trimmed });
            setFinder(result);

            if (!result.chosen_career) {
                const reason = result.errors[0] || 'No career page found for this company.';
                throw new Error(reason);
            }

            setPhase('discovering');
            setPhaseDetail(`Found ${result.resolution.company_name || 'company'} → ${result.chosen_career.url}`);

            // ─── Phase 3: jobs already listed by Stage 4 in the backend ───
            setPhase('listing');
            const allJobs = result.jobs ?? [];
            if (!allJobs.length) {
                // Pipeline ran but Stage 4 couldn't list jobs — surface the career
                // page anyway, no scoring possible.
                setPhase('idle');
                setError(
                    `Found the career page (${result.chosen_career.url}) but couldn't list open positions on it. ` +
                    `The site may render jobs client-side in a way we can't read yet.`,
                );
                return;
            }
            const jobs = allJobs.slice(0, MAX_JOBS_TO_SCORE);
            setPhaseDetail(`Found ${allJobs.length} jobs → scoring top ${jobs.length}`);

            // Seed entries so the UI shows the job list before scoring resolves.
            for (const job of jobs) {
                addJdEntry({
                    id: `jd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    source: job.url,
                    label: job.title || getHostname(job.url),
                    status: 'crawling',
                    jobTitle: job.title || undefined,
                    company: result.resolution.company_name || undefined,
                });
            }

            // ─── Phase 4: per-job crawl → extract JD → score ───
            setPhase('scoring');
            const company = result.resolution.company_name || '';
            const careerHost = getHostname(result.chosen_career.url);
            const entries = useAppStore.getState().jdEntries;
            let successCount = 0;

            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                const jobUrl = entry.source;
                setPhaseDetail(`Job ${i + 1}/${jobs.length}: ${entry.label.slice(0, 60)}`);

                try {
                    // Crawl with the same HTTP → Playwright → extension fallback
                    // chain we use elsewhere. Career pages on company sites are
                    // usually friendly to HTTP, so this is rarely needed past step 1.
                    updateJdEntry(entry.id, { status: 'crawling' });
                    let jobPageText = '';

                    try {
                        const page = await crawlUrl(jobUrl);
                        if ((page.text?.length ?? 0) >= 400) {
                            jobPageText = page.text;
                        }
                    } catch { /* fall through to Playwright */ }

                    if (jobPageText.length < 400) {
                        try {
                            const pw = await fetchPage(jobUrl);
                            if (pw.success && pw.text.length >= 200) {
                                jobPageText = pw.text;
                            }
                        } catch { /* fall through to extension */ }
                    }

                    if (jobPageText.length < 400 && isExtensionAvailable()) {
                        try {
                            const ext = await extensionCrawl(jobUrl);
                            if (ext.success && ext.text.length >= 200) {
                                jobPageText = ext.text;
                            }
                        } catch { /* give up — entry will go to error */ }
                    }

                    if (jobPageText.length < 200) {
                        updateJdEntry(entry.id, { status: 'error', error: 'Could not load job page' });
                        continue;
                    }

                    // Extract JD
                    updateJdEntry(entry.id, { status: 'parsing' });
                    let jdData = await extractJdStructured(jobPageText);
                    if (Array.isArray(jdData)) jdData = jdData[0];
                    if (!jdData || (!jdData.must_have?.length && !jdData.responsibilities?.length)) {
                        updateJdEntry(entry.id, { status: 'error', error: 'No JD found on page' });
                        continue;
                    }

                    // Score
                    updateJdEntry(entry.id, { status: 'scoring' });
                    let matchResult = await scoreFit(cvData, jdData);
                    if (Array.isArray(matchResult)) matchResult = matchResult[0];
                    if (!matchResult?.overall_score) {
                        updateJdEntry(entry.id, { status: 'error', error: 'Scoring failed' });
                        continue;
                    }

                    const resolvedTitle = entry.jobTitle || 'Unknown role';
                    updateJdEntry(entry.id, {
                        status: 'done',
                        jdData,
                        matchResult,
                        jobTitle: resolvedTitle,
                        company,
                    });

                    // First successful job also populates legacy fields so the
                    // single-JD report screens keep working.
                    if (successCount === 0 || !useAppStore.getState().matchResult) {
                        setJdData(jdData);
                        setMatchResult(matchResult);
                    }

                    addJobRecord({
                        id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                        jobTitle: resolvedTitle,
                        company,
                        jobUrl,
                        siteName: careerHost,
                        overallScore: matchResult.overall_score,
                        timestamp: Date.now(),
                        jdData,
                        matchResult,
                        status: 'saved',
                    });
                    successCount++;
                } catch (err) {
                    updateJdEntry(entry.id, {
                        status: 'error',
                        error: err instanceof Error ? err.message : 'Unknown error',
                    });
                }
            }

            setPhase('idle');
            setStep(3);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Find-jobs pipeline failed';
            setError(msg);
            setPhase('idle');
            setPhaseDetail('');
        }
    };

    return (
        <div className="animate-fade-in" style={{ maxWidth: 660, margin: '0 auto', padding: '40px 20px' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 8 }}>
                <MagicWand size={22} weight="duotone" style={{ display: 'inline', marginRight: 8, color: 'var(--accent-purple)' }} />
                Smart Job Finder
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32, fontSize: '0.95rem', lineHeight: 1.6 }}>
                Paste any company or job posting URL. We&apos;ll find the company&apos;s official careers page and
                score the open positions against your CV.
            </p>

            {/* How it works */}
            <div className="glass-card" style={{
                padding: '16px 20px', marginBottom: 24,
                background: 'linear-gradient(135deg, rgba(196, 59, 46,0.05), rgba(59,130,246,0.04))',
            }}>
                <p style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    How it works
                </p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['Resolve company', 'Find official career page', 'List open jobs', 'Score against your CV'].map((step, i) => (
                        <span key={i} style={{
                            fontSize: '0.75rem', padding: '3px 10px', borderRadius: 20,
                            background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                            display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                            {i > 0 && <span style={{ color: 'var(--accent-blue)' }}>→</span>}
                            {step}
                        </span>
                    ))}
                </div>
            </div>

            {/* URL Input */}
            <div style={{ position: 'relative', marginBottom: 16 }}>
                <div style={{
                    position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                    color: 'var(--text-muted)', pointerEvents: 'none',
                }}>
                    <Globe size={18} weight="duotone" />
                </div>
                <input
                    className="input-field"
                    type="url"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !isProcessing) handleFind(); }}
                    disabled={isProcessing}
                    style={{
                        paddingLeft: 42,
                        height: 52,
                        fontSize: '0.95rem',
                        borderRadius: 'var(--radius-lg)',
                    }}
                />
            </div>

            {/* Resolution badge */}
            {finder?.resolution.company_name && (
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', borderRadius: 20, marginBottom: 12,
                    background: 'rgba(196, 59, 46,0.1)', border: '1px solid rgba(196, 59, 46,0.25)',
                    fontSize: '0.82rem', color: 'var(--accent-purple)', fontWeight: 500,
                }}>
                    <Building size={13} weight="duotone" /> {finder.resolution.company_name}
                    {finder.chosen_career && (
                        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                            · {getHostname(finder.chosen_career.url)}
                        </span>
                    )}
                </div>
            )}

            {/* Processing Pipeline */}
            {isProcessing && (
                <div className="glass-card" style={{
                    padding: '20px 24px', marginBottom: 16,
                    display: 'flex', flexDirection: 'column', gap: 14,
                }}>
                    {PHASE_ORDER.map((p, i) => {
                        const config = PHASE_CONFIG[p];
                        const isDone = i < currentPhaseIdx;
                        const isActive = i === currentPhaseIdx;
                        const Icon = config.icon;

                        return (
                            <div key={p} style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                opacity: i > currentPhaseIdx ? 0.3 : 1,
                                transition: 'opacity 0.3s',
                            }}>
                                {isDone ? (
                                    <div style={{
                                        width: 30, height: 30, borderRadius: '50%',
                                        background: 'var(--accent-green)', display: 'flex',
                                        alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <CheckCircle size={16} weight="fill" color="white" />
                                    </div>
                                ) : isActive ? (
                                    <div style={{
                                        width: 30, height: 30, borderRadius: '50%',
                                        background: 'var(--accent-blue)', display: 'flex',
                                        alignItems: 'center', justifyContent: 'center',
                                        boxShadow: '0 0 12px var(--accent-blue-glow)',
                                    }}>
                                        <SpinnerGap size={14} style={{ color: 'white', animation: 'spin 1s linear infinite' }} />
                                    </div>
                                ) : (
                                    <div style={{
                                        width: 30, height: 30, borderRadius: '50%',
                                        background: 'var(--bg-secondary)', border: '2px solid var(--border-subtle)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <Icon size={13} weight="duotone" style={{ color: 'var(--text-muted)' }} />
                                    </div>
                                )}
                                <div style={{ flex: 1 }}>
                                    <span style={{
                                        fontSize: '0.85rem',
                                        fontWeight: isActive ? 600 : 400,
                                        color: isActive ? 'var(--text-primary)' : isDone ? 'var(--accent-green)' : 'var(--text-muted)',
                                    }}>
                                        {config.label}
                                    </span>
                                    {isActive && phaseDetail && (
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                            {phaseDetail}
                                        </p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
                </div>
            )}

            {/* Error */}
            {error && (
                <div style={{
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 16px',
                    marginBottom: 16,
                    fontSize: '0.85rem',
                    color: 'var(--accent-red)',
                    lineHeight: 1.5,
                }}>
                    {error}
                </div>
            )}

            {/* Actions */}
            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn-secondary" onClick={() => setStep(1)} disabled={isProcessing}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ArrowLeft size={16} weight="bold" /> Back
                </button>
                <button
                    className="btn-primary"
                    onClick={handleFind}
                    disabled={isProcessing || !url.trim()}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.95rem' }}
                >
                    {isProcessing ? (
                        <>
                            <SpinnerGap size={16} style={{ animation: 'spin 1s linear infinite' }} />
                            Processing...
                        </>
                    ) : (
                        <>
                            <Sparkle size={16} weight="fill" /> Find & Score Jobs
                        </>
                    )}
                </button>
            </div>

            {/* Link to History view */}
            {jobHistory.length > 0 && (
                <button
                    onClick={() => setView('history')}
                    style={{
                        marginTop: 28,
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '12px 16px', width: '100%',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-card)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        transition: 'all 0.18s ease',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--bg-card-hover)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--bg-card)';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                    }}
                >
                    <Briefcase size={15} weight="duotone" style={{ color: 'var(--accent-blue)' }} />
                    <span style={{ flex: 1, textAlign: 'left' }}>
                        <strong style={{ color: 'var(--text-primary)' }}>{jobHistory.length}</strong>
                        {' '}application{jobHistory.length === 1 ? '' : 's'} saved · view all in History
                    </span>
                    <ArrowRight size={14} weight="bold" />
                </button>
            )}
        </div>
    );
}
