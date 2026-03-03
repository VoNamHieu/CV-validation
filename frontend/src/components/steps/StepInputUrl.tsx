'use client';

import { useState } from 'react';
import { ArrowLeft, Globe, Loader2, Search, AlertCircle, Sparkles } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { crawlUrl, extractJdStructured, scoreFit } from '@/lib/api';

export default function StepInputUrl() {
    const {
        setStep, cvData, setJdData, setMatchResult, setLoading,
        clearJdEntries, addJdEntry, setOptimizedCv,
    } = useAppStore();

    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const [status, setStatus] = useState<'idle' | 'crawling' | 'detecting' | 'scoring'>('idle');
    const [statusMessage, setStatusMessage] = useState('');

    const isValidUrl = (u: string) => {
        try {
            const parsed = new URL(u.trim());
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch { return false; }
    };

    const getHostname = (u: string) => {
        try { return new URL(u).hostname; } catch { return u; }
    };

    const handleAnalyze = async () => {
        const trimmed = url.trim();
        if (!trimmed) { setError('Please enter a URL.'); return; }
        if (!isValidUrl(trimmed)) { setError('Please enter a valid URL starting with http:// or https://'); return; }
        if (!cvData) { setError('Please upload your CV first.'); return; }

        setError('');
        setOptimizedCv(null);

        try {
            // Step 1: Crawl
            setStatus('crawling');
            setStatusMessage('Fetching website content...');
            const rawText = await crawlUrl(trimmed);

            if (!rawText || rawText.length < 50) {
                throw new Error('Could not extract enough content from this URL. Try a different page.');
            }

            // Step 2: AI Detect JD
            setStatus('detecting');
            setStatusMessage('AI is detecting job description...');
            const jdData = await extractJdStructured(rawText);
            setJdData(jdData);

            // Step 3: Score Match
            setStatus('scoring');
            setStatusMessage('Calculating match score...');
            const matchResult = await scoreFit(cvData, jdData);
            setMatchResult(matchResult);

            // Store as entry for report
            clearJdEntries();
            addJdEntry({
                id: `jd-url-${Date.now()}`,
                source: trimmed,
                label: getHostname(trimmed),
                status: 'done',
                jdData,
                matchResult,
            });

            setStatus('idle');
            setStep(3);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Analysis failed';
            setError(msg);
            setStatus('idle');
            setStatusMessage('');
        }
    };

    const isProcessing = status !== 'idle';

    return (
        <div className="animate-fade-in" style={{ maxWidth: 640, margin: '0 auto', padding: '40px 20px' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 8 }}>
                <Globe size={22} style={{ display: 'inline', marginRight: 8, color: 'var(--accent-cyan)' }} />
                Input Job Page URL
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32, fontSize: '0.95rem' }}>
                Paste a link to any job posting page. Our AI will automatically crawl the page, detect the job description, and analyze the match with your CV.
            </p>

            {/* Info note */}
            <div style={{
                background: 'rgba(59, 130, 246, 0.06)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                marginBottom: 24,
                fontSize: '0.82rem',
                color: 'var(--accent-blue)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
            }}>
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>Works best with static job pages (LinkedIn, Indeed, Glassdoor, company career pages). One URL per analysis.</span>
            </div>

            {/* URL Input */}
            <div style={{ position: 'relative', marginBottom: 16 }}>
                <div style={{
                    position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                    color: 'var(--text-muted)', pointerEvents: 'none',
                }}>
                    <Search size={18} />
                </div>
                <input
                    className="input-field"
                    type="url"
                    placeholder="https://example.com/jobs/software-engineer"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !isProcessing) handleAnalyze(); }}
                    disabled={isProcessing}
                    style={{
                        paddingLeft: 42,
                        height: 52,
                        fontSize: '0.95rem',
                        borderRadius: 'var(--radius-lg)',
                    }}
                />
            </div>

            {/* Processing Status */}
            {isProcessing && (
                <div className="glass-card" style={{
                    padding: '20px 24px',
                    marginBottom: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                }}>
                    {/* Progress Steps */}
                    {(['crawling', 'detecting', 'scoring'] as const).map((step, i) => {
                        const labels = {
                            crawling: 'Fetching website content',
                            detecting: 'AI detecting job description',
                            scoring: 'Calculating match score',
                        };
                        const stepOrder = ['crawling', 'detecting', 'scoring'];
                        const currentIdx = stepOrder.indexOf(status);
                        const stepIdx = i;
                        const isDone = stepIdx < currentIdx;
                        const isActive = stepIdx === currentIdx;

                        return (
                            <div key={step} style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                opacity: stepIdx > currentIdx ? 0.35 : 1,
                            }}>
                                {isDone ? (
                                    <div style={{
                                        width: 28, height: 28, borderRadius: '50%',
                                        background: 'var(--accent-green)', display: 'flex',
                                        alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <span style={{ color: 'white', fontSize: '0.75rem', fontWeight: 700 }}>✓</span>
                                    </div>
                                ) : isActive ? (
                                    <div style={{
                                        width: 28, height: 28, borderRadius: '50%',
                                        background: 'var(--accent-blue)', display: 'flex',
                                        alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <Loader2 size={14} style={{ color: 'white', animation: 'spin 1s linear infinite' }} />
                                    </div>
                                ) : (
                                    <div style={{
                                        width: 28, height: 28, borderRadius: '50%',
                                        background: 'var(--bg-secondary)', border: '2px solid var(--border-subtle)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{i + 1}</span>
                                    </div>
                                )}
                                <span style={{
                                    fontSize: '0.88rem',
                                    fontWeight: isActive ? 600 : 400,
                                    color: isActive ? 'var(--text-primary)' : isDone ? 'var(--accent-green)' : 'var(--text-muted)',
                                }}>
                                    {labels[step]}
                                </span>
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
                    onClick={handleAnalyze}
                    disabled={isProcessing || !url.trim()}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                    {isProcessing ? (
                        <>
                            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                            {statusMessage}
                        </>
                    ) : (
                        <>
                            <Sparkles size={16} /> Analyze Match
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
