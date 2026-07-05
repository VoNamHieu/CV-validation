'use client';

// Admin management for promoted landing pages ("trang truyền thông").
// Draft-first workflow: pages are created as drafts (from the Jobs tab), listed
// here for audit, previewed via the real /j/ page (?preview=<id> token), then
// published or deleted. The periodic cron also auto-deletes pages whose backing
// job went inactive — this panel is where an operator does the manual pass.
import { useCallback, useEffect, useState } from 'react';
import {
    Megaphone, ArrowSquareOut, Eye, EyeSlash, Trash, Copy, Check,
    ArrowsClockwise, SpinnerGap, CaretDown, PencilSimple,
} from '@phosphor-icons/react';
import { admin, type PromotedPage, type PromotedStatus } from '@/lib/db';
import PromotedEditorModal from './PromotedEditorModal';

function ago(iso: string): string {
    const t = Date.parse(iso);
    if (!t) return '-';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return 'vừa xong';
    if (s < 3600) return `${Math.floor(s / 60)}m trước`;
    if (s < 86400) return `${Math.floor(s / 3600)}h trước`;
    return `${Math.floor(s / 86400)}d trước`;
}

const STATUS_META: Record<PromotedStatus, { label: string; color: string; bg: string }> = {
    draft: { label: 'Nháp', color: '#d97706', bg: 'rgba(217,119,6,0.12)' },
    published: { label: 'Đang công bố', color: '#059669', bg: 'rgba(5,150,105,0.12)' },
    unpublished: { label: 'Đã gỡ', color: '#6b7280', bg: 'rgba(107,114,128,0.14)' },
};

