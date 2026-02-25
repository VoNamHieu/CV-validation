'use client';

import { useState } from 'react';
import {
    Globe,
    Plus,
    Trash2,
    Play,
    Loader2,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Sparkles,
    ArrowLeft,
    Clock,
    Code2,
    Zap,
    FileJson,
    ChevronDown,
    ChevronUp,
    BarChart3,
    Monitor,
    Cloud,
} from 'lucide-react';
import Link from 'next/link';

// ── Types ────────────────────────────────────────────────────────────────────

interface CrawlResultData {
    url: string;
    http_success: boolean;
    needs_playwright: boolean;
    has_json_ld: boolean;
    json_ld_data: Record<string, string> | null;
    raw_html_length: number;
    cleaned_text: string;
    cleaned_text_length: number;
    error: string;
    latency_ms: number;
}

interface CrawlSummary {
    total: number;
    json_ld_count: number;
    json_ld_pct: number;
    http_ok_count: number;
    http_ok_pct: number;
    playwright_count: number;
    playwright_pct: number;
    avg_latency_ms: number;
}

interface CrawlResponse {
    results: CrawlResultData[];
    summary: CrawlSummary;
}

// ── Preset URLs ──────────────────────────────────────────────────────────────

const PRESET_URLS = [
    { label: 'Greenhouse (Anthropic)', url: 'https://boards.greenhouse.io/anthropic/jobs/4020305008' },
    { label: 'LinkedIn Job', url: 'https://www.linkedin.com/jobs/view/12345678' },
    { label: 'Indeed Job', url: 'https://www.indeed.com/viewjob?jk=abc123' },
];

// ── Component ────────────────────────────────────────────────────────────────

type CrawlMode = 'vercel' | 'local';

