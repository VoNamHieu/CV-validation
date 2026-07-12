'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { getAuthHeaders } from '@/lib/auth-headers';

type CompatRecord = {
    url: string;
    host: string;
    company: string;
    source: string;
    verdict:
        | 'supported'
        | 'supported_render'
        | 'needs_new_adapter'
        | 'needs_capture'
        | 'needs_login'
        | 'no_vn_jobs'
        | 'unsupported';
    usable: boolean;
    strategy: string;
    ats: string;
    job_count: number;
    samples: string[];
    blockers: string[];
    http_code: number;
    detail: string;
    first_seen: number;
    last_checked: number;
    hits: number;
    // Regression guard (backend career_compat): a company whose job count
    // collapsed to <40% of its high-water baseline — an adapter breaking to a
    // partial count the plain verdict still calls "supported".
    regressed?: boolean;
    prev_job_count?: number;
    baseline_job_count?: number;
};

function ago(ts: number): string {
    if (!ts) return '-';
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return `${s}s trước`;
    if (s < 3600) return `${Math.floor(s / 60)}m trước`;
    if (s < 86400) return `${Math.floor(s / 3600)}h trước`;
    return `${Math.floor(s / 86400)}d trước`;
}

// `cron` records come from the real ingest run that also built the pool — they
// mirror it exactly. `scan`/`probe`/`recheck` are manual dry-runs that can
// disagree with the pool, so they get their own (dimmer) badge.
const SOURCE_STYLE: Record<string, { label: string; color: string; title: string }> = {
    cron: { label: 'cron', color: 'var(--accent-green)', title: 'Từ lần ingest thật gần nhất — khớp pool' },
    scan: { label: 'scan', color: 'var(--accent-amber)', title: 'Quét dry-run thủ công — có thể không khớp pool thật' },
    probe: { label: 'probe', color: 'var(--accent-amber)', title: 'Probe dry-run thủ công — có thể không khớp pool thật' },
    recheck: { label: 'recheck', color: 'var(--accent-amber)', title: 'Probe lại thủ công — dry-run' },
};

// A usable verdict reached via a fallback rung (render/SPA-sniff or an
// extension capture) rather than a dedicated `ats:<name>` adapter: it works but
// is slow/fragile — a candidate for a real adapter, and worth watching.
const isFallbackStrategy = (s: string): boolean => /spa_sniff|capture/i.test(s || '');

// Blocker code / verdict → câu giải thích RÕ RÀNG vì sao lần gần nhất không lấy
// được job. Đây là điểm chính của bảng: đọc là hiểu, không phải đoán mã lỗi.
const REASON: Record<string, string> = {
    no_extractor: 'Là trang tuyển dụng thật nhưng chưa rung nào đọc được → cần viết adapter riêng',
    anti_bot: 'Bị anti-bot chặn (Cloudflare / PerimeterX…) → phải đi qua extension',
    login: 'Danh sách việc làm nằm sau lớp đăng nhập',
    no_vn: 'Feed chạy được nhưng không có vị trí nào ở Việt Nam',
    unreachable: 'Không truy cập được (fetch lỗi hoặc timeout)',
    soft_404: 'Trang mở được nhưng trống / không còn tồn tại',
    not_careerish: 'Không nhận diện được nội dung tuyển dụng ở trang này',
    url_disallowed: 'URL bị chặn bởi SSRF guard',
    stale_feed: 'Feed cũ — lần cron gần nhất không còn thấy job',
};

function reasonText(l: CompatRecord): string {
    for (const b of l.blockers || []) {
        if (REASON[b]) return REASON[b];
    }
    if (l.verdict === 'needs_new_adapter') return REASON.no_extractor;
    if (l.verdict === 'needs_capture') return REASON.anti_bot;
    if (l.verdict === 'needs_login') return REASON.login;
    if (l.verdict === 'no_vn_jobs') return REASON.no_vn;
    return l.detail || 'Không rõ nguyên nhân';
}