export default function PromotedPanel() {
    const [pages, setPages] = useState<PromotedPage[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);

    // The page currently open in the full-screen editor modal (null = closed).
    const [editingPage, setEditingPage] = useState<PromotedPage | null>(null);

    // Modal saved: merge the updated row back into the list and close.
    const onEditorSaved = (updated: PromotedPage) => {
        setPages((cur) => cur.map((x) => (x.id === updated.id ? updated : x)));
        setEditingPage(null);
    };

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setPages(await admin.listPromoted());
        } catch {
            setError('Không tải được danh sách trang.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const setStatus = async (p: PromotedPage, status: PromotedStatus) => {
        setBusyId(p.id);
        try {
            const updated = await admin.patchPromoted(p.id, { status });
            setPages((cur) => cur.map((x) => (x.id === p.id ? updated : x)));
        } catch {
            setError('Cập nhật trạng thái thất bại.');
        } finally {
            setBusyId(null);
        }
    };

    const remove = async (p: PromotedPage) => {
        if (!confirm(`Xóa trang "${p.snapshot.title || p.slug}"? Không thể hoàn tác.`)) return;
        setBusyId(p.id);
        try {
            await admin.deletePromoted(p.id);
            setPages((cur) => cur.filter((x) => x.id !== p.id));
        } catch {
            setError('Xóa thất bại.');
        } finally {
            setBusyId(null);
        }
    };

    const previewUrl = (p: PromotedPage) =>
        `${window.location.origin}/j/${p.slug}${p.status === 'published' ? '' : `?preview=${p.id}`}`;

    const copyLink = (p: PromotedPage) => {
        navigator.clipboard?.writeText(`${window.location.origin}/j/${p.slug}`).then(() => {
            setCopied(p.id);
            setTimeout(() => setCopied((c) => (c === p.id ? null : c)), 1800);
        }).catch(() => { });
    };

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <Megaphone size={20} weight="duotone" style={{ color: 'var(--accent-purple)' }} />
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>Trang truyền thông</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Tạo ở tab “Tìm job” → xem lại tại đây → công bố hoặc xóa. Job đóng sẽ tự xóa khi cron chạy.
                    </div>
                </div>
                <button className="btn-secondary" onClick={load} disabled={loading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {loading ? <SpinnerGap size={15} style={{ animation: 'spin 0.8s linear infinite' }} /> : <ArrowsClockwise size={15} />}
                    Tải lại
                </button>
            </div>

            {error && (
                <div style={{
                    fontSize: '0.8rem', color: 'var(--accent-red)', background: 'rgba(220,38,38,0.08)',
                    border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8, padding: '8px 12px', marginBottom: 12,
                }}>{error}</div>
            )}

            {!loading && pages.length === 0 && (
                <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
                    <Megaphone size={28} weight="duotone" style={{ marginBottom: 8, opacity: 0.6 }} />
                    <div>Chưa có trang truyền thông nào.</div>
                    <div style={{ fontSize: '0.78rem', marginTop: 4 }}>
                        Sang tab “Tìm job”, mở một job và bấm “Tạo trang truyền thông”.
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pages.map((p) => {
                    const sm = STATUS_META[p.status] ?? STATUS_META.draft;
                    const open = expanded === p.id;
                    const busy = busyId === p.id;
                    const jdLen = (p.snapshot.description || '').length;
                    return (
                        <div key={p.id} className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                                <button type="button" onClick={() => setExpanded(open ? null : p.id)}
                                    style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                                    <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
                                        {p.snapshot.title || p.slug}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.74rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                                        {p.snapshot.company_name && <span>{p.snapshot.company_name}</span>}
                                        <span>JD {jdLen.toLocaleString()} ký tự</span>
                                        <span>👁 {p.view_count}</span>
                                        <span>tạo {ago(p.created_at)}</span>
                                    </div>
                                </button>
                                <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '3px 9px', borderRadius: 999, color: sm.color, background: sm.bg, whiteSpace: 'nowrap' }}>
                                    {sm.label}
                                </span>
                                <CaretDown size={13} onClick={() => setExpanded(open ? null : p.id)}
                                    style={{ color: 'var(--text-muted)', cursor: 'pointer', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                            </div>

                            {open && (
                                <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--border-subtle)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '10px 0 4px' }}>
                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>/j/{p.slug}</span>
                                        {p.snapshot.source_url && (
                                            <a href={p.snapshot.source_url} target="_blank" rel="noreferrer"
                                                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent-blue)', textDecoration: 'none' }}>
                                                <ArrowSquareOut size={12} /> Tin gốc
                                            </a>
                                        )}
                                    </div>

                                    {p.snapshot.description ? (
                                        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 12px', whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>
                                            {p.snapshot.description.slice(0, 1200)}{p.snapshot.description.length > 1200 ? '…' : ''}
                                        </p>
                                    ) : (
                                        <p style={{ fontSize: '0.78rem', color: 'var(--accent-red)', margin: '0 0 12px' }}>
                                            ⚠ Không có JD, bấm “Sửa nội dung” để thêm, hoặc xóa.
                                        </p>
                                    )}

                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                        <button type="button" onClick={() => setEditingPage(p)}
                                            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-purple)', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
                                            <PencilSimple size={13} /> Sửa nội dung
                                        </button>
                                        <a href={previewUrl(p)} target="_blank" rel="noreferrer"
                                            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-blue)', textDecoration: 'none' }}>
                                            <ArrowSquareOut size={14} /> Xem trang{p.status !== 'published' ? ' (preview)' : ''}
                                        </a>

                                        {p.status !== 'published' ? (
                                            <button type="button" onClick={() => setStatus(p, 'published')} disabled={busy || !p.snapshot.description}
                                                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontWeight: 700, color: '#fff', cursor: 'pointer', background: 'var(--gradient-success, linear-gradient(135deg,#059669,#0e7490))', border: 'none', borderRadius: 8, padding: '6px 12px', opacity: busy || !p.snapshot.description ? 0.5 : 1 }}>
                                                {busy ? <SpinnerGap size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Eye size={13} weight="fill" />} Công bố
                                            </button>
                                        ) : (
                                            <>
                                                <button type="button" onClick={() => copyLink(p)}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: 'var(--text-secondary)', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                                                    {copied === p.id ? <><Check size={13} /> Đã chép</> : <><Copy size={13} /> Chép link</>}
                                                </button>
                                                <button type="button" onClick={() => setStatus(p, 'unpublished')} disabled={busy}
                                                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
                                                    <EyeSlash size={13} /> Gỡ
                                                </button>
                                            </>
                                        )}

                                        <button type="button" onClick={() => remove(p)} disabled={busy}
                                            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent-red)', background: 'none', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', marginLeft: 'auto' }}>
                                            <Trash size={13} /> Xóa
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {editingPage && (
                <PromotedEditorModal
                    page={editingPage}
                    onClose={() => setEditingPage(null)}
                    onSaved={onEditorSaved}
                />
            )}
        </div>
    );
}
