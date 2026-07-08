'use client';

// Admin: upload a source logo for companies in the pool. A company's logo is
// stored once (base64, downscaled ≤256px) and then reused EVERYWHERE the company
// shows up — promoted landing pages seed from it, and surfaces render it via the
// company-logo endpoint instead of a letter avatar. Companies that already have
// a logo are marked; a search box filters the ~200-company pool by name/domain.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    MagnifyingGlass, SpinnerGap, Buildings, Trash, UploadSimple, CheckCircle, WarningCircle,
} from '@phosphor-icons/react';
import { admin, catalog, type Company } from '@/lib/db';

// Downscale to ≤256px and re-encode so the stored base64 stays well under the
// backend's ~512KB cap regardless of source size. Guards against zero-dimension
// sources (e.g. some SVGs) that would otherwise yield a blank canvas.
function downscale(file: File): Promise<{ b64: string; mime: string }> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('read failed'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('decode failed'));
            img.onload = () => {
                const max = 256;
                const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
                const w = Math.max(1, Math.round((img.width || max) * scale));
                const h = Math.max(1, Math.round((img.height || max) * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) { reject(new Error('no canvas')); return; }
                ctx.drawImage(img, 0, 0, w, h);
                const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
                const dataUrl = canvas.toDataURL(mime, 0.85);
                resolve({ b64: dataUrl.split(',')[1], mime });
            };
            img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
    });
}

export default function CompanyLogoPanel() {
    const [q, setQ] = useState('');
    const [rows, setRows] = useState<Company[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [onlyMissing, setOnlyMissing] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    // Per-company cache-buster: the logo endpoint sends Cache-Control max-age=300,
    // so after an upload/remove we bump this to force the <img> to refetch.
    const [ver, setVer] = useState<Record<string, number>>({});
    const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

    const load = useCallback(async () => {
        setLoading(true); setError('');
        try {
            setRows(await admin.listCompanies({ q: q.trim() || undefined, limit: 300 }));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Tải danh sách thất bại');
        } finally { setLoading(false); }
    }, [q]);

    // Debounce the search so typing doesn't fire a request per keystroke.
    useEffect(() => {
        const t = setTimeout(load, 300);
        return () => clearTimeout(t);
    }, [load]);

    const onFile = async (c: Company, file: File) => {
        setBusyId(c.id); setError('');
        try {
            const { b64, mime } = await downscale(file);
            await admin.setCompanyLogo(c.id, { logo_b64: b64, logo_mime: mime });
            setRows((rs) => rs.map((r) => (r.id === c.id ? { ...r, has_logo: true } : r)));
            setVer((v) => ({ ...v, [c.id]: (v[c.id] || 0) + 1 }));
        } catch {
            setError(`Upload logo cho "${c.name}" thất bại (ảnh có thể quá lớn, tối đa ~512KB).`);
        } finally { setBusyId(null); }
    };

    const removeLogo = async (c: Company) => {
        if (!confirm(`Xoá logo của "${c.name}"?`)) return;
        setBusyId(c.id); setError('');
        try {
            await admin.deleteCompanyLogo(c.id);
            setRows((rs) => rs.map((r) => (r.id === c.id ? { ...r, has_logo: false } : r)));
            setVer((v) => ({ ...v, [c.id]: (v[c.id] || 0) + 1 }));
        } catch {
            setError('Xoá logo thất bại');
        } finally { setBusyId(null); }
    };

    const shown = onlyMissing ? rows.filter((r) => !r.has_logo) : rows;
    const withLogo = rows.filter((r) => r.has_logo).length;

    const inputStyle: React.CSSProperties = {
        width: '100%', padding: '10px 12px 10px 38px', borderRadius: 10,
        border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
        color: 'var(--text-primary)', fontSize: '0.88rem', outline: 'none',
    };

    return (
        <div className="glass-card" style={{ padding: 22 }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
                Upload logo nguồn cho công ty trong pool. Logo được lưu một lần và tái sử dụng ở mọi nơi
                công ty xuất hiện (trang truyền thông, kết quả, landing page) thay cho chữ cái đại diện.
                Ảnh tự thu nhỏ ≤256px, tối đa ~512KB.
            </p>

            {/* Controls */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
                    <MagnifyingGlass size={16} weight="bold" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên hoặc domain…"
                        style={inputStyle} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
                    <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
                    Chỉ công ty chưa có logo
                </label>
                <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {withLogo}/{rows.length} đã có logo
                </span>
            </div>

            {error && (
                <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: '0.8rem', color: 'var(--accent-red, #ef4444)' }}>
                    <WarningCircle size={16} weight="fill" /> {error}
                </div>
            )}

            {loading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 24, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    <SpinnerGap size={18} style={{ animation: 'spin 0.8s linear infinite' }} /> Đang tải…
                </div>
            ) : shown.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Không có công ty nào khớp.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {shown.map((c) => {
                        const busy = busyId === c.id;
                        const logoSrc = c.has_logo
                            ? `${catalog.companyLogoUrl(c.id)}?v=${ver[c.id] || 0}`
                            : null;
                        const initial = (c.name || '?').trim().charAt(0).toUpperCase();
                        return (
                            <div key={c.id} style={{
                                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                                borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                            }}>
                                {/* Logo / avatar */}
                                {logoSrc ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img alt={c.name} src={logoSrc} style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border-subtle)', flexShrink: 0, background: '#fff' }} />
                                ) : (
                                    <div style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-muted)', background: 'var(--bg-elevated)', border: '1px dashed var(--border-subtle)' }}>
                                        {initial}
                                    </div>
                                )}

                                {/* Name + meta */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                                        {c.has_logo && (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.66rem', fontWeight: 700, color: 'var(--accent-green, #22c55e)' }}>
                                                <CheckCircle size={12} weight="fill" /> có logo
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                        <Buildings size={12} />
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {c.domain || '—'}{c.industry ? ` · ${c.industry}` : ''}
                                        </span>
                                    </div>
                                </div>

                                {/* Actions */}
                                <input
                                    ref={(el) => { fileRefs.current[c.id] = el; }}
                                    type="file" accept="image/*" style={{ display: 'none' }}
                                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(c, f); e.target.value = ''; }}
                                />
                                <button type="button" onClick={() => fileRefs.current[c.id]?.click()} disabled={busy}
                                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '6px 11px', opacity: busy ? 0.5 : 1 }}>
                                    {busy
                                        ? <SpinnerGap size={13} style={{ animation: 'spin 0.8s linear infinite' }} />
                                        : <UploadSimple size={13} weight="bold" />}
                                    {c.has_logo ? 'Đổi' : 'Upload'}
                                </button>
                                {c.has_logo && (
                                    <button type="button" onClick={() => removeLogo(c)} disabled={busy} aria-label="Xoá logo"
                                        style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--text-muted)', background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '6px 8px', opacity: busy ? 0.5 : 1 }}>
                                        <Trash size={14} />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
    );
}
