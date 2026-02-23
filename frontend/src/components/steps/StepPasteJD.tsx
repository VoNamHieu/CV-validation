'use client';

import { useState, useRef, useCallback } from 'react';
import { FileText, ArrowLeft, Upload, Link, Plus, X, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { extractJdStructured, parsePdfWithAI, crawlUrl, scoreFit } from '@/lib/api';

export default function StepPasteJD() {
    const {
        setStep, jdRawText, setJdRawText, setJdData, setLoading,
        cvData, addJdEntry, updateJdEntry, jdEntries, clearJdEntries,
    } = useAppStore();

    const [text, setText] = useState(jdRawText);
    const [urlInput, setUrlInput] = useState('');
    const [urls, setUrls] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [mode, setMode] = useState<'text' | 'urls'>('urls');
    const [processing, setProcessing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Add URLs from input (supports multiple lines / comma / space separated)
    const addUrls = () => {
        const newUrls = urlInput
            .split(/[\n,\s]+/)
            .map(u => u.trim())
            .filter(u => u && (u.startsWith('http://') || u.startsWith('https://')));
        if (newUrls.length === 0) {
            setError('Please enter valid URLs (starting with http:// or https://)');
            return;
        }
        setUrls(prev => [...prev, ...newUrls.filter(u => !prev.includes(u))]);
        setUrlInput('');
        setError('');
    };

    const removeUrl = (url: string) => {
        setUrls(prev => prev.filter(u => u !== url));
    };

    const getHostname = (url: string) => {
        try { return new URL(url).hostname; } catch { return url; }
    };

    // Process all URLs: crawl → parse → score
    const processUrls = async () => {
        if (urls.length === 0) { setError('Add at least one JD URL.'); return; }
        if (!cvData) { setError('Please upload your CV first.'); return; }

        setError('');
        setProcessing(true);
        clearJdEntries();

        // Create entries
        const entries = urls.map((url, i) => ({
            id: `jd-${Date.now()}-${i}`,
            source: url,
            label: getHostname(url),
            status: 'pending' as const,
        }));
        entries.forEach(e => addJdEntry(e));

        // Process each sequentially
        for (const entry of entries) {
            try {
                // Crawl
                updateJdEntry(entry.id, { status: 'crawling' });
                const rawText = await crawlUrl(entry.source);

                // Parse JD
                updateJdEntry(entry.id, { status: 'parsing' });
                const jdData = await extractJdStructured(rawText);

                // Score
                updateJdEntry(entry.id, { status: 'scoring' });
                const matchResult = await scoreFit(cvData, jdData);

                updateJdEntry(entry.id, { status: 'done', jdData, matchResult });
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : 'Failed';
                updateJdEntry(entry.id, { status: 'error', error: msg });
            }
        }

        setProcessing(false);
        setStep(3);
    };

    // Single text analysis (legacy)
    const handleAnalyzeText = async (rawText: string) => {
        if (!rawText.trim()) { setError('Please paste a job description.'); return; }
        setError('');
        setLoading(true, 'Analyzing Job Description with AI...');
        try {
            setJdRawText(rawText);
            const structured = await extractJdStructured(rawText);
            setJdData(structured);

            // Also add as a single entry for unified ranking view
            if (cvData) {
                const matchResult = await scoreFit(cvData, structured);
                clearJdEntries();
                addJdEntry({
                    id: `jd-text-${Date.now()}`,
                    source: 'text',
                    label: 'Pasted JD',
                    status: 'done',
                    jdData: structured,
                    matchResult,
                });
            }

            setLoading(false);
            setStep(3);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Analysis failed');
            setLoading(false);
        }
    };

    const handlePdfUpload = useCallback(async (file: File) => {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            setError('Only PDF files are supported.'); return;
        }
        setError('');
        setLoading(true, 'Analyzing JD PDF with AI...');
        try {
            const structured = await parsePdfWithAI(file, 'jd');
            setJdData(structured);
            setJdRawText('(parsed from PDF)');

            if (cvData) {
                const matchResult = await scoreFit(cvData, structured);
                clearJdEntries();
                addJdEntry({
                    id: `jd-pdf-${Date.now()}`,
                    source: 'pdf',
                    label: file.name,
                    status: 'done',
                    jdData: structured,
                    matchResult,
                });
            }

            setLoading(false);
            setStep(3);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Upload failed');
            setLoading(false);
        }
    }, [setJdRawText, setJdData, setLoading, cvData, clearJdEntries, addJdEntry, setStep]);

    const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handlePdfUpload(file);
    };

    return (
        <div className="animate-fade-in" style={{ maxWidth: 750, margin: '0 auto', padding: '40px 20px' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 8 }}>
                Job Descriptions
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: '0.95rem' }}>
                Add multiple JD URLs to compare, or paste/upload a single JD.
            </p>

            {/* Mode Toggle */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
                <button
                    className={mode === 'urls' ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setMode('urls')}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', fontSize: '0.85rem' }}
                >
                    <Link size={14} /> Multiple URLs
                </button>
                <button
                    className={mode === 'text' ? 'btn-primary' : 'btn-secondary'}
                    onClick={() => setMode('text')}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', fontSize: '0.85rem' }}
                >
                    <FileText size={14} /> Paste Text
                </button>
                <button
                    className="btn-secondary"
                    onClick={() => fileInputRef.current?.click()}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', fontSize: '0.85rem' }}
                >
                    <Upload size={14} /> Upload PDF
                </button>
                <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={onFileSelect} />
            </div>

            {/* URL Mode */}
            {mode === 'urls' && (
                <>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                        <textarea
                            className="input-field"
                            rows={3}
                            placeholder={"Paste JD URLs here (one per line, comma, or space separated)\nhttps://example.com/job-1\nhttps://example.com/job-2"}
                            value={urlInput}
                            onChange={(e) => setUrlInput(e.target.value)}
                            style={{ flex: 1, lineHeight: 1.5 }}
                        />
                        <button className="btn-primary" onClick={addUrls}
                            style={{ padding: '10px 16px', alignSelf: 'flex-start' }}
                        >
                            <Plus size={18} />
                        </button>
                    </div>

                    {/* URL List */}
                    {urls.length > 0 && (
                        <div className="glass-card" style={{ padding: 16, marginBottom: 16 }}>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 10, fontWeight: 500 }}>
                                {urls.length} JD{urls.length > 1 ? 's' : ''} queued
                            </div>
                            {urls.map((url, i) => (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '8px 12px', marginBottom: 4,
                                    background: 'var(--bg-secondary)', borderRadius: 8,
                                    fontSize: '0.83rem',
                                }}>
                                    <Link size={13} style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />
                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                                        {url}
                                    </span>
                                    <button onClick={() => removeUrl(url)}
                                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}>
                                        <X size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Processing Status */}
                    {processing && jdEntries.length > 0 && (
                        <div className="glass-card" style={{ padding: 16, marginBottom: 16 }}>
                            {jdEntries.map((entry) => (
                                <div key={entry.id} style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '6px 0', fontSize: '0.83rem',
                                }}>
                                    {entry.status === 'done' ? (
                                        <span style={{ color: 'var(--accent-green)' }}>✓</span>
                                    ) : entry.status === 'error' ? (
                                        <span style={{ color: 'var(--accent-red)' }}>✗</span>
                                    ) : (
                                        <Loader2 size={14} style={{ color: 'var(--accent-blue)', animation: 'spin 1s linear infinite' }} />
                                    )}
                                    <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{entry.label}</span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                        {entry.status === 'crawling' && 'Fetching...'}
                                        {entry.status === 'parsing' && 'Parsing JD...'}
                                        {entry.status === 'scoring' && 'Scoring...'}
                                        {entry.status === 'done' && `${entry.matchResult?.overall_score}/100`}
                                        {entry.status === 'error' && entry.error}
                                    </span>
                                    <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* Text Mode */}
            {mode === 'text' && (
                <textarea
                    className="input-field"
                    rows={14}
                    placeholder="Paste the full job description here..."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    style={{ lineHeight: 1.6, marginBottom: 16 }}
                />
            )}

            {error && (
                <p style={{ color: 'var(--accent-red)', marginTop: 8, fontSize: '0.85rem' }}>{error}</p>
            )}

            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn-secondary" onClick={() => setStep(1)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ArrowLeft size={16} /> Back
                </button>
                {mode === 'urls' ? (
                    <button className="btn-primary" onClick={processUrls} disabled={urls.length === 0 || processing}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Link size={16} /> Analyze {urls.length} JD{urls.length !== 1 ? 's' : ''}
                        </span>
                    </button>
                ) : (
                    <button className="btn-primary" onClick={() => handleAnalyzeText(text)}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <FileText size={16} /> Analyze Match
                        </span>
                    </button>
                )}
            </div>
        </div>
    );
}
