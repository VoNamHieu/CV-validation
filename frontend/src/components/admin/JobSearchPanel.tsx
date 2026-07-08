'use client';

// Admin job-store search — operator view over ALL stored jobs (dead rows
// included), with keyword ILIKE or semantic (embedding) mode, facet filters,
// pagination, and an expandable row for the full JD + must-have skills.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    MagnifyingGlass, ArrowsClockwise, CaretLeft, CaretRight, CaretDown,
    Briefcase, MapPin, ArrowSquareOut, SpinnerGap, Brain, TextAa,
    DownloadSimple, CheckCircle, WarningCircle, Megaphone,
} from '@phosphor-icons/react';
import { admin, type AdminJob, type FacetValue, type IngestState } from '@/lib/db';

const PAGE_SIZE = 25;

// Label + colour for a job's promoted-page status, shown on the search row.
const PROMOTED_STATUS_META: Record<string, { label: string; color: string }> = {
    published: { label: '✓ Đã công bố', color: 'var(--accent-green, #22c55e)' },
    draft: { label: '✓ Đã tạo nháp', color: 'var(--accent-amber, #f59e0b)' },
    unpublished: { label: '✓ Đã gỡ', color: 'var(--text-muted)' },
};

type Facets = { role_family: FacetValue[]; industry: FacetValue[]; seniority: FacetValue[] };
type Status = 'all' | 'active' | 'dead';
type Mode = 'keyword' | 'semantic';

function ago(iso: string | null): string {
    if (!iso) return '-';
    const t = new Date(iso).getTime();
    if (!t) return '-';
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 3600) return `${Math.floor(s / 60)}m trước`;
    if (s < 86400) return `${Math.floor(s / 3600)}h trước`;
    return `${Math.floor(s / 86400)}d trước`;
}

function FacetSelect({ label, value, options, onChange }: {
    label: string;
    value: string;
    options: FacetValue[];
    onChange: (v: string) => void;
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{
                padding: '8px 10px', borderRadius: 10, fontSize: '0.8rem',
                border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
                color: value ? 'var(--text-primary)' : 'var(--text-muted)',
                maxWidth: 190, cursor: 'pointer',
            }}
        >
            <option value="">{label} (tất cả)</option>
            {options.map((o) => (
                <option key={o.value} value={o.value}>{o.value} ({o.count})</option>
            ))}
        </select>
    );
}

