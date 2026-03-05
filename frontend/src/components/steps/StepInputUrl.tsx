'use client';

import { useState } from 'react';
import {
    ArrowLeft, Globe, SpinnerGap, MagnifyingGlass, Sparkle,
    Brain, LinkSimple, Crosshair, ChartBar, MagicWand, CheckCircle,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { smartSearch, crawlUrl, extractJdStructured, scoreFit, fetchPage, extractJobLinks } from '@/lib/api';
import JobBoard from '@/components/JobBoard';

type Phase = 'idle' | 'analyzing_cv' | 'searching' | 'extracting_links' | 'crawling_job' | 'detecting_jd' | 'scoring';

const PHASE_CONFIG: Record<Exclude<Phase, 'idle'>, { label: string; icon: Icon }> = {
    analyzing_cv: { label: 'AI analyzing your CV...', icon: Brain },
    searching: { label: 'Searching jobs on the site...', icon: MagnifyingGlass },
    extracting_links: { label: 'Finding job listings...', icon: LinkSimple },
    crawling_job: { label: 'Fetching job page...', icon: Globe },
    detecting_jd: { label: 'AI extracting job description...', icon: Crosshair },
    scoring: { label: 'Calculating match score...', icon: ChartBar },
};

const PHASE_ORDER: Exclude<Phase, 'idle'>[] = [
    'analyzing_cv', 'searching', 'extracting_links', 'crawling_job', 'detecting_jd', 'scoring',
];

export default function StepInputUrl() {
    const {
        setStep, cvData, setJdData, setMatchResult,
        clearJdEntries, addJdEntry, updateJdEntry, setOptimizedCv, addJobRecord,
    } = useAppStore();

    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const [phase, setPhase] = useState<Phase>('idle');
    const [phaseDetail, setPhaseDetail] = useState('');
    const [inferredTitle, setInferredTitle] = useState('');

    const isValidUrl = (u: string) => {
        try {
            const parsed = new URL(u.trim());
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch { return false; }
    };

    const getHostname = (u: string) => {
        try { return new URL(u).hostname; } catch { return u; }
    };

    const handleSmartAnalyze = async () => {
        const trimmed = url.trim();
        if (!trimmed) { setError('Please enter a job site URL.'); return; }
        if (!isValidUrl(trimmed)) { setError('Please enter a valid URL (http:// or https://)'); return; }
        if (!cvData) { setError('Please upload your CV first.'); return; }

        setError('');
        setOptimizedCv(null);
        setInferredTitle('');
        clearJdEntries();

        try {
            // ─── Phase 1: AI Analyze CV → infer job title + search URL ───
            setPhase('analyzing_cv');
            setPhaseDetail('Reading your CV to understand what job you want...');
            let searchResult = await smartSearch(cvData, trimmed);
            if (Array.isArray(searchResult)) searchResult = searchResult[0];
            if (!searchResult?.search_url) throw new Error('AI could not generate a search URL.');
            setInferredTitle(searchResult.inferred_job_title);
            setPhaseDetail(`Looking for: "${searchResult.inferred_job_title}"`);

            // ─── Phase 2: Crawl the search results page ───
            setPhase('searching');
            const hostname = getHostname(trimmed);
            setPhaseDetail(`Searching on ${hostname}...`);

            let searchPage: { text: string; textWithLinks?: string } = { text: '', textWithLinks: '' };
            try {
                searchPage = await crawlUrl(searchResult.search_url, true);
            } catch (crawlErr) {
                console.log('[StepInputUrl] Search page crawl failed:', crawlErr);
            }

            // ─── Phase 3: Extract job links ───
            setPhase('extracting_links');
            setPhaseDetail('AI is finding job listings...');
            const linksResult = await extractJobLinks(searchPage.textWithLinks || searchPage.text, trimmed);
            if (!linksResult.found || !linksResult.job_urls?.length) {
                throw new Error(`No job listings found on ${hostname}. Try a different job site.`);
            }

            // Take up to 5 unique job URLs
            const MAX_JOBS = 5;
            const jobUrls: string[] = linksResult.job_urls.slice(0, MAX_JOBS);
            setPhaseDetail(`Found ${linksResult.total_found} jobs → processing top ${jobUrls.length}`);

            // Create placeholder entries
            for (const jobUrl of jobUrls) {
                addJdEntry({
                    id: `jd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    source: jobUrl,
                    label: getHostname(jobUrl),
                    status: 'crawling',
                });
            }

            // ─── Phase 4-6: Crawl + Extract JD + Score for each job ───
            setPhase('crawling_job');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const buildJdFromLd = (ld: any): string => [
                ld.title && `Job Title: ${ld.title}`,
                ld.hiringOrganization?.name && `Company: ${ld.hiringOrganization.name}`,
                ld.jobLocation?.address?.addressLocality && `Location: ${ld.jobLocation.address.addressLocality}`,
                ld.description && `\nJob Description:\n${ld.description}`,
                ld.qualifications && `\nQualifications:\n${ld.qualifications}`,
                ld.jobBenefits && `\nBenefits:\n${ld.jobBenefits}`,
            ].filter(Boolean).join('\n');

            // Process all jobs (sequential to avoid rate limits)
            const entries = useAppStore.getState().jdEntries;
            let completedCount = 0;

            for (const entry of entries) {
                const entryId = entry.id;
                const jobUrl = entry.source;
                setPhaseDetail(`Processing job ${completedCount + 1}/${jobUrls.length}: ${jobUrl.slice(0, 50)}...`);

                try {
                    // Crawl
                    updateJdEntry(entryId, { status: 'crawling' });
                    let jobPageText = '';
                    let jobTitle = '';
                    let company = '';

                    // Try HTTP first
                    try {
                        const jobPage = await crawlUrl(jobUrl);
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const ld = (jobPage as any).jsonLd;
                        if (ld?.description) {
                            jobPageText = buildJdFromLd(ld);
                            jobTitle = ld.title || '';
                            company = ld.hiringOrganization?.name || '';
                        } else if ((jobPage.text?.length ?? 0) >= 500) {
                            jobPageText = jobPage.text;
                        }
                    } catch { /* HTTP fail, try playwright */ }

                    // Playwright fallback
                    if (jobPageText.length < 200) {
                        try {
                            const pw = await fetchPage(jobUrl);
                            if (pw.success) {
                                if (pw.jsonLd?.description) {
                                    jobPageText = buildJdFromLd(pw.jsonLd);
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    jobTitle = (pw.jsonLd as any).title || '';
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    company = (pw.jsonLd as any).hiringOrganization?.name || '';
                                } else if (pw.text.length >= 200) {
                                    jobPageText = pw.text;
                                }
                            }
                        } catch { /* pw fail */ }
                    }

                    if (jobPageText.length < 100) {
                        updateJdEntry(entryId, { status: 'error', error: 'Could not load job page' });
                        completedCount++;
                        continue;
                    }

                    // Extract JD
                    updateJdEntry(entryId, { status: 'parsing' });
                    let jdData = await extractJdStructured(jobPageText);
                    if (Array.isArray(jdData)) jdData = jdData[0];
                    if (!jdData || (!jdData.must_have?.length && !jdData.responsibilities?.length)) {
                        updateJdEntry(entryId, { status: 'error', error: 'No JD found on page' });
                        completedCount++;
                        continue;
                    }

                    // Score
                    updateJdEntry(entryId, { status: 'scoring' });
                    let matchResult = await scoreFit(cvData, jdData);
                    if (Array.isArray(matchResult)) matchResult = matchResult[0];
                    if (!matchResult?.overall_score) {
                        updateJdEntry(entryId, { status: 'error', error: 'Scoring failed' });
                        completedCount++;
                        continue;
                    }

                    // Detect job title from JD if not from JSON-LD
                    if (!jobTitle && jdData.domain) {
                        jobTitle = searchResult.inferred_job_title;
                    }

                    updateJdEntry(entryId, {
                        status: 'done',
                        jdData,
                        matchResult,
                        jobTitle: jobTitle || searchResult.inferred_job_title,
                        company,
                    });

                    // Also save first successful to legacy fields for backward compat
                    if (completedCount === 0 || !useAppStore.getState().matchResult) {
                        setJdData(jdData);
                        setMatchResult(matchResult);
                    }

                    addJobRecord({
                        id: `job-${Date.now()}`,
                        jobTitle: jobTitle || searchResult.inferred_job_title,
                        company,
                        jobUrl,
                        siteName: hostname,
                        overallScore: matchResult.overall_score,
                        timestamp: Date.now(),
                        jdData,
                        matchResult,
                    });

                } catch (err) {
                    updateJdEntry(entryId, {
                        status: 'error',
                        error: err instanceof Error ? err.message : 'Unknown error',
                    });
                }
                completedCount++;
            }

            setPhase('idle');
            setStep(3);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Analysis failed';
            setError(msg);
            setPhase('idle');
            setPhaseDetail('');
        }
    };

    const isProcessing = phase !== 'idle';
    const currentPhaseIdx = PHASE_ORDER.indexOf(phase as Exclude<Phase, 'idle'>);

    return (
        <div className="animate-fade-in" style={{ maxWidth: 660, margin: '0 auto', padding: '40px 20px' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 8 }}>
                <MagicWand size={22} weight="duotone" style={{ display: 'inline', marginRight: 8, color: 'var(--accent-purple)' }} />
                Smart Job Finder
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32, fontSize: '0.95rem', lineHeight: 1.6 }}>
                Paste any job site URL (e.g. <span style={{ color: 'var(--accent-cyan)' }}>vietnamworks.com</span>,{' '}
                <span style={{ color: 'var(--accent-cyan)' }}>topcv.vn</span>,{' '}
                <span style={{ color: 'var(--accent-cyan)' }}>indeed.com</span>).
                AI will read your CV, search for matching jobs, pick one, and analyze the fit.
            </p>

            {/* How it works */}
            <div className="glass-card" style={{
                padding: '16px 20px', marginBottom: 24,
                background: 'linear-gradient(135deg, rgba(139,92,246,0.05), rgba(59,130,246,0.04))',
            }}>
                <p style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    How it works
                </p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['CV → AI infers role', 'Search jobs on site', 'Pick a random job', 'Extract JD', 'Score match'].map((step, i) => (
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
                    placeholder="https://www.vietnamworks.com/"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !isProcessing) handleSmartAnalyze(); }}
                    disabled={isProcessing}
                    style={{
                        paddingLeft: 42,
                        height: 52,
                        fontSize: '0.95rem',
                        borderRadius: 'var(--radius-lg)',
                    }}
                />
            </div>

            {/* Inferred title badge */}
            {inferredTitle && isProcessing && (
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', borderRadius: 20, marginBottom: 12,
                    background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)',
                    fontSize: '0.82rem', color: 'var(--accent-purple)', fontWeight: 500,
                }}>
                    <Brain size={13} weight="duotone" /> AI detected: {inferredTitle}
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
                                        transition: 'all 0.3s',
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
                    onClick={handleSmartAnalyze}
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
                            <Sparkle size={16} weight="fill" /> Find & Analyze Job
                        </>
                    )}
                </button>
            </div>

            {/* Job History Board */}
            <JobBoard />
        </div>
    );
}
