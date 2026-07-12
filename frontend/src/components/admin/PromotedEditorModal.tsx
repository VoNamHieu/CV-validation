'use client';

// Full-screen editor for a promoted landing page ("trang truyền thông").
// Two panes: on the left an editable form (page fields + a JD editor with a
// small formatting toolbar), on the right a LIVE preview that renders the exact
// same hero/JD/facts layout as the public /j/ page — so an operator aligns the
// content against what will actually publish, instead of typing blind into a
// bare textarea. Saving PATCHes the snapshot in one shot.
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    X, Check, SpinnerGap, ArrowSquareOut, ListBullets, TextT,
    MapPin, Buildings, Briefcase, ChartLineUp, Sparkle,
} from '@phosphor-icons/react';
import { admin, type PromotedPage } from '@/lib/db';
import { renderJd } from '@/lib/renderJd';
import { useModalA11y } from '@/lib/useModalA11y';
import pstyles from '@/app/j/[slug]/promoted.module.css';

type LogoDraft = { b64: string; mime: string; preview: string };

export default function PromotedEditorModal({
    page, onClose, onSaved,
}: {
    page: PromotedPage;
    onClose: () => void;
    onSaved: (updated: PromotedPage) => void;
}) {
    const dialogRef = useModalA11y<HTMLDivElement>(onClose);
    const jdRef = useRef<HTMLTextAreaElement>(null);

    const s = page.snapshot;
    const [title, setTitle] = useState(s.title || '');
    const [company, setCompany] = useState(s.company_name || '');
    const [location, setLocation] = useState(s.location || '');
    const [industry, setIndustry] = useState(s.industry || '');
    const [seniority, setSeniority] = useState(s.seniority || '');
    const [sourceUrl, setSourceUrl] = useState(s.source_url || '');
    const [jd, setJd] = useState(s.description || '');
    const [logoDraft, setLogoDraft] = useState<LogoDraft | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    // Downscale to ≤256px and re-encode so the stored base64 stays well under
    // the backend's ~512KB cap regardless of the source file size.
    const onLogoFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const max = 256;
                const scale = Math.min(1, max / Math.max(img.width, img.height));
                const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                ctx.drawImage(img, 0, 0, w, h);
                const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
                const dataUrl = canvas.toDataURL(mime, 0.85);
                setLogoDraft({ b64: dataUrl.split(',')[1], mime, preview: dataUrl });
            };
            img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
    };

    // Transform the line(s) the cursor/selection touches, keeping focus + a
    // sensible selection so the toolbar feels like a real editor.
    const transformLines = (fn: (line: string) => string) => {
        const el = jdRef.current;
        if (!el) return;
        const value = jd;
        const start = el.selectionStart ?? value.length;
        const end = el.selectionEnd ?? start;
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        let lineEnd = value.indexOf('\n', end);
        if (lineEnd === -1) lineEnd = value.length;
        const before = value.slice(0, lineStart);
        const target = value.slice(lineStart, lineEnd);
        const after = value.slice(lineEnd);
        const transformed = target.split('\n').map((l) => (l.trim() ? fn(l) : l)).join('\n');
        const next = before + transformed + after;
        setJd(next);
        requestAnimationFrame(() => {
            el.focus();
            el.setSelectionRange(lineStart, lineStart + transformed.length);
        });
    };

    const toggleBullet = () => transformLines((l) =>
        /^[-•*·+]\s+/.test(l) ? l.replace(/^[-•*·+]\s+/, '') : `- ${l.replace(/^\s+/, '')}`);
    const toggleHeading = () => transformLines((l) =>
        /[:：]$/.test(l.trim()) ? l.replace(/[:：]+\s*$/, '') : `${l.replace(/\s+$/, '')}:`);

    const save = async () => {
        setBusy(true);
        setError('');
        try {
            const snapshot: Record<string, unknown> = {
                title: title.trim(),
                company_name: company.trim(),
                location: location.trim(),
                industry: industry.trim(),
                seniority: seniority.trim(),
                source_url: sourceUrl.trim(),
                description: jd,
            };
            if (logoDraft) { snapshot.logo_b64 = logoDraft.b64; snapshot.logo_mime = logoDraft.mime; }
            const updated = await admin.patchPromoted(page.id, { snapshot });
            // Server strips logo_b64 from the row; keep has_logo truthy locally.
            onSaved({
                ...updated,
                snapshot: { ...updated.snapshot, has_logo: logoDraft ? true : s.has_logo },
            });
        } catch {
            setError('Lưu thất bại (ảnh có thể quá lớn, tối đa ~512KB).');
            setBusy(false);
        }
    };

    if (typeof document === 'undefined') return null;

    // ── Preview data (mirrors /j/[slug]/page.tsx) ──
    const initial = (company || title || '?').trim().charAt(0).toUpperCase();
    const logoSrc = logoDraft
        ? logoDraft.preview
        : s.has_logo
            ? `${window.location.origin}/api/store/promoted/logo-by-slug/${page.slug}?preview=${page.id}`
            : null;
    const chips = [
        location && { icon: <MapPin size={14} weight="fill" />, text: location },
        industry && { icon: <Buildings size={14} weight="fill" />, text: industry },
        seniority && { icon: <ChartLineUp size={14} weight="fill" />, text: seniority },
    ].filter(Boolean) as { icon: React.ReactNode; text: string }[];
    const facts = [
        company && { icon: <Buildings size={17} weight="fill" />, label: 'Công ty', value: company },
        location && { icon: <MapPin size={17} weight="fill" />, label: 'Địa điểm', value: location },
        industry && { icon: <Briefcase size={17} weight="fill" />, label: 'Lĩnh vực', value: industry },
        seniority && { icon: <ChartLineUp size={17} weight="fill" />, label: 'Cấp bậc', value: seniority },
    ].filter(Boolean) as { icon: React.ReactNode; label: string; value: string }[];

    const field = (
        label: string, value: string, set: (v: string) => void, placeholder = '',
    ) => (
        <label style={{ display: 'block' }}>
            <span style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</span>
            <input value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder}
                style={{
                    width: '100%', fontSize: '0.82rem', padding: '8px 10px', borderRadius: 8,
                    border: '1px solid var(--border-default)', background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)', fontFamily: 'inherit',
                }} />
        </label>
    );

    const toolBtnStyle: React.CSSProperties = {
        display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem', fontWeight: 600,
        color: 'var(--text-secondary)', background: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '4px 9px', cursor: 'pointer',
    };

    return createPortal(
        <div
            role="presentation"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 130, background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 16,
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="promoted-editor-title"
                tabIndex={-1}
                style={{
                    width: '100%', maxWidth: 1240, height: '92vh', background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)', borderRadius: 16,
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                }}
            >
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 18px', borderBottom: '1px solid var(--border-subtle)',
                }}>
                    <h2 id="promoted-editor-title" style={{ flex: 1, minWidth: 0, fontSize: '0.98rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Chỉnh sửa trang truyền thông
                    </h2>
                    <button type="button" onClick={save} disabled={busy}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 700, color: '#fff', cursor: 'pointer', background: 'var(--gradient-hero, linear-gradient(135deg,#c43b2e,#c43b2e))', border: 'none', borderRadius: 8, padding: '7px 16px', opacity: busy ? 0.5 : 1 }}>
                        {busy ? <SpinnerGap size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Check size={14} weight="bold" />} Lưu
                    </button>
                    <button type="button" onClick={onClose} aria-label="Đóng"
                        style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}>
                        <X size={18} weight="bold" />
                    </button>
                </div>

                {error && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--accent-red)', background: 'rgba(220,38,38,0.08)', borderBottom: '1px solid rgba(220,38,38,0.2)', padding: '8px 18px' }}>{error}</div>
                )}

                {/* Two panes */}
                <div className="pe-cols" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                    {/* ── Left: form ── */}
                    <div className="pe-form" style={{ width: '46%', minWidth: 0, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14, borderRight: '1px solid var(--border-subtle)' }}>
                        {field('Tiêu đề vị trí', title, setTitle, 'VD: Senior Backend Engineer')}
                        {field('Tên công ty', company, setCompany)}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            {field('Địa điểm', location, setLocation)}
                            {field('Cấp bậc', seniority, setSeniority)}
                        </div>
                        {field('Lĩnh vực', industry, setIndustry)}
                        {field('Link tin gốc', sourceUrl, setSourceUrl, 'https://…')}

                        {/* Logo */}
                        <div>
                            <span style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Logo công ty</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                {logoSrc && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img alt="logo" src={logoSrc}
                                        style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border-subtle)' }} />
                                )}
                                <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogoFile(f); }}
                                    style={{ fontSize: '0.74rem' }} />
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>≤512KB, tự thu nhỏ 256px</span>
                            </div>
                        </div>

                        {/* JD editor */}
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)', marginRight: 'auto' }}>Mô tả công việc (JD)</span>
                                <button type="button" onClick={toggleHeading} style={toolBtnStyle}>
                                    <TextT size={13} /> Tiêu đề mục
                                </button>
                                <button type="button" onClick={toggleBullet} style={toolBtnStyle}>
                                    <ListBullets size={13} /> Gạch đầu dòng
                                </button>
                            </div>
                            <textarea ref={jdRef} value={jd} onChange={(e) => setJd(e.target.value)}
                                placeholder="Dán hoặc gõ mô tả công việc. Dòng kết thúc bằng ':' thành tiêu đề mục, dòng bắt đầu bằng '-' thành gạch đầu dòng."
                                style={{ width: '100%', minHeight: 320, fontSize: '0.8rem', lineHeight: 1.6, padding: 12, borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'inherit', resize: 'vertical' }} />
                            {sourceUrl && (
                                <a href={sourceUrl} target="_blank" rel="noreferrer"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent-blue)', textDecoration: 'none' }}>
                                    <ArrowSquareOut size={12} /> Mở tin gốc để copy mô tả
                                </a>
                            )}
                        </div>
                    </div>

                    {/* ── Right: live preview (mirrors /j/[slug]) ── */}
                    <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg-primary)' }}>
                        <div style={{ position: 'sticky', top: 0, zIndex: 2, fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', padding: '8px 16px', background: 'var(--bg-glass)', backdropFilter: 'saturate(160%) blur(8px)', borderBottom: '1px solid var(--border-subtle)' }}>
                            Xem trước · trang công bố
                        </div>
                        <div className={pstyles.page}>
                            <div className={pstyles.hero}>
                                <div className={pstyles.heroInner}>
                                    {logoSrc ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img className={pstyles.avatar} src={logoSrc} alt={company || title} style={{ objectFit: 'cover' }} />
                                    ) : (
                                        <div className={pstyles.avatar}>{initial}</div>
                                    )}
                                    <div className={pstyles.heroText}>
                                        {company && <p className={pstyles.company}>{company}</p>}
                                        <h1 className={pstyles.title}>{title || 'Tiêu đề vị trí'}</h1>
                                        {chips.length > 0 && (
                                            <div className={pstyles.chips}>
                                                {chips.map((c) => (
                                                    <span key={c.text} className={pstyles.chip}>{c.icon}{c.text}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className={pstyles.layout}>
                                <div className={pstyles.main}>
                                    <h2 className={pstyles.sectionHeading}>Mô tả công việc</h2>
                                    <div className={pstyles.jd}>
                                        {jd.trim() ? renderJd(jd) : <p>Chưa có mô tả cho vị trí này.</p>}
                                    </div>
                                </div>
                                <aside className={pstyles.sidebar}>
                                    {facts.length > 0 && (
                                        <div className={pstyles.factsCard}>
                                            <p className={pstyles.factsTitle}>Thông tin</p>
                                            {facts.map((f) => (
                                                <div key={f.label} className={pstyles.factRow}>
                                                    <span className={pstyles.factIcon}>{f.icon}</span>
                                                    <div>
                                                        <p className={pstyles.factLabel}>{f.label}</p>
                                                        <p className={pstyles.factValue}>{f.value}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </aside>
                            </div>

                            <div className={pstyles.footerNote}>
                                <Sparkle size={12} weight="fill" style={{ verticalAlign: -1, marginRight: 4 }} />
                                Trang được cung cấp bởi Copo · Tối ưu CV &amp; ứng tuyển thông minh
                            </div>
                        </div>
                    </div>
                </div>

                <style>{`
                    @media (max-width: 860px) {
                        .pe-cols { flex-direction: column; }
                        .pe-form { width: 100% !important; border-right: none !important; border-bottom: 1px solid var(--border-subtle); }
                    }
                `}</style>
            </div>
        </div>,
        document.body,
    );
}