export default function JobSearchPanel() {
    const [q, setQ] = useState('');
    const [mode, setMode] = useState<Mode>('keyword');
    const [roleFamily, setRoleFamily] = useState('');
    const [industry, setIndustry] = useState('');
    const [seniority, setSeniority] = useState('');
    const [status, setStatus] = useState<Status>('active');
    const [offset, setOffset] = useState(0);

    const [facets, setFacets] = useState<Facets | null>(null);
    const [results, setResults] = useState<AdminJob[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [expanded, setExpanded] = useState<string | null>(null);

    // Promoted landing pages: created as DRAFTS here, then reviewed/published in
    // the "Trang truyền thông" tab. Track jobId → {slug, id, jdChars} for the
    // preview link + status hint.
    const [promoted, setPromoted] = useState<Record<string, { slug: string; id: string; jdChars: number }>>({});
    const [promoting, setPromoting] = useState<string | null>(null);

    const promote = useCallback(async (jobId: string) => {
        setPromoting(jobId);
        try {
            const r = await admin.promoteJob(jobId);
            setPromoted((m) => ({ ...m, [jobId]: { slug: r.slug, id: r.id, jdChars: r.jd_chars } }));
        } catch {
            setError('Không tạo được trang truyền thông.');
        } finally {
            setPromoting(null);
        }
    }, []);

    // Whether a job already has a promoted page — from THIS session's creation OR
    // an existing one the search joined in (promoted_slug). Session state wins so
    // a just-created draft shows immediately with its jdChars.
    const promotedInfo = useCallback((j: AdminJob): {
        slug: string; id: string; status: string; jdChars: number | null;
    } | null => {
        const sess = promoted[j.id];
        if (sess) return { slug: sess.slug, id: sess.id, status: 'draft', jdChars: sess.jdChars };
        if (j.promoted_slug) return {
            slug: j.promoted_slug, id: j.promoted_id ?? '',
            status: j.promoted_status ?? 'draft', jdChars: null,
        };
        return null;
    }, [promoted]);
    // Drops out-of-order responses (fast page-2 answer landing after page 3's).
    const seq = useRef(0);

    // ── Crawl trigger state — POST kicks a backend background task (ATS ingest
    // + embedding backfill), then we poll status until it finishes and re-run
    // the current search so fresh rows appear.
    const [ingest, setIngest] = useState<IngestState | null>(null);
    const [ingestBusy, setIngestBusy] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const searchRef = useRef<(o: number) => void>(() => {});

    const stopPoll = useCallback(() => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }, []);

    const startPoll = useCallback(() => {
        stopPoll();
        pollRef.current = setInterval(async () => {
            try {
                const s = await admin.ingestStatus();
                setIngest(s);
                if (!s.running) {
                    stopPoll();
                    // Crawl finished — refresh the result list in place.
                    if (s.last?.phase === 'done') searchRef.current(0);
                }
            } catch { /* transient poll failure — keep polling */ }
        }, 4000);
    }, [stopPoll]);

    const triggerCrawl = useCallback(async () => {
        setIngestBusy(true);
        try {
            const r = await admin.triggerIngest();
            setIngest({ running: r.running, last: r.last });
            if (r.running) startPoll();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Không kích hoạt được crawl');
        } finally {
            setIngestBusy(false);
        }
    }, [startPoll]);

    useEffect(() => {
        admin.jobFacets().then(setFacets).catch(() => setFacets(null));
        // A crawl may already be running (kicked from another tab/session).
        admin.ingestStatus().then((s) => {
            setIngest(s);
            if (s.running) startPoll();
        }).catch(() => {});
        return stopPoll;
    }, [startPoll, stopPoll]);

    const search = useCallback(async (newOffset: number) => {
        const my = ++seq.current;
        setLoading(true); setError('');
        try {
            const r = await admin.searchJobs({
                q: q.trim() || undefined,
                mode,
                roleFamily: roleFamily || undefined,
                industry: industry || undefined,
                seniority: seniority || undefined,
                status,
                limit: PAGE_SIZE,
                offset: newOffset,
            });
            if (my !== seq.current) return;
            setResults(r.results);
            setTotal(r.total);
            setOffset(newOffset);
            setExpanded(null);
        } catch (e) {
            if (my !== seq.current) return;
            setError(e instanceof Error ? e.message : 'Tìm kiếm thất bại');
        } finally {
            if (my === seq.current) setLoading(false);
        }
    }, [q, mode, roleFamily, industry, seniority, status]);
    searchRef.current = search;

    // Initial load + auto re-search when a filter changes (not on keystrokes —
    // the keyword only fires on Enter / button so we don't spam the backend,
    // and semantic mode embeds per call).
    useEffect(() => {
        search(0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, roleFamily, industry, seniority, status]);

    const page = Math.floor(offset / PAGE_SIZE) + 1;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const chip = (text: string, color: string, bg: string): React.ReactNode => (
        <span style={{
            fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 10,
            background: bg, color, whiteSpace: 'nowrap',
        }}>{text}</span>
    );

    const running = ingest?.running ?? false;
    const last = ingest?.last;

    return (
        <div>
            {/* ── Crawl trigger bar ── */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                padding: '10px 14px', marginBottom: 14, borderRadius: 10,
                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
            }}>
                <button
                    className="btn-secondary"
                    onClick={triggerCrawl}
                    disabled={running || ingestBusy}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem',
                        padding: '7px 14px', opacity: running || ingestBusy ? 0.6 : 1,
                    }}
                >
                    {running || ingestBusy
                        ? <SpinnerGap size={14} style={{ animation: 'spin 0.8s linear infinite' }} />
                        : <DownloadSimple size={14} weight="bold" />}
                    {running ? 'Đang quét…' : 'Quét job mới'}
                </button>
                <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', flex: 1, minWidth: 200 }}>
                    {running && (
                        last?.phase === 'embedding'
                            ? 'Đang tạo embedding cho job mới…'
                            : 'Đang quét ATS feed của các công ty featured, job mới sẽ được ghi vào store…'
                    )}
                    {!running && last?.phase === 'done' && last.stats && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <CheckCircle size={13} weight="fill" style={{ color: 'var(--accent-green, #22c55e)' }} />
                            Lần quét gần nhất ({ago(new Date(last.at * 1000).toISOString())},
                            {' '}{Math.round(last.duration_s ?? 0)}s):
                            {' '}<strong>{last.stats.jobs_upserted}</strong> job từ{' '}
                            <strong>{last.stats.companies_with_feed}</strong> công ty,
                            {' '}{last.stats.jobs_deactivated} đã đóng
                            {last.stats.jobs_embedded != null && <>, {last.stats.jobs_embedded} embedding mới</>}
                        </span>
                    )}
                    {!running && last?.phase === 'error' && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--accent-red, #ef4444)' }}>
                            <WarningCircle size={13} weight="fill" /> Quét lỗi: {last.error}
                        </span>
                    )}
                    {!running && !last && 'Quét ATS feed của các công ty featured để cập nhật job store, kèm tạo embedding cho semantic search.'}
                </span>
            </div>

            {/* ── Search bar ── */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 240 }}>
                    <MagnifyingGlass size={15} style={{
                        position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                        color: 'var(--text-muted)',
                    }} />
                    <input
                        type="text"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') search(0); }}
                        placeholder={mode === 'semantic'
                            ? 'Mô tả công việc cần tìm (semantic, bắt buộc có từ khoá)…'
                            : 'Từ khoá: chức danh, công ty, địa điểm, nội dung JD…'}
                        style={{
                            width: '100%', padding: '9px 12px 9px 34px', borderRadius: 10,
                            border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
                            color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none',
                        }}
                    />
                </div>
                {/* Mode toggle */}
                <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
                    {([
                        { id: 'keyword' as Mode, label: 'Từ khoá', Icon: TextAa },
                        { id: 'semantic' as Mode, label: 'Semantic', Icon: Brain },
                    ]).map(({ id, label, Icon }) => (
                        <button key={id} type="button" onClick={() => setMode(id)} style={{
                            display: 'flex', alignItems: 'center', gap: 5, padding: '0 12px',
                            fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', border: 'none',
                            background: mode === id ? 'var(--accent-purple, #8b5cf6)' : 'var(--bg-card)',
                            color: mode === id ? '#fff' : 'var(--text-secondary)',
                        }}>
                            <Icon size={14} weight={mode === id ? 'fill' : 'regular'} /> {label}
                        </button>
                    ))}
                </div>
                <button className="btn-primary" onClick={() => search(0)} disabled={loading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 18px', fontSize: '0.84rem' }}>
                    {loading
                        ? <SpinnerGap size={15} style={{ animation: 'spin 0.8s linear infinite' }} />
                        : <MagnifyingGlass size={15} weight="bold" />}
                    Tìm
                </button>
            </div>

            {/* ── Filters ── */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <FacetSelect label="Role family" value={roleFamily} options={facets?.role_family ?? []} onChange={setRoleFamily} />
                <FacetSelect label="Ngành" value={industry} options={facets?.industry ?? []} onChange={setIndustry} />
                <FacetSelect label="Cấp bậc" value={seniority} options={facets?.seniority ?? []} onChange={setSeniority} />
                <select value={status} onChange={(e) => setStatus(e.target.value as Status)} style={{
                    padding: '8px 10px', borderRadius: 10, fontSize: '0.8rem',
                    border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
                    color: 'var(--text-primary)', cursor: 'pointer',
                }}>
                    <option value="active">Đang tuyển</option>
                    <option value="dead">Đã đóng</option>
                    <option value="all">Tất cả</option>
                </select>
                {(roleFamily || industry || seniority || q) && (
                    <button type="button" onClick={() => { setQ(''); setRoleFamily(''); setIndustry(''); setSeniority(''); }}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--text-muted)', fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                        <ArrowsClockwise size={12} /> Xoá bộ lọc
                    </button>
                )}
            </div>

            {error && <div style={{ color: 'var(--accent-red, #ef4444)', fontSize: '0.82rem', marginBottom: 12 }}>{error}</div>}

            {/* ── Result count + pagination ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {loading ? 'Đang tìm…' : `${total.toLocaleString()} job khớp`}
                </span>
                {pages > 1 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        <button type="button" onClick={() => search(offset - PAGE_SIZE)} disabled={loading || offset === 0}
                            style={{
                                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8,
                                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: offset === 0 ? 'default' : 'pointer', opacity: offset === 0 ? 0.4 : 1,
                                color: 'var(--text-primary)',
                            }}>
                            <CaretLeft size={13} weight="bold" />
                        </button>
                        <span style={{ fontWeight: 600 }}>{page} / {pages}</span>
                        <button type="button" onClick={() => search(offset + PAGE_SIZE)} disabled={loading || page >= pages}
                            style={{
                                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8,
                                width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: page >= pages ? 'default' : 'pointer', opacity: page >= pages ? 0.4 : 1,
                                color: 'var(--text-primary)',
                            }}>
                            <CaretRight size={13} weight="bold" />
                        </button>
                    </span>
                )}
            </div>

            {/* ── Results ── */}
            {!loading && results.length === 0 && !error && (
                <div style={{
                    padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)',
                    border: '1px dashed var(--border-subtle)', borderRadius: 12, fontSize: '0.85rem',
                }}>
                    <Briefcase size={28} weight="duotone" style={{ marginBottom: 8, opacity: 0.6 }} />
                    <div>Không tìm thấy job nào khớp.</div>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {results.map((j) => {
                    const open = expanded === j.id;
                    const p = promotedInfo(j);
                    const pMeta = p ? (PROMOTED_STATUS_META[p.status] ?? PROMOTED_STATUS_META.draft) : null;
                    return (
                        <div key={j.id} className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                            <button
                                type="button"
                                onClick={() => setExpanded(open ? null : j.id)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                                    padding: '12px 16px', background: 'none', border: 'none',
                                    cursor: 'pointer', textAlign: 'left',
                                }}
                            >
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3,
                                    }}>
                                        {j.title}
                                    </div>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.74rem',
                                        color: 'var(--text-muted)', flexWrap: 'wrap',
                                    }}>
                                        {j.company_name && (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                                <Briefcase size={11} /> {j.company_name}
                                            </span>
                                        )}
                                        {j.location && (
                                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                                <MapPin size={11} /> {j.location}
                                            </span>
                                        )}
                                        {/* created_at = first time we saw the posting (≈ posting age);
                                            last_seen_at is bumped every cron for every live job, so it
                                            would show "just now" for everything — not what we want here. */}
                                        <span title={`còn sống, cron kiểm tra lần cuối ${ago(j.last_seen_at)}`}>
                                            đăng {ago(j.created_at)}
                                        </span>
                                        {typeof j.distance === 'number' && (
                                            <span title="Cosine distance, càng thấp càng khớp">
                                                Δ {j.distance.toFixed(3)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                    {j.role_family && chip(j.role_family, 'var(--accent-blue, #3b82f6)', 'rgba(59,130,246,0.1)')}
                                    {j.seniority && chip(j.seniority, 'var(--accent-purple, #8b5cf6)', 'rgba(139,92,246,0.1)')}
                                    {j.is_active
                                        ? chip('Đang tuyển', 'var(--accent-green, #22c55e)', 'rgba(34,197,94,0.1)')
                                        : chip(j.dead_reason ? `Đã đóng · ${j.dead_reason}` : 'Đã đóng', 'var(--accent-red, #ef4444)', 'rgba(239,68,68,0.1)')}
                                    <CaretDown size={13} style={{
                                        color: 'var(--text-muted)',
                                        transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s',
                                    }} />
                                </div>
                            </button>

                            {open && (
                                <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border-subtle)' }}>
                                    <div style={{
                                        display: 'flex', gap: 16, flexWrap: 'wrap', margin: '10px 0',
                                        fontSize: '0.74rem', color: 'var(--text-secondary)',
                                    }}>
                                        {j.industry && <span>Ngành: <strong>{j.industry}</strong></span>}
                                        {j.hotness != null && <span>Hotness: <strong>{j.hotness}</strong></span>}
                                        <span>Embedding: <strong>{j.indexed_at ? 'có' : 'chưa'}</strong></span>
                                        <span>ID: <code style={{ fontSize: '0.7rem' }}>{j.id}</code></span>
                                    </div>
                                    {(j.must_have?.length ?? 0) > 0 && (
                                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
                                            {j.must_have!.map((s, i) => (
                                                <span key={i} style={{
                                                    fontSize: '0.7rem', padding: '2px 8px', borderRadius: 8,
                                                    background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                                                    border: '1px solid var(--border-subtle)',
                                                }}>{s}</span>
                                            ))}
                                        </div>
                                    )}
                                    {j.description && (
                                        <p style={{
                                            fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.55,
                                            margin: '0 0 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                            maxHeight: 260, overflowY: 'auto',
                                        }}>
                                            {j.description}
                                        </p>
                                    )}
                                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                                        <button
                                            type="button"
                                            onClick={() => promote(j.id)}
                                            disabled={promoting === j.id}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem',
                                                fontWeight: 700, color: '#fff', cursor: 'pointer',
                                                background: 'var(--gradient-hero, linear-gradient(135deg,#4f46e5,#7c3aed))',
                                                border: 'none', borderRadius: 8, padding: '7px 14px',
                                                opacity: promoting === j.id ? 0.6 : 1,
                                            }}
                                        >
                                            {promoting === j.id
                                                ? <SpinnerGap size={14} style={{ animation: 'spin 0.8s linear infinite' }} />
                                                : <Megaphone size={14} weight="fill" />}
                                            {p ? 'Tạo lại trang truyền thông' : 'Tạo trang truyền thông'}
                                        </button>
                                        {j.source_url && (
                                            <a href={j.source_url} target="_blank" rel="noreferrer" style={{
                                                display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem',
                                                color: 'var(--accent-blue, #3b82f6)', textDecoration: 'none', fontWeight: 600,
                                            }}>
                                                <ArrowSquareOut size={13} /> Tin gốc
                                            </a>
                                        )}
                                        {j.career_url && (
                                            <a href={j.career_url} target="_blank" rel="noreferrer" style={{
                                                display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem',
                                                color: 'var(--text-secondary)', textDecoration: 'none',
                                            }}>
                                                <ArrowSquareOut size={13} /> Trang tuyển dụng công ty
                                            </a>
                                        )}
                                    </div>

                                    {p && pMeta && (
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap',
                                            padding: '8px 10px', borderRadius: 8, background: 'var(--bg-elevated)',
                                            border: '1px solid var(--border-subtle)', fontSize: '0.74rem',
                                        }}>
                                            <span style={{ color: pMeta.color, fontWeight: 700 }}>{pMeta.label}</span>
                                            {p.jdChars != null && (
                                                <span style={{ color: 'var(--text-muted)' }}>
                                                    JD {p.jdChars.toLocaleString()} ký tự
                                                </span>
                                            )}
                                            <a href={p.status === 'published' ? `/j/${p.slug}` : `/j/${p.slug}?preview=${p.id}`}
                                                target="_blank" rel="noreferrer" style={{
                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                    color: 'var(--accent-blue)', textDecoration: 'none', fontWeight: 600,
                                                }}>
                                                <ArrowSquareOut size={13} /> {p.status === 'published' ? 'Xem trang' : 'Xem thử'}
                                            </a>
                                            <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
                                                Vào tab <b>Trang truyền thông</b> để công bố / xóa
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
