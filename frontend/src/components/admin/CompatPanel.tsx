'use client';

import { useCallback, useEffect, useState } from 'react';

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
};

// Verdict → colour. Usable = xanh, cần adapter = hổ phách, bị chặn = tím, không hỗ trợ = đỏ.
// Theme tokens, not hand-picked hex — these render on --bg-card and must clear
// AA contrast in both themes (the raw hex this replaced, e.g. #22c55e/#ef4444
// on white, sat at ~2.3–3.8:1 and didn't adapt for dark mode at all).
const VERDICT_COLOR: Record<string, string> = {
    supported: 'var(--accent-green)',
    supported_render: 'var(--accent-green)',
    needs_new_adapter: 'var(--accent-amber)',
    needs_capture: 'var(--accent-purple)',
    needs_login: 'var(--accent-purple)',
    unsupported: 'var(--accent-red)',
};

// Verdict → nhãn tiếng Việt ngắn gọn cho cột trạng thái.
const VERDICT_LABEL: Record<string, string> = {
    supported: 'Hỗ trợ',
    supported_render: 'Hỗ trợ (render)',
    needs_new_adapter: 'Cần adapter',
    needs_capture: 'Cần extension',
    needs_login: 'Cần đăng nhập',
    unsupported: 'Không hỗ trợ',
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
// mirror it exactly. `scan`/`probe`/`recheck` are manual dry-runs (ATS feed →
// SPA sniff, no capture/LLM) that can disagree with the pool, so flag them.
const SOURCE_STYLE: Record<string, { label: string; color: string; title: string }> = {
    cron: { label: 'cron', color: 'var(--accent-green)', title: 'Từ lần ingest thật gần nhất — khớp pool' },
    scan: { label: 'scan', color: 'var(--accent-amber)', title: 'Quét dry-run thủ công — có thể không khớp pool thật' },
    probe: { label: 'probe', color: 'var(--accent-amber)', title: 'Probe dry-run thủ công — có thể không khớp pool thật' },
    recheck: { label: 'recheck', color: 'var(--accent-amber)', title: 'Probe lại thủ công — dry-run' },
};

// A usable verdict reached via a fallback rung (render/SPA-sniff or an
// extension capture) rather than a dedicated `ats:<name>` adapter: it works but
// is slow/fragile — a candidate for a real adapter, and worth watching for
// regressions.
const isFallbackStrategy = (s: string): boolean => /spa_sniff|capture/i.test(s || '');

export default function CompatPanel() {
    const [rows, setRows] = useState<CompatRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [probing, setProbing] = useState(false);
    const [msg, setMsg] = useState('');
    const [probeUrl, setProbeUrl] = useState('');
    const [companyFilter, setCompanyFilter] = useState('');
    const [busyUrl, setBusyUrl] = useState('');

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

    // Probe một career URL bất kỳ, đây là tính năng chính: kiểm tra một trang
    // tuyển dụng đích có chạy được với cấu hình hiện tại không.
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
            const v = d.record?.verdict as string;
            setMsg(`${VERDICT_LABEL[v] || v}: ${d.record?.detail || ''}`);
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
                `${d.truncated ? ' (giới hạn)' : ''} → ${d.usable} dùng được`,
            );
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

    const usable = rows.filter((l) => l.usable).length;
    const needsAdapter = rows.filter((l) => l.verdict === 'needs_new_adapter').length;
    const blocked = rows.filter((l) => l.verdict === 'needs_capture' || l.verdict === 'needs_login').length;
    // Trust signals: how many rows reflect the real ingest (source=cron) vs
    // stale manual dry-runs, and how many usable ones lean on a fragile fallback.
    const fromCron = rows.filter((l) => l.source === 'cron').length;
    const fallback = rows.filter((l) => l.usable && isFallbackStrategy(l.strategy)).length;

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

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px', color: 'var(--text-primary)' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>🔌 Kiểm tra tương thích career page</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 20 }}>
                Mỗi công ty lấy được job với cấu hình hiện tại không, bằng cách nào, và nếu không thì vì
                sao. Dòng <b>nguồn=cron</b> đến thẳng từ lần ingest thật gần nhất nên khớp pool; probe/scan
                là chạy thử thủ công (ATS feed → SPA sniff, không capture/LLM) để soi nhanh một URL và có
                thể lệch pool.
            </p>

            {/* Probe một URL bất kỳ, tính năng chính */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                <input
                    value={probeUrl}
                    onChange={(e) => setProbeUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') probeOne(); }}
                    placeholder="Dán URL career page để kiểm tra…"
                    style={input({ flex: 1, minWidth: 280 })}
                />
                <button onClick={probeOne} disabled={probing || !probeUrl.trim()} style={btn({
                    background: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', color: '#fff',
                    opacity: probing || !probeUrl.trim() ? 0.6 : 1,
                })}>
                    {probing ? 'Đang kiểm tra…' : 'Kiểm tra URL'}
                </button>
            </div>

            {/* Quét cả pool công ty nổi bật */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
                <input
                    value={companyFilter}
                    onChange={(e) => setCompanyFilter(e.target.value)}
                    placeholder="Lọc theo công ty (tuỳ chọn)"
                    style={input({ minWidth: 220 })}
                />
                <button onClick={runScan} disabled={scanning} style={btn({ opacity: scanning ? 0.6 : 1 })}>
                    {scanning ? 'Đang quét…' : 'Quét công ty nổi bật'}
                </button>
                <button onClick={load} disabled={loading} style={btn()}>Làm mới</button>
                <button onClick={clearAll} style={btn({ marginLeft: 'auto', color: 'var(--accent-red)' })}>Xoá nhật ký</button>
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: '0.85rem' }}>
                <span><b>{rows.length}</b> đã probe</span>
                <span style={{ color: 'var(--accent-green)' }}><b>{usable}</b> dùng được</span>
                <span style={{ color: 'var(--accent-amber)' }}><b>{needsAdapter}</b> cần adapter</span>
                <span style={{ color: 'var(--accent-purple)' }}><b>{blocked}</b> bị chặn</span>
                <span title="Số dòng đến từ lần ingest thật (cron) — khớp pool; phần còn lại là scan/probe dry-run cũ">
                    <b>{fromCron}</b> từ cron
                </span>
                {fallback > 0 && (
                    <span style={{ color: 'var(--accent-amber)' }} title="Dùng được nhưng qua nhánh dự phòng (render/capture) — nên viết adapter riêng">
                        <b>{fallback}</b> ⚠ fallback
                    </span>
                )}
                {msg && <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{msg}</span>}
            </div>

            {rows.length === 0 ? (
                <div style={{
                    padding: 40, textAlign: 'center', color: 'var(--text-muted)',
                    border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-lg)',
                }}>
                    {loading ? 'Đang tải…' : 'Chưa có kết quả. Dán một URL để kiểm tra, hoặc quét pool công ty nổi bật.'}
                </div>
            ) : (
                <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                                {['Kết luận', 'Công ty', 'Career page', 'Cách lấy', 'Job', 'Nguồn', 'Vướng mắc', 'Kiểm tra', ''].map((h) => (
                                    <th key={h} style={{ padding: '10px 12px', fontWeight: 600 }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((l) => (
                                <tr key={l.url} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }} title={l.detail}>
                                        <span style={{ color: VERDICT_COLOR[l.verdict] || 'var(--text-muted)', fontWeight: 600 }}>
                                            ● {VERDICT_LABEL[l.verdict] || l.verdict}
                                        </span>
                                    </td>
                                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{l.company || l.host}</td>
                                    <td style={{ padding: '10px 12px', maxWidth: 300 }}>
                                        <a href={l.url} target="_blank" rel="noreferrer"
                                            style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
                                            {l.host || l.url}
                                        </a>
                                    </td>
                                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>
                                        {isFallbackStrategy(l.strategy) && (
                                            <span title="Không có adapter riêng — đang dùng nhánh dự phòng (render/capture), chậm & dễ gãy"
                                                style={{ color: 'var(--accent-amber)', marginRight: 4 }}>⚠</span>
                                        )}
                                        {l.strategy || (l.ats ? `ats:${l.ats}` : '-')}
                                    </td>
                                    <td style={{ padding: '10px 12px' }}>{l.job_count || '-'}</td>
                                    <td style={{ padding: '10px 12px' }}>
                                        {(() => {
                                            const s = SOURCE_STYLE[l.source] || { label: l.source || '-', color: 'var(--text-muted)', title: '' };
                                            return (
                                                <span title={s.title} style={{
                                                    fontSize: '0.72rem', fontWeight: 600, padding: '2px 7px', borderRadius: 8,
                                                    color: s.color, border: `1px solid ${s.color}`, whiteSpace: 'nowrap',
                                                }}>{s.label}</span>
                                            );
                                        })()}
                                    </td>
                                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>
                                        {l.blockers && l.blockers.length ? l.blockers.join(', ') : '-'}
                                    </td>
                                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{ago(l.last_checked)}</td>
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
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
