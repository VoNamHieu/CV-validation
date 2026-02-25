'use client';

import { useState } from 'react';
import {
    Search,
    MapPin,
    Loader2,
    Briefcase,
    Building2,
    DollarSign,
    Clock,
    ExternalLink,
    ArrowLeft,
    Sparkles,
    XCircle,
    ChevronDown,
    ChevronUp,
    AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';

// ── Types ────────────────────────────────────────────────────────────────────

interface TopCVJob {
    title: string;
    company: string;
    salary: string;
    location: string;
    experience: string;
    url: string;
    date_posted: string;
}

interface SearchResponse {
    keyword: string;
    location: string;
    total_jobs: number;
    pages_crawled: number;
    jobs: TopCVJob[];
    latency_ms: number;
    error: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TopCVPage() {
    const [keyword, setKeyword] = useState('');
    const [location, setLocation] = useState('');
    const [maxPages, setMaxPages] = useState(1);
    const [results, setResults] = useState<SearchResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSearch = async () => {
        if (!keyword.trim()) {
            setError('Nhập từ khoá tìm kiếm.');
            return;
        }

        setIsLoading(true);
        setError('');
        setResults(null);

        try {
            const res = await fetch('http://localhost:8000/topcv/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    keyword: keyword.trim(),
                    location: location.trim(),
                    max_pages: maxPages,
                }),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.detail || `Server error: ${res.status}`);
            }

            const data: SearchResponse = await res.json();
            if (data.error) {
                setError(data.error);
            }
            setResults(data);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Không kết nối được backend';
            setError(message);
        } finally {
            setIsLoading(false);
        }
    };

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
                                background: 'linear-gradient(135deg, #10b981, #06b6d4)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <Briefcase size={20} style={{ color: 'white' }} />
                        </div>
                        <div>
                            <span style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>
                                TopCV Search
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
                                Playwright Crawler
                            </span>
                        </div>
                    </div>
                </div>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: '0.75rem',
                        color: 'var(--accent-purple)',
                        background: 'rgba(139, 92, 246, 0.1)',
                        padding: '5px 12px',
                        borderRadius: 8,
                        border: '1px solid rgba(139, 92, 246, 0.2)',
                    }}
                >
                    <AlertTriangle size={12} />
                    Local mode only — backend required at :8000
                </div>
            </header>

            <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px 80px' }}>
                {/* Search Section */}
                <section className="glass-card animate-fade-in" style={{ padding: '28px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                        <Sparkles size={18} style={{ color: 'var(--accent-green)' }} />
                        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Tìm việc trên TopCV</h2>
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 22 }}>
                        Nhập từ khoá và vị trí — Playwright sẽ mở TopCV, bypass anti-bot, và extract danh sách jobs tự động.
                    </p>

                    {/* Search inputs */}
                    <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                        <div style={{ flex: 2, position: 'relative' }}>
                            <Search
                                size={16}
                                style={{
                                    position: 'absolute',
                                    left: 14,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: 'var(--text-muted)',
                                }}
                            />
                            <input
                                className="input-field"
                                type="text"
                                placeholder="Product Manager, Frontend Developer..."
                                value={keyword}
                                onChange={(e) => setKeyword(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                style={{ paddingLeft: 40 }}
                                id="keyword-input"
                            />
                        </div>
                        <div style={{ flex: 1, position: 'relative' }}>
                            <MapPin
                                size={16}
                                style={{
                                    position: 'absolute',
                                    left: 14,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    color: 'var(--text-muted)',
                                }}
                            />
                            <input
                                className="input-field"
                                type="text"
                                placeholder="Hà Nội, HCM..."
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                style={{ paddingLeft: 40 }}
                                id="location-input"
                            />
                        </div>
                    </div>

                    {/* Pages selector + Search button */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Số trang:</span>
                            <div style={{ display: 'flex', gap: 4 }}>
                                {[1, 2, 3, 5].map((n) => (
                                    <button
                                        key={n}
                                        onClick={() => setMaxPages(n)}
                                        style={{
                                            width: 36,
                                            height: 32,
                                            borderRadius: 8,
                                            border: 'none',
                                            fontSize: '0.82rem',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease',
                                            background: maxPages === n ? 'var(--accent-green)' : 'var(--bg-secondary)',
                                            color: maxPages === n ? 'white' : 'var(--text-muted)',
                                            boxShadow: maxPages === n ? '0 2px 8px rgba(16, 185, 129, 0.3)' : 'none',
                                        }}
                                    >
                                        {n}
                                    </button>
                                ))}
                            </div>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                (~{maxPages * 50} jobs max)
                            </span>
                        </div>

                        <button
                            className="btn-primary"
                            onClick={handleSearch}
                            disabled={isLoading || !keyword.trim()}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '10px 24px',
                                background: isLoading ? 'var(--bg-card)' : undefined,
                            }}
                            id="search-btn"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                                    Đang crawl...
                                </>
                            ) : (
                                <>
                                    <Search size={16} />
                                    Tìm kiếm
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
                            marginTop: 16,
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
                    <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div
                                key={i}
                                className="shimmer-loading"
                                style={{ height: 90, borderRadius: 'var(--radius-md)' }}
                            />
                        ))}
                    </div>
                )}

                {/* Results */}
                {results && !isLoading && (
                    <div className="animate-fade-in" style={{ marginTop: 20 }}>
                        {/* Stats bar */}
                        <div
                            className="glass-card"
                            style={{
                                padding: '14px 20px',
                                marginBottom: 16,
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                            }}
                        >
                            <div style={{ display: 'flex', gap: 24 }}>
                                <MiniStat label="Tổng jobs" value={results.total_jobs || results.jobs.length} />
                                <MiniStat label="Jobs tìm được" value={results.jobs.length} highlight />
                                <MiniStat label="Trang crawled" value={results.pages_crawled} />
                            </div>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                                {(results.latency_ms / 1000).toFixed(1)}s
                            </span>
                        </div>

                        {/* Job cards */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {results.jobs.map((job, i) => (
                                <JobCard key={i} job={job} index={i} />
                            ))}
                        </div>

                        {results.jobs.length === 0 && !results.error && (
                            <div
                                style={{
                                    textAlign: 'center',
                                    padding: '40px 20px',
                                    color: 'var(--text-muted)',
                                    fontSize: '0.9rem',
                                }}
                            >
                                Không tìm thấy job nào. Thử từ khoá khác?
                            </div>
                        )}
                    </div>
                )}
            </main>

            <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
        </div>
    );
}

