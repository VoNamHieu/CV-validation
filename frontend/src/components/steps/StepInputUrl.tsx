'use client';

import { useState } from 'react';
import { ArrowLeft, Globe, Loader2, Search, Sparkles, Brain, Link2, Target, BarChart3, Wand2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { smartSearch, crawlUrl, extractJobLinks, extractJdStructured, scoreFit } from '@/lib/api';

type Phase = 'idle' | 'analyzing_cv' | 'searching' | 'extracting_links' | 'crawling_job' | 'detecting_jd' | 'scoring';

const PHASE_CONFIG: Record<Exclude<Phase, 'idle'>, { label: string; icon: typeof Brain }> = {
    analyzing_cv: { label: 'AI analyzing your CV...', icon: Brain },
    searching: { label: 'Searching jobs on the site...', icon: Search },
    extracting_links: { label: 'Finding job listings...', icon: Link2 },
    crawling_job: { label: 'Fetching job page...', icon: Globe },
    detecting_jd: { label: 'AI extracting job description...', icon: Target },
    scoring: { label: 'Calculating match score...', icon: BarChart3 },
};

const PHASE_ORDER: Exclude<Phase, 'idle'>[] = [
    'analyzing_cv', 'searching', 'extracting_links', 'crawling_job', 'detecting_jd', 'scoring',
];

export default function StepInputUrl() {
    const {
        setStep, cvData, setJdData, setMatchResult,
        clearJdEntries, addJdEntry, setOptimizedCv,
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

        try {
            // ─── Phase 1: AI Analyze CV → infer job title + search URL ───
            setPhase('analyzing_cv');
            setPhaseDetail('Reading your CV to understand what job you want...');
            console.log('[StepInputUrl] Phase 1: smartSearch with site:', trimmed);
            const searchResult = await smartSearch(cvData, trimmed);
            console.log('[StepInputUrl] Phase 1 result:', searchResult);
            setInferredTitle(searchResult.inferred_job_title);
            setPhaseDetail(`Looking for: "${searchResult.inferred_job_title}"`);

            // ─── Phase 2: Crawl the search results page ───
            setPhase('searching');
            setPhaseDetail(`Searching on ${getHostname(trimmed)}...`);
            console.log('[StepInputUrl] Phase 2: crawling search URL:', searchResult.search_url);
            const searchPage = await crawlUrl(searchResult.search_url, true);
            console.log('[StepInputUrl] Phase 2 result: text length=', searchPage.text?.length, 'textWithLinks length=', searchPage.textWithLinks?.length);

            if (!searchPage.textWithLinks || searchPage.textWithLinks.length < 100) {
                console.log('[StepInputUrl] Phase 2 FAILED: textWithLinks too short');
                throw new Error(`Could not load search results from ${getHostname(trimmed)}. The site may block automated access.`);
            }

            // ─── Phase 3: AI Extract job links from search results ───
            setPhase('extracting_links');
            setPhaseDetail('AI is finding job listings on the page...');
            console.log('[StepInputUrl] Phase 3: extractJobLinks, textWithLinks sample:', searchPage.textWithLinks.slice(0, 500));
            const linksResult = await extractJobLinks(searchPage.textWithLinks, trimmed);
            console.log('[StepInputUrl] Phase 3 result:', linksResult);

            if (!linksResult.found || !linksResult.job_urls || linksResult.job_urls.length === 0) {
                console.log('[StepInputUrl] Phase 3 FAILED: no job links found');
                throw new Error(`No job listings found on ${getHostname(trimmed)}. Try a different job site.`);
            }

            // Pick a random job
            const randomIdx = Math.floor(Math.random() * Math.min(linksResult.job_urls.length, 10));
            const selectedJobUrl = linksResult.job_urls[randomIdx];
            console.log('[StepInputUrl] Phase 3: selected job URL:', selectedJobUrl, `(#${randomIdx + 1} of ${linksResult.job_urls.length})`);
            setPhaseDetail(`Found ${linksResult.total_found} jobs → selected #${randomIdx + 1}`);

            // ─── Phase 4: Crawl the selected job page ───
            setPhase('crawling_job');
            setPhaseDetail(`Fetching: ${selectedJobUrl.slice(0, 60)}...`);
            console.log('[StepInputUrl] Phase 4: crawling job page:', selectedJobUrl);
            const jobPage = await crawlUrl(selectedJobUrl);
            console.log('[StepInputUrl] Phase 4 result: text length=', jobPage.text?.length);

            if (!jobPage.text || jobPage.text.length < 100) {
                throw new Error('Could not load the job page. Try again.');
            }

            // ─── Phase 5: AI extract JD from the job page ───
            setPhase('detecting_jd');
            setPhaseDetail('AI is analyzing the job description...');
            console.log('[StepInputUrl] Phase 5: extracting JD from text of length', jobPage.text.length);
            const jdData = await extractJdStructured(jobPage.text);
            console.log('[StepInputUrl] Phase 5 result:', jdData);
            setJdData(jdData);

            // ─── Phase 6: Score match ───
            setPhase('scoring');
            setPhaseDetail('Calculating how well your CV matches...');
            console.log('[StepInputUrl] Phase 6: scoring match...');
            const matchResult = await scoreFit(cvData, jdData);
            console.log('[StepInputUrl] Phase 6 result:', matchResult);
            setMatchResult(matchResult);

            // Store entry for report
            clearJdEntries();
            addJdEntry({
                id: `jd-smart-${Date.now()}`,
                source: selectedJobUrl,
                label: getHostname(selectedJobUrl),
                status: 'done',
                jdData,
                matchResult,
            });

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
                <Wand2 size={22} style={{ display: 'inline', marginRight: 8, color: 'var(--accent-purple)' }} />
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
                    <Globe size={18} />
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
                    <Brain size={13} /> AI detected: {inferredTitle}
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
                                        <span style={{ color: 'white', fontSize: '0.8rem', fontWeight: 700 }}>✓</span>
                                    </div>
                                ) : isActive ? (
                                    <div style={{
                                        width: 30, height: 30, borderRadius: '50%',
                                        background: 'var(--accent-blue)', display: 'flex',
                                        alignItems: 'center', justifyContent: 'center',
                                        boxShadow: '0 0 12px var(--accent-blue-glow)',
                                    }}>
                                        <Loader2 size={14} style={{ color: 'white', animation: 'spin 1s linear infinite' }} />
                                    </div>
                                ) : (
                                    <div style={{
                                        width: 30, height: 30, borderRadius: '50%',
                                        background: 'var(--bg-secondary)', border: '2px solid var(--border-subtle)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <Icon size={13} style={{ color: 'var(--text-muted)' }} />
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
                    <ArrowLeft size={16} /> Back
                </button>
                <button
                    className="btn-primary"
                    onClick={handleSmartAnalyze}
                    disabled={isProcessing || !url.trim()}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.95rem' }}
                >
                    {isProcessing ? (
                        <>
                            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                            Processing...
                        </>
                    ) : (
                        <>
                            <Sparkles size={16} /> Find & Analyze Job
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