// Kết quả lần chạy gần nhất, gói gọn để render: lấy được (kèm số & cảnh báo
// tụt/dự phòng) hay không lấy được (kèm lý do).
type Outcome = { ok: boolean; count: number; note: string; color: string };
function outcomeOf(l: CompatRecord): Outcome {
    if (l.usable) {
        if (l.regressed) {
            return {
                ok: true, count: l.job_count || 0, color: 'var(--accent-amber)',
                note: `tụt mạnh từ đỉnh ${l.baseline_job_count} — adapter có thể đã gãy một phần`,
            };
        }
        if (isFallbackStrategy(l.strategy)) {
            return {
                ok: true, count: l.job_count || 0, color: 'var(--accent-amber)',
                note: 'qua nhánh dự phòng (render/capture) — chậm & dễ gãy, nên viết adapter riêng',
            };
        }
        return { ok: true, count: l.job_count || 0, color: 'var(--accent-green)', note: '' };
    }
    const color =
        l.verdict === 'needs_capture' || l.verdict === 'needs_login' ? 'var(--accent-purple)'
        : l.verdict === 'no_vn_jobs' ? 'var(--text-muted)'
        : l.verdict === 'needs_new_adapter' ? 'var(--accent-amber)'
        : 'var(--accent-red)';
    return { ok: false, count: 0, color, note: reasonText(l) };
}

// Xếp hạng "cần xử lý trước" — tụt job (đang gãy dần) lên đầu, rồi cần adapter,
// rồi bị chặn, cuối cùng là chạy tốt.
function severity(l: CompatRecord): number {
    if (l.regressed) return 0;
    if (!l.usable) {
        return ({ needs_new_adapter: 1, needs_capture: 2, needs_login: 3, no_vn_jobs: 4, unsupported: 5 } as Record<string, number>)[l.verdict] ?? 5;
    }
    if (isFallbackStrategy(l.strategy)) return 6;
    return 7;
}

// Bộ lọc theo chip tóm tắt.
const FILTERS: Record<string, (l: CompatRecord) => boolean> = {
    got: (l) => l.usable,
    notGot: (l) => !l.usable,
    regressed: (l) => !!l.regressed,
    fallback: (l) => l.usable && !l.regressed && isFallbackStrategy(l.strategy),
    adapter: (l) => l.verdict === 'needs_new_adapter',
    blocked: (l) => l.verdict === 'needs_capture' || l.verdict === 'needs_login',
    novn: (l) => l.verdict === 'no_vn_jobs',
};