// ── Mini Stat ────────────────────────────────────────────────────────────────

function MiniStat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
    return (
        <div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {label}
            </div>
            <div
                style={{
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    color: highlight ? 'var(--accent-green)' : 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                }}
            >
                {value}
            </div>
        </div>
    );
}

// ── Job Card ─────────────────────────────────────────────────────────────────

function JobCard({ job, index }: { job: TopCVJob; index: number }) {
    return (
        <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card glass-card-hover"
            style={{
                padding: '18px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 16,
                textDecoration: 'none',
                color: 'inherit',
                cursor: 'pointer',
            }}
        >
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span
                        style={{
                            fontSize: '0.68rem',
                            fontWeight: 600,
                            color: 'var(--text-muted)',
                            background: 'var(--bg-secondary)',
                            padding: '2px 7px',
                            borderRadius: 5,
                        }}
                    >
                        #{index + 1}
                    </span>
                    <h3
                        style={{
                            fontSize: '0.95rem',
                            fontWeight: 600,
                            margin: 0,
                            color: 'var(--text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {job.title}
                    </h3>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 4 }}>
                    {job.company && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            <Building2 size={13} /> {job.company}
                        </span>
                    )}
                    {job.salary && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem', color: 'var(--accent-green)' }}>
                            <DollarSign size={13} /> {job.salary}
                        </span>
                    )}
                    {job.location && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            <MapPin size={13} /> {job.location}
                        </span>
                    )}
                    {job.experience && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            <Clock size={13} /> {job.experience}
                        </span>
                    )}
                </div>
            </div>

            <ExternalLink size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 4 }} />
        </a>
    );
}