export default function CrawlTestPage() {
    const [urls, setUrls] = useState<string[]>(['']);
    const [results, setResults] = useState<CrawlResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());
    const [mode, setMode] = useState<CrawlMode>('vercel');

    const addUrl = () => {
        if (urls.length < 10) setUrls([...urls, '']);
    };

    const removeUrl = (index: number) => {
        if (urls.length > 1) {
            setUrls(urls.filter((_, i) => i !== index));
        }
    };

    const updateUrl = (index: number, value: string) => {
        const next = [...urls];
        next[index] = value;
        setUrls(next);
    };

    const addPreset = (url: string) => {
        const emptyIdx = urls.findIndex((u) => u.trim() === '');
        if (emptyIdx >= 0) {
            updateUrl(emptyIdx, url);
        } else if (urls.length < 10) {
            setUrls([...urls, url]);
        }
    };

    const toggleCard = (index: number) => {
        const next = new Set(expandedCards);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        setExpandedCards(next);
    };

    const runTest = async () => {
        const validUrls = urls.filter((u) => u.trim() !== '');
        if (validUrls.length === 0) {
            setError('Please enter at least one URL.');
            return;
        }

        setIsLoading(true);
        setError('');
        setResults(null);
        setExpandedCards(new Set());

        const endpoint = mode === 'local'
            ? 'http://localhost:8000/crawl/test'
            : '/api/crawl-test';

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: validUrls }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.detail || `Server error: ${res.status}`);
            }

            const data: CrawlResponse = await res.json();
            setResults(data);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
        } finally {
            setIsLoading(false);
        }
    };

    const validCount = urls.filter((u) => u.trim() !== '').length;

    return (
        <div style={{ minHeight: '100vh' }}>
            {/* Header */}
            <header
                style={{
                    padding: '20px 32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid var(--border-subtle)',
                    background: 'var(--bg-glass)',
                    backdropFilter: 'blur(12px)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 50,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Link
                        href="/"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 36,
                            height: 36,
                            borderRadius: 10,
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-secondary)',
                            textDecoration: 'none',
                            transition: 'all 0.2s ease',
                        }}
                    >
                        <ArrowLeft size={18} />
                    </Link>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: 10,
                                background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Globe size={20} style={{ color: 'white' }} />
                        </div>
                        <div>
                            <span style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>
                                Crawl Tester
                            </span>
                            <span
                                style={{
                                    display: 'block',
                                    fontSize: '0.72rem',
                                    color: 'var(--text-muted)',
                                    letterSpacing: '0.04em',
                                    textTransform: 'uppercase',
                                }}
                            >
                                Assumption Validator
                            </span>
                        </div>
                    </div>
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Test JSON-LD · HTTP vs Playwright · HTML Cleaning
                </span>
            </header>

            {/* Main content */}
            <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 80px' }}>
                {/* ── Mode Toggle ──────────────────────────────────────── */}
                <div
                    className="glass-card animate-fade-in"
                    style={{
                        padding: '16px 20px',
                        marginBottom: 16,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 16,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Mode:</span>
                        <div
                            style={{
                                display: 'flex',
                                background: 'var(--bg-secondary)',
                                borderRadius: 10,
                                padding: 3,
                                border: '1px solid var(--border-subtle)',
                            }}
                        >
                            <button
                                onClick={() => setMode('vercel')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '7px 16px',
                                    borderRadius: 8,
                                    border: 'none',
                                    fontSize: '0.8rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    background: mode === 'vercel' ? 'var(--accent-blue)' : 'transparent',
                                    color: mode === 'vercel' ? 'white' : 'var(--text-muted)',
                                    boxShadow: mode === 'vercel' ? '0 2px 8px var(--accent-blue-glow)' : 'none',
                                }}
                                id="mode-vercel"
                            >
                                <Cloud size={14} /> Vercel
                            </button>
                            <button
                                onClick={() => setMode('local')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '7px 16px',
                                    borderRadius: 8,
                                    border: 'none',
                                    fontSize: '0.8rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    background: mode === 'local' ? 'var(--accent-purple)' : 'transparent',
                                    color: mode === 'local' ? 'white' : 'var(--text-muted)',
                                    boxShadow: mode === 'local' ? '0 2px 8px rgba(139, 92, 246, 0.3)' : 'none',
                                }}
                                id="mode-local"
                            >
                                <Monitor size={14} /> Local
                            </button>
                        </div>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                        {mode === 'vercel' ? (
                            <span>HTTP fetch only · <span style={{ color: 'var(--accent-blue)' }}>Works on Vercel</span></span>
                        ) : (
                            <span>HTTP + Playwright · <span style={{ color: 'var(--accent-purple)' }}>Requires local backend at :8000</span></span>
                        )}
                    </div>
                </div>

                {/* ── URL Input Section ────────────────────────────────── */}
                <section className="glass-card animate-fade-in" style={{ padding: '28px 28px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <Sparkles size={18} style={{ color: 'var(--accent-cyan)' }} />
                        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Test URLs</h2>
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 20 }}>
                        Paste job listing URLs to test crawl strategy — JSON-LD detection, HTTP vs Playwright, HTML cleaning.
                    </p>

                    {/* Preset chips */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
                            Quick add:
                        </span>
                        {PRESET_URLS.map((p) => (
                            <button
                                key={p.url}
                                onClick={() => addPreset(p.url)}
                                style={{
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-subtle)',
                                    borderRadius: 20,
                                    padding: '5px 14px',
                                    fontSize: '0.78rem',
                                    color: 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                }}
                                onMouseEnter={(e) => {
                                    (e.target as HTMLButtonElement).style.borderColor = 'var(--accent-cyan)';
                                    (e.target as HTMLButtonElement).style.color = 'var(--accent-cyan)';
                                }}
                                onMouseLeave={(e) => {
                                    (e.target as HTMLButtonElement).style.borderColor = 'var(--border-subtle)';
                                    (e.target as HTMLButtonElement).style.color = 'var(--text-secondary)';
                                }}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    {/* URL rows */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {urls.map((url, i) => (
                            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span
                                    style={{
                                        fontSize: '0.75rem',
                                        color: 'var(--text-muted)',
                                        minWidth: 20,
                                        textAlign: 'right',
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {i + 1}
                                </span>
                                <input
                                    className="input-field"
                                    type="url"
                                    placeholder="https://example.com/jobs/..."
                                    value={url}
                                    onChange={(e) => updateUrl(i, e.target.value)}
                                    style={{ flex: 1, padding: '10px 14px', fontSize: '0.88rem' }}
                                    id={`url-input-${i}`}
                                />
                                {urls.length > 1 && (
                                    <button
                                        onClick={() => removeUrl(i)}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: 'var(--text-muted)',
                                            cursor: 'pointer',
                                            padding: 6,
                                            borderRadius: 8,
                                            display: 'flex',
                                            transition: 'color 0.2s',
                                        }}
                                        onMouseEnter={(e) => {
                                            (e.target as HTMLButtonElement).style.color = 'var(--accent-red)';
                                        }}
                                        onMouseLeave={(e) => {
                                            (e.target as HTMLButtonElement).style.color = 'var(--text-muted)';
                                        }}
                                        aria-label="Remove URL"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Add / Run buttons */}
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: 18,
                            paddingTop: 16,
                            borderTop: '1px solid var(--border-subtle)',
                        }}
                    >
                        <button
                            onClick={addUrl}
                            disabled={urls.length >= 10}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                background: 'none',
                                border: '1px dashed var(--border-subtle)',
                                borderRadius: 10,
                                color: 'var(--text-secondary)',
                                cursor: urls.length >= 10 ? 'not-allowed' : 'pointer',
                                padding: '8px 16px',
                                fontSize: '0.84rem',
                                opacity: urls.length >= 10 ? 0.4 : 1,
                                transition: 'all 0.2s ease',
                            }}
                            id="add-url-btn"
                        >
                            <Plus size={16} /> Add URL
                        </button>

                        <button
                            className="btn-primary"
                            onClick={runTest}
                            disabled={isLoading || validCount === 0}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '10px 24px',
                            }}
                            id="run-test-btn"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                                    Testing {validCount} URL{validCount > 1 ? 's' : ''}…
                                </>
                            ) : (
                                <>
                                    <Play size={16} />
                                    Run Test ({validCount})
                                </>
                            )}
                        </button>
                    </div>
                </section>

                {/* Error */}
                {error && (
                    <div
                        className="animate-fade-in"
                        style={{
                            marginTop: 20,
                            padding: '14px 18px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: 'var(--radius-md)',
                            color: 'var(--accent-red)',
                            fontSize: '0.88rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                        }}
                    >
                        <XCircle size={18} />
                        {error}
                    </div>
                )}

                {/* Loading shimmer */}
                {isLoading && (
                    <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {Array.from({ length: validCount }).map((_, i) => (
                            <div
                                key={i}
                                className="shimmer-loading"
                                style={{
                                    height: 80,
                                    borderRadius: 'var(--radius-md)',
                                }}
                            />
                        ))}
                    </div>
                )}

                {/* ── Results ─────────────────────────────────────────── */}
                {results && !isLoading && (
                    <div className="animate-fade-in" style={{ marginTop: 28 }}>
                        {/* Summary Cards */}
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(4, 1fr)',
                                gap: 14,
                                marginBottom: 24,
                            }}
                        >
                            <SummaryCard
                                icon={<BarChart3 size={20} />}
                                label="Total Tested"
                                value={results.summary.total}
                                color="var(--accent-blue)"
                            />
                            <SummaryCard
                                icon={<FileJson size={20} />}
                                label="JSON-LD Found"
                                value={`${results.summary.json_ld_count} (${results.summary.json_ld_pct}%)`}
                                color="var(--accent-green)"
                            />
                            <SummaryCard
                                icon={<Zap size={20} />}
                                label="HTTP Sufficient"
                                value={`${results.summary.http_ok_count} (${results.summary.http_ok_pct}%)`}
                                color="var(--accent-cyan)"
                            />
                            <SummaryCard
                                icon={<Clock size={20} />}
                                label="Avg Latency"
                                value={`${results.summary.avg_latency_ms}ms`}
                                color="var(--accent-amber)"
                            />
                        </div>

                        {/* Playwright stat bar */}
                        {results.summary.playwright_count > 0 && (
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '10px 16px',
                                    background: 'rgba(139, 92, 246, 0.08)',
                                    border: '1px solid rgba(139, 92, 246, 0.2)',
                                    borderRadius: 'var(--radius-md)',
                                    marginBottom: 20,
                                    fontSize: '0.84rem',
                                    color: 'var(--accent-purple)',
                                }}
                            >
                                <AlertTriangle size={16} />
                                {results.summary.playwright_count} of {results.summary.total} URLs needed Playwright (
                                {results.summary.playwright_pct}%)
                            </div>
                        )}

                        {/* Result Cards */}
                        <h3
                            style={{
                                fontSize: '0.9rem',
                                fontWeight: 600,
                                color: 'var(--text-secondary)',
                                marginBottom: 12,
                                textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                            }}
                        >
                            Per-URL Results
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {results.results.map((r, i) => (
                                <ResultCard
                                    key={i}
                                    result={r}
                                    index={i}
                                    expanded={expandedCards.has(i)}
                                    onToggle={() => toggleCard(i)}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </main>

            {/* Spin keyframe */}
            <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
        </div>
    );
}

// ── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({
    icon,
    label,
    value,
    color,
}: {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    color: string;
}) {
    return (
        <div
            className="glass-card"
            style={{
                padding: '18px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
            }}
        >
            <div style={{ color, display: 'flex', alignItems: 'center', gap: 8 }}>
                {icon}
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {label}
                </span>
            </div>
            <span style={{ fontSize: '1.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {value}
            </span>
        </div>
    );
}

// ── Result Card ──────────────────────────────────────────────────────────────

function ResultCard({
    result,
    index,
    expanded,
    onToggle,
}: {
    result: CrawlResultData;
    index: number;
    expanded: boolean;
    onToggle: () => void;
}) {
    const hasError = !!result.error;
    const reduction =
        result.raw_html_length > 0
            ? Math.round((1 - result.cleaned_text_length / result.raw_html_length) * 100)
            : 0;

    return (
        <div
            className="glass-card"
            style={{
                overflow: 'hidden',
                borderColor: hasError ? 'rgba(239, 68, 68, 0.3)' : undefined,
            }}
        >
            {/* Header row */}
            <div
                onClick={onToggle}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 20px',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                    <span
                        style={{
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            color: 'var(--text-muted)',
                            background: 'var(--bg-secondary)',
                            padding: '3px 8px',
                            borderRadius: 6,
                        }}
                    >
                        #{index + 1}
                    </span>
                    <span
                        style={{
                            fontSize: '0.88rem',
                            color: 'var(--text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {result.url}
                    </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 12 }}>
                    <StatusBadge ok={result.http_success} label="HTTP" />
                    <StatusBadge ok={!result.needs_playwright} label="No PW" neutral={!result.needs_playwright && result.http_success} />
                    <StatusBadge ok={result.has_json_ld} label="JSON-LD" />
                    <span
                        style={{
                            fontSize: '0.78rem',
                            color: 'var(--text-muted)',
                            fontVariantNumeric: 'tabular-nums',
                            minWidth: 50,
                            textAlign: 'right',
                        }}
                    >
                        {result.latency_ms}ms
                    </span>
                    {expanded ? <ChevronUp size={16} color="var(--text-muted)" /> : <ChevronDown size={16} color="var(--text-muted)" />}
                </div>
            </div>

            {/* Expanded details */}
            {expanded && (
                <div
                    style={{
                        borderTop: '1px solid var(--border-subtle)',
                        padding: '16px 20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 14,
                    }}
                >
                    {/* Error */}
                    {hasError && (
                        <div
                            style={{
                                padding: '10px 14px',
                                background: 'rgba(239, 68, 68, 0.08)',
                                borderRadius: 8,
                                fontSize: '0.82rem',
                                color: 'var(--accent-red)',
                                display: 'flex',
                                gap: 8,
                                alignItems: 'flex-start',
                            }}
                        >
                            <XCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                            {result.error}
                        </div>
                    )}

                    {/* Stats row */}
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                        <Stat label="Raw HTML" value={`${result.raw_html_length.toLocaleString()} chars`} />
                        <Stat label="Cleaned" value={`${result.cleaned_text_length.toLocaleString()} chars`} />
                        <Stat label="Reduction" value={`${reduction}%`} highlight={reduction > 50} />
                        <Stat label="Latency" value={`${result.latency_ms}ms`} />
                    </div>

                    {/* JSON-LD data */}
                    {result.has_json_ld && result.json_ld_data && (
                        <div>
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    marginBottom: 8,
                                    fontSize: '0.8rem',
                                    fontWeight: 600,
                                    color: 'var(--accent-green)',
                                }}
                            >
                                <Code2 size={14} />
                                JSON-LD JobPosting Data
                            </div>
                            <pre
                                style={{
                                    background: 'var(--bg-secondary)',
                                    borderRadius: 10,
                                    padding: '14px 16px',
                                    fontSize: '0.78rem',
                                    color: 'var(--text-secondary)',
                                    overflowX: 'auto',
                                    margin: 0,
                                    lineHeight: 1.5,
                                    border: '1px solid var(--border-subtle)',
                                }}
                            >
                                {JSON.stringify(result.json_ld_data, null, 2)}
                            </pre>
                        </div>
                    )}

                    {/* Cleaned text preview */}
                    {result.cleaned_text && !result.has_json_ld && (
                        <div>
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    marginBottom: 8,
                                    fontSize: '0.8rem',
                                    fontWeight: 600,
                                    color: 'var(--accent-amber)',
                                }}
                            >
                                <Code2 size={14} />
                                Cleaned Text Preview (no JSON-LD found)
                            </div>
                            <pre
                                style={{
                                    background: 'var(--bg-secondary)',
                                    borderRadius: 10,
                                    padding: '14px 16px',
                                    fontSize: '0.78rem',
                                    color: 'var(--text-muted)',
                                    overflowX: 'auto',
                                    maxHeight: 200,
                                    overflowY: 'auto',
                                    margin: 0,
                                    lineHeight: 1.5,
                                    border: '1px solid var(--border-subtle)',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                }}
                            >
                                {result.cleaned_text.slice(0, 2000)}
                                {result.cleaned_text.length > 2000 && '\n\n… truncated'}
                            </pre>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ ok, label, neutral }: { ok: boolean; label: string; neutral?: boolean }) {
    const color = ok
        ? 'var(--accent-green)'
        : 'var(--accent-red)';
    const bg = ok
        ? 'rgba(16, 185, 129, 0.12)'
        : 'rgba(239, 68, 68, 0.12)';

    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '0.72rem',
                fontWeight: 600,
                color: neutral ? 'var(--text-muted)' : color,
                background: neutral ? 'var(--bg-secondary)' : bg,
                padding: '3px 9px',
                borderRadius: 6,
                whiteSpace: 'nowrap',
            }}
        >
            {ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {label}
        </span>
    );
}

// ── Stat ──────────────────────────────────────────────────────────────────────

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
                {label}
            </div>
            <div
                style={{
                    fontSize: '0.88rem',
                    fontWeight: 600,
                    color: highlight ? 'var(--accent-green)' : 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                }}
            >
                {value}
            </div>
        </div>
    );
}