export default function CompatPanel() {
    const [rows, setRows] = useState<CompatRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [probing, setProbing] = useState(false);
    const [msg, setMsg] = useState('');
    const [probeUrl, setProbeUrl] = useState('');
    const [companyFilter, setCompanyFilter] = useState('');
    const [busyUrl, setBusyUrl] = useState('');
    const [sortBy, setSortBy] = useState<'severity' | 'jobs' | 'recency'>('severity');
    const [sourceView, setSourceView] = useState<'cron' | 'all'>('cron');
    const [chip, setChip] = useState<keyof typeof FILTERS | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetch('/api/compat/results', { headers: await getAuthHeaders() });
            const d = await r.json();
            setRows(Array.isArray(d.results) ? d.results : []);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : 'Không tải được dữ liệu');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const probeOne = async () => {
        const url = probeUrl.trim();
        if (!url) return;
        setProbing(true);
        setMsg(`Đang kiểm tra ${url} …`);
        try {
            const r = await fetch('/api/compat/probe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
                body: JSON.stringify({ url }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.detail || `Probe lỗi (${r.status})`);
            const rec = d.record as CompatRecord | undefined;
            if (rec) {
                const o = outcomeOf(rec);
                setMsg(o.ok ? `✓ Lấy được ${o.count} job` : `✕ Không lấy được — ${o.note}`);
            }
            setProbeUrl('');
            await load();
        } catch (e) {
            setMsg(e instanceof Error ? e.message : 'Probe lỗi');
        } finally {
            setProbing(false);
        }
    };

    const runScan = async () => {
        setScanning(true);
        setMsg('Đang quét career page của các công ty nổi bật…');
        try {
            const qs = new URLSearchParams({ limit: '200' });
            if (companyFilter.trim()) qs.set('company', companyFilter.trim());
            const r = await fetch(`/api/compat/scan?${qs}`, { method: 'POST', headers: await getAuthHeaders() });
            const d = await r.json();
            if (!r.ok) throw new Error(d.detail || `Quét lỗi (${r.status})`);
            setMsg(
                `Đã quét ${d.scanned}/${d.total_available}` +
                `${d.truncated ? ' (giới hạn)' : ''} → ${d.usable} lấy được`,
            );
            setSourceView('all');   // scan rows are source=scan; surface them
            await load();
        } catch (e) {
            setMsg(e instanceof Error ? e.message : 'Quét lỗi');
        } finally {
            setScanning(false);
        }
    };

    const recheck = async (rec: CompatRecord) => {
        setBusyUrl(rec.url);
        try {
            await fetch('/api/compat/recheck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
                body: JSON.stringify({ url: rec.url, company: rec.company }),
            });
            await load();
        } finally {
            setBusyUrl('');
        }
    };

    const remove = async (rec: CompatRecord) => {
        setBusyUrl(rec.url);
        try {
            await fetch('/api/compat/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
                body: JSON.stringify({ url: rec.url }),
            });
            setRows((prev) => prev.filter((l) => l.url !== rec.url));
        } finally {
            setBusyUrl('');
        }
    };

    const clearAll = async () => {
        if (!confirm('Xoá toàn bộ nhật ký tương thích?')) return;
        await fetch('/api/compat/clear', { method: 'POST', headers: await getAuthHeaders() });
        setRows([]);
        setMsg('Đã xoá nhật ký.');
    };

    // ── Dẫn xuất ──────────────────────────────────────────────────────────────
    // "Lần cron gần nhất" luôn tính trên toàn bộ dòng cron, không phụ thuộc bộ lọc.
    const cronRows = useMemo(() => rows.filter((l) => l.source === 'cron'), [rows]);
    const lastCronAt = useMemo(() => cronRows.reduce((m, l) => Math.max(m, l.last_checked || 0), 0), [cronRows]);
    const cronJobs = useMemo(() => cronRows.reduce((s, l) => s + (l.usable ? (l.job_count || 0) : 0), 0), [cronRows]);
    const cronGot = useMemo(() => cronRows.filter((l) => l.usable).length, [cronRows]);

    // Dòng đang hiển thị: lọc theo nguồn (mặc định chỉ cron thật), rồi theo chip.
    const scoped = useMemo(
        () => (sourceView === 'cron' ? cronRows : rows),
        [sourceView, cronRows, rows],
    );

    const counts = useMemo(() => ({
        all: scoped.length,
        got: scoped.filter(FILTERS.got).length,
        notGot: scoped.filter(FILTERS.notGot).length,
        regressed: scoped.filter(FILTERS.regressed).length,
        fallback: scoped.filter(FILTERS.fallback).length,
        adapter: scoped.filter(FILTERS.adapter).length,
        blocked: scoped.filter(FILTERS.blocked).length,
        novn: scoped.filter(FILTERS.novn).length,
    }), [scoped]);

    const visible = useMemo(() => {
        const base = chip ? scoped.filter(FILTERS[chip]) : scoped;
        return [...base].sort((a, b) => {
            if (sortBy === 'jobs') return (b.job_count || 0) - (a.job_count || 0);
            if (sortBy === 'recency') return (b.last_checked || 0) - (a.last_checked || 0);
            const s = severity(a) - severity(b);
            if (s !== 0) return s;
            return (a.company || a.host).localeCompare(b.company || b.host);
        });
    }, [scoped, chip, sortBy]);

    // ── styles ────────────────────────────────────────────────────────────────
    const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
        padding: '8px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)',
        background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem',
        ...extra,
    });
    const input = (extra: React.CSSProperties = {}): React.CSSProperties => ({
        padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: '0.85rem',
        border: '1px solid var(--border-default)', background: 'var(--bg-secondary)',
        color: 'var(--text-primary)', ...extra,
    });

    const Chip = ({ id, label, count, color }: { id: keyof typeof FILTERS; label: string; count: number; color: string }) => {
        const active = chip === id;
        return (
            <button
                onClick={() => setChip(active ? null : id)}
                disabled={count === 0}
                style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, cursor: count ? 'pointer' : 'default',
                    padding: '4px 10px', borderRadius: 999, fontSize: '0.8rem', fontWeight: 600,
                    border: `1px solid ${active ? color : 'var(--border-subtle)'}`,
                    background: active ? color : 'transparent',
                    color: active ? 'var(--text-inverse)' : color, opacity: count ? 1 : 0.4,
                }}
            >
                <b>{count}</b> {label}
            </button>
        );
    };

    const segBtn = (on: boolean): React.CSSProperties => ({
        padding: '5px 12px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', border: 'none',
        background: on ? 'var(--accent-blue)' : 'transparent', color: on ? '#fff' : 'var(--text-muted)',
    });

    return (
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 24px', color: 'var(--text-primary)' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>🔌 Hiệu năng adapter — lần cron gần nhất</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 18 }}>
                Mỗi công ty, lần chạy gần nhất <b>có lấy được job không</b> — lấy được thì <b>bao nhiêu</b>, không
                thì <b>vì sao</b>. Mặc định chỉ hiện dòng từ <b>cron thật</b> (khớp pool); chuyển sang “Tất cả” để
                xem thêm các lần probe/scan thủ công.
            </p>

            {/* Banner: lần cron gần nhất */}
            <div style={{
                display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16,
                padding: '12px 16px', borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
            }}>
                <span style={{ fontSize: '0.9rem' }}>
                    🕑 Lần cron gần nhất: <b>{lastCronAt ? ago(lastCronAt) : '—'}</b>
                </span>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    <b style={{ color: 'var(--text-primary)' }}>{cronRows.length}</b> công ty
                </span>
                <span style={{ fontSize: '0.9rem', color: 'var(--accent-green)' }}>
                    <b>{cronGot}</b> lấy được · <b>{cronJobs}</b> job về pool
                </span>
                {cronRows.length - cronGot > 0 && (
                    <span style={{ fontSize: '0.9rem', color: 'var(--accent-red)' }}>
                        <b>{cronRows.length - cronGot}</b> không lấy được
                    </span>
                )}
                <div style={{ marginLeft: 'auto', display: 'inline-flex', borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--border-default)' }}>
                    <button style={segBtn(sourceView === 'cron')} onClick={() => setSourceView('cron')}>Cron thật</button>
                    <button style={segBtn(sourceView === 'all')} onClick={() => setSourceView('all')}>Tất cả</button>
                </div>
            </div>

            {/* Chip tóm tắt — bấm để lọc */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                <button
                    onClick={() => setChip(null)}
                    style={{
                        padding: '4px 10px', borderRadius: 999, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                        border: `1px solid ${chip === null ? 'var(--text-primary)' : 'var(--border-subtle)'}`,
                        background: chip === null ? 'var(--text-primary)' : 'transparent',
                        color: chip === null ? 'var(--bg-primary)' : 'var(--text-primary)',
                    }}
                >
                    <b>{counts.all}</b> tất cả
                </button>
                <Chip id="got" label="lấy được" count={counts.got} color="var(--accent-green)" />
                <Chip id="notGot" label="không lấy được" count={counts.notGot} color="var(--accent-red)" />
                <span style={{ width: 1, height: 18, background: 'var(--border-default)', margin: '0 2px' }} />
                <Chip id="regressed" label="tụt job" count={counts.regressed} color="var(--accent-red)" />
                <Chip id="adapter" label="cần adapter" count={counts.adapter} color="var(--accent-amber)" />
                <Chip id="blocked" label="bị chặn" count={counts.blocked} color="var(--accent-purple)" />
                <Chip id="fallback" label="nhánh dự phòng" count={counts.fallback} color="var(--accent-amber)" />
                <Chip id="novn" label="không job VN" count={counts.novn} color="var(--text-muted)" />
                <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'severity' | 'jobs' | 'recency')}
                    title="Sắp xếp bảng"
                    style={input({ cursor: 'pointer', marginLeft: 'auto' })}
                >
                    <option value="severity">Sắp xếp: Cần xử lý trước</option>
                    <option value="jobs">Sắp xếp: Job nhiều nhất</option>
                    <option value="recency">Sắp xếp: Mới chạy nhất</option>
                </select>
            </div>

            {/* Công cụ probe/scan thủ công */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
                <input
                    value={probeUrl}
                    onChange={(e) => setProbeUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') probeOne(); }}
                    placeholder="Dán URL career page để kiểm tra thử…"
                    style={input({ flex: 1, minWidth: 260 })}
                />
                <button onClick={probeOne} disabled={probing || !probeUrl.trim()} style={btn({
                    background: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', color: '#fff',
                    opacity: probing || !probeUrl.trim() ? 0.6 : 1,
                })}>
                    {probing ? 'Đang kiểm tra…' : 'Kiểm tra URL'}
                </button>
                <input
                    value={companyFilter}
                    onChange={(e) => setCompanyFilter(e.target.value)}
                    placeholder="Lọc công ty khi quét"
                    style={input({ minWidth: 160 })}
                />
                <button onClick={runScan} disabled={scanning} style={btn({ opacity: scanning ? 0.6 : 1 })}>
                    {scanning ? 'Đang quét…' : 'Quét lại pool'}
                </button>
                <button onClick={load} disabled={loading} style={btn()}>Làm mới</button>
                <button onClick={clearAll} style={btn({ color: 'var(--accent-red)' })}>Xoá nhật ký</button>
                {msg && <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', width: '100%' }}>{msg}</span>}
            </div>

            {visible.length === 0 ? (
                <div style={{
                    padding: 40, textAlign: 'center', color: 'var(--text-muted)',
                    border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-lg)',
                }}>
                    {loading ? 'Đang tải…'
                        : sourceView === 'cron' && rows.length > 0
                            ? 'Chưa có dòng nào từ cron. Bấm “Tất cả” để xem các lần probe/scan thủ công, hoặc chạy ingest.'
                            : 'Chưa có kết quả. Dán một URL để kiểm tra, hoặc quét pool công ty nổi bật.'}
                </div>
            ) : (
                <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                                {['Công ty', 'Kết quả lần gần nhất', 'Cách lấy', 'Chạy lúc', 'Nguồn', ''].map((h) => (
                                    <th key={h} style={{ padding: '10px 12px', fontWeight: 600 }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map((l) => {
                                const o = outcomeOf(l);
                                const s = SOURCE_STYLE[l.source] || { label: l.source || '-', color: 'var(--text-muted)', title: '' };
                                const fallback = l.usable && isFallbackStrategy(l.strategy);
                                return (
                                    <tr key={l.url} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                        {/* Công ty + link nhỏ tới career page */}
                                        <td style={{ padding: '10px 12px', borderLeft: `3px solid ${o.color}` }}>
                                            <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{l.company || l.host}</div>
                                            <a href={l.url} target="_blank" rel="noreferrer"
                                                style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.74rem' }}>
                                                {l.host || l.url} ↗
                                            </a>
                                        </td>

                                        {/* Kết quả: lấy được N job / không lấy được + vì sao */}
                                        <td style={{ padding: '10px 12px', maxWidth: 420 }} title={l.detail}>
                                            {o.ok ? (
                                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                                                    <span style={{ color: o.color, fontWeight: 700 }}>✓ Lấy được</span>
                                                    <span style={{ fontSize: '1.05rem', fontWeight: 800 }}>{o.count}</span>
                                                    <span style={{ color: 'var(--text-muted)' }}>job</span>
                                                </div>
                                            ) : (
                                                <span style={{ color: o.color, fontWeight: 700 }}>✕ Không lấy được</span>
                                            )}
                                            {o.note && (
                                                <div style={{ fontSize: '0.76rem', color: o.ok ? 'var(--accent-amber)' : 'var(--text-muted)', marginTop: 2 }}>
                                                    {o.ok ? '⚠ ' : ''}{o.note}
                                                </div>
                                            )}
                                        </td>

                                        {/* Cách lấy — adapter riêng hay nhánh dự phòng */}
                                        <td style={{ padding: '10px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                            {fallback && (
                                                <span title="Không có adapter riêng — đang dùng nhánh dự phòng (render/capture)"
                                                    style={{ color: 'var(--accent-amber)', marginRight: 4 }}>⚠</span>
                                            )}
                                            {l.strategy || (l.ats ? `ats:${l.ats}` : '—')}
                                        </td>

                                        <td style={{ padding: '10px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{ago(l.last_checked)}</td>

                                        <td style={{ padding: '10px 12px' }}>
                                            <span title={s.title} style={{
                                                fontSize: '0.72rem', fontWeight: 600, padding: '2px 7px', borderRadius: 8,
                                                color: s.color, border: `1px solid ${s.color}`, whiteSpace: 'nowrap',
                                            }}>{s.label}</span>
                                        </td>

                                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                                            <button onClick={() => recheck(l)} disabled={busyUrl === l.url}
                                                style={btn({ padding: '4px 10px', fontSize: '0.78rem', marginRight: 6 })}>
                                                {busyUrl === l.url ? '…' : 'Probe lại'}
                                            </button>
                                            <button onClick={() => remove(l)} disabled={busyUrl === l.url}
                                                style={btn({ padding: '4px 10px', fontSize: '0.78rem', color: 'var(--text-muted)' })}>
                                                ✕
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
