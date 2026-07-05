'use client';

import { useCallback, useEffect, useState } from 'react';

import { getAuthHeaders } from '@/lib/auth-headers';

type LinkRecord = {
    url: string;
    host: string;
    company: string;
    title: string;
    source: string;
    status: 'broken' | 'unknown' | 'ok';
    reason: string;
    http_code: number;
    detail: string;
    first_seen: number;
    last_checked: number;
    hits: number;
};

const STATUS_COLOR: Record<string, string> = {
    broken: 'var(--accent-red)',
    unknown: 'var(--accent-amber)',
    ok: 'var(--accent-green)',
};

function ago(ts: number): string {
    if (!ts) return '—';
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
}

export default function MonitorPanel() {
    const [links, setLinks] = useState<LinkRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [msg, setMsg] = useState('');
    const [companyFilter, setCompanyFilter] = useState('');
    const [busyUrl, setBusyUrl] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetch('/api/monitor/links', { headers: await getAuthHeaders() });
            const d = await r.json();
            setLinks(Array.isArray(d.links) ? d.links : []);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : 'Failed to load');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const runScan = async () => {
        setScanning(true);
        setMsg('Scanning featured job URLs…');
        try {
            const qs = new URLSearchParams({ limit: '300' });
            if (companyFilter.trim()) qs.set('company', companyFilter.trim());
            const r = await fetch(`/api/monitor/scan?${qs}`, { method: 'POST', headers: await getAuthHeaders() });
            const d = await r.json();
            if (!r.ok) throw new Error(d.detail || `Scan failed (${r.status})`);
            setMsg(
                `Scanned ${d.scanned}/${d.total_available}` +
                `${d.truncated ? ' (capped)' : ''} → ${d.broken} broken, ${d.unknown} suspect, ${d.ok} ok`,
            );
            await load();
        } catch (e) {
            setMsg(e instanceof Error ? e.message : 'Scan failed');
        } finally {
            setScanning(false);
        }
    };

    const recheck = async (rec: LinkRecord) => {
        setBusyUrl(rec.url);
        try {
            await fetch('/api/monitor/recheck', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
                body: JSON.stringify({ url: rec.url, title: rec.title }),
            });
            await load();
        } finally {
            setBusyUrl('');
        }
    };

    const remove = async (rec: LinkRecord) => {
        setBusyUrl(rec.url);
        try {
            await fetch('/api/monitor/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
                body: JSON.stringify({ url: rec.url }),
            });
            setLinks((prev) => prev.filter((l) => l.url !== rec.url));
        } finally {
            setBusyUrl('');
        }
    };

    const clearAll = async () => {
        if (!confirm('Clear the entire link-health log?')) return;
        await fetch('/api/monitor/clear', { method: 'POST', headers: await getAuthHeaders() });
        setLinks([]);
        setMsg('Log cleared.');
    };

    const broken = links.filter((l) => l.status === 'broken').length;
    const unknown = links.filter((l) => l.status === 'unknown').length;

    const btn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
        padding: '8px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-default)',
        background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '0.85rem',
        ...extra,
    });

    return (
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px', color: 'var(--text-primary)' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>🔗 Link Health Monitor</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: 20 }}>
                Broken / suspect job-detail links — from the live pipeline (passive) and active health-checks.
                A link can return HTTP 200 yet still be dead (empty SPA shell), so status is content-based.
            </p>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
                <input
                    value={companyFilter}
                    onChange={(e) => setCompanyFilter(e.target.value)}
                    placeholder="Filter scan by company (optional)"
                    style={{
                        padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: '0.85rem',
                        border: '1px solid var(--border-default)', background: 'var(--bg-secondary)',
                        color: 'var(--text-primary)', minWidth: 240,
                    }}
                />
                <button onClick={runScan} disabled={scanning} style={btn({
                    background: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', color: '#fff',
                    opacity: scanning ? 0.6 : 1,
                })}>
                    {scanning ? 'Scanning…' : 'Run health-check'}
                </button>
                <button onClick={load} disabled={loading} style={btn()}>Refresh</button>
                <button onClick={clearAll} style={btn({ marginLeft: 'auto', color: 'var(--accent-red)' })}>Clear log</button>
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: '0.85rem' }}>
                <span><b>{links.length}</b> logged</span>
                <span style={{ color: 'var(--accent-red)' }}><b>{broken}</b> broken</span>
                <span style={{ color: 'var(--accent-amber)' }}><b>{unknown}</b> suspect</span>
                {msg && <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{msg}</span>}
            </div>

            {links.length === 0 ? (
                <div style={{
                    padding: 40, textAlign: 'center', color: 'var(--text-muted)',
                    border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-lg)',
                }}>
                    {loading ? 'Loading…' : 'No broken links logged yet. Run a health-check to scan the featured pool.'}
                </div>
            ) : (
                <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                                {['Status', 'Company', 'Job', 'Reason', 'Source', 'Checked', ''].map((h) => (
                                    <th key={h} style={{ padding: '10px 12px', fontWeight: 600 }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {links.map((l) => (
                                <tr key={l.url} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                                    <td style={{ padding: '10px 12px' }}>
                                        <span style={{
                                            color: STATUS_COLOR[l.status] || 'var(--text-muted)', fontWeight: 600,
                                        }}>● {l.status}</span>
                                        {l.http_code ? <span style={{ color: 'var(--text-muted)' }}> {l.http_code}</span> : null}
                                    </td>
                                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{l.company || l.host}</td>
                                    <td style={{ padding: '10px 12px', maxWidth: 320 }}>
                                        <a href={l.url} target="_blank" rel="noreferrer"
                                            style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
                                            {l.title || l.url}
                                        </a>
                                    </td>
                                    <td style={{ padding: '10px 12px' }} title={l.detail}>{l.reason}</td>
                                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{l.source}</td>
                                    <td style={{ padding: '10px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{ago(l.last_checked)}</td>
                                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                                        <button onClick={() => recheck(l)} disabled={busyUrl === l.url}
                                            style={btn({ padding: '4px 10px', fontSize: '0.78rem', marginRight: 6 })}>
                                            {busyUrl === l.url ? '…' : 'Re-check'}
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
