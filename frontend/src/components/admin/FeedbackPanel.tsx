'use client';

// Admin view of user feedback / support messages (newest first).
import { useCallback, useEffect, useState } from 'react';
import { Star, ArrowsClockwise, ChatCircleDots } from '@phosphor-icons/react';
import { admin, type Feedback } from '@/lib/db';

function ago(iso: string): string {
    const t = new Date(iso).getTime();
    if (!t) return '';
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return `${s}s trước`;
    if (s < 3600) return `${Math.floor(s / 60)}m trước`;
    if (s < 86400) return `${Math.floor(s / 3600)}h trước`;
    return `${Math.floor(s / 86400)}d trước`;
}

export default function FeedbackPanel() {
    const [items, setItems] = useState<Feedback[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true); setError('');
        try {
            setItems(await admin.listFeedback());
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Không tải được feedback');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {loading ? 'Đang tải…' : `${items.length} góp ý`}
                </span>
                <button className="btn-secondary" onClick={load} disabled={loading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', padding: '6px 12px' }}>
                    <ArrowsClockwise size={14} weight="bold" /> Tải lại
                </button>
            </div>

            {error && <div style={{ color: 'var(--accent-red, #ef4444)', fontSize: '0.82rem', marginBottom: 12 }}>{error}</div>}

            {!loading && items.length === 0 && (
                <div style={{
                    padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)',
                    border: '1px dashed var(--border-subtle)', borderRadius: 12, fontSize: '0.85rem',
                }}>
                    <ChatCircleDots size={28} weight="duotone" style={{ marginBottom: 8, opacity: 0.6 }} />
                    <div>Chưa có góp ý nào.</div>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((f) => (
                    <div key={f.id} className="glass-card" style={{ padding: '14px 16px' }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            gap: 10, marginBottom: 8, flexWrap: 'wrap',
                        }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {f.email || 'Ẩn danh'}
                                </span>
                                {f.rating != null && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--accent-amber, #f59e0b)' }}>
                                        {Array.from({ length: f.rating }).map((_, i) => <Star key={i} size={12} weight="fill" />)}
                                    </span>
                                )}
                                {f.source && (
                                    <span style={{
                                        fontSize: '0.66rem', fontWeight: 700, padding: '1px 7px', borderRadius: 10,
                                        background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                                    }}>{f.source}</span>
                                )}
                            </span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>{ago(f.created_at)}</span>
                        </div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {f.message}
                        </p>
                        {f.page_url && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6 }}>từ {f.page_url}</div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
