'use client';

// Small floating "góp ý sản phẩm" widget pinned to the bottom-right. Opens a
// compact form (optional quick rating + message) and POSTs to /api/feedback.
// Hidden on the gated landing page (when auth is on and nobody's signed in).
import { useState } from 'react';
import { ChatCircleDots, X, PaperPlaneTilt, CheckCircle } from '@phosphor-icons/react';
import { useAuth } from '@/lib/auth';
import { getAuthHeaders } from '@/lib/auth-headers';

const FACES = [
    { value: 1, emoji: '😕', label: 'Chưa ổn' },
    { value: 3, emoji: '😐', label: 'Tạm ổn' },
    { value: 5, emoji: '😍', label: 'Rất thích' },
];

export default function FloatingFeedback() {
    const { enabled, user } = useAuth();
    const [open, setOpen] = useState(false);
    const [rating, setRating] = useState(0);
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState('');

    // Hard-gate: don't show on the landing page (anonymous + auth enabled).
    if (enabled && !user) return null;

    const reset = () => {
        setRating(0); setMessage(''); setError(''); setDone(false);
    };
    const close = () => { setOpen(false); };

    const submit = async () => {
        const text = message.trim();
        if (!text) { setError('Hãy nhập vài dòng góp ý nhé.'); return; }
        setBusy(true); setError('');
        try {
            const res = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
                body: JSON.stringify({
                    message: text,
                    rating: rating || undefined,
                    page_url: typeof window !== 'undefined' ? window.location.pathname : undefined,
                }),
            });
            if (!res.ok) {
                const e = await res.json().catch(() => ({}));
                throw new Error(e.detail || `Gửi thất bại (${res.status})`);
            }
            setDone(true);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Gửi góp ý thất bại');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            {/* Launcher button */}
            <button
                aria-label="Góp ý về sản phẩm"
                onClick={() => { if (open) { close(); } else { reset(); setOpen(true); } }}
                style={{
                    position: 'fixed', bottom: 20, right: 20, zIndex: 95,
                    width: 52, height: 52, borderRadius: '50%', border: 'none',
                    background: 'var(--gradient-hero)', color: '#fff', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 8px 24px rgba(99,102,241,0.45)',
                    transition: 'transform 0.18s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px) scale(1.05)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
            >
                {open ? <X size={22} weight="bold" /> : <ChatCircleDots size={24} weight="fill" />}
            </button>

            {/* Popover form */}
            {open && (
                <div
                    role="dialog"
                    aria-label="Form góp ý"
                    style={{
                        position: 'fixed', bottom: 84, right: 20, zIndex: 95,
                        width: 320, maxWidth: 'calc(100vw - 40px)',
                        background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                        borderRadius: 16, padding: 18,
                        boxShadow: '0 20px 50px rgba(0,0,0,0.28)',
                        animation: 'ff-rise 0.18s ease',
                    }}
                >
                    <style>{`@keyframes ff-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }`}</style>

                    {done ? (
                        <div style={{ textAlign: 'center', padding: '14px 6px' }}>
                            <CheckCircle size={40} weight="fill" style={{ color: 'var(--accent-green, #22c55e)', marginBottom: 10 }} />
                            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                                Cảm ơn góp ý của bạn!
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                                Phản hồi của bạn giúp JobFit tốt hơn mỗi ngày.
                            </div>
                            <button
                                onClick={close}
                                className="btn-secondary"
                                style={{ padding: '8px 20px', fontSize: '0.85rem' }}
                            >
                                Đóng
                            </button>
                        </div>
                    ) : (
                        <>
                            <div style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                                Góp ý về sản phẩm
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 14 }}>
                                Bạn thấy JobFit thế nào? Điều gì nên cải thiện?
                            </div>

                            {/* Quick rating (optional) */}
                            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                                {FACES.map((f) => {
                                    const active = rating === f.value;
                                    return (
                                        <button
                                            key={f.value} type="button" title={f.label}
                                            onClick={() => setRating(active ? 0 : f.value)}
                                            style={{
                                                flex: 1, padding: '8px 0', borderRadius: 10, cursor: 'pointer',
                                                fontSize: '1.3rem', lineHeight: 1,
                                                border: `1px solid ${active ? 'var(--accent-purple, #8b5cf6)' : 'var(--border-subtle)'}`,
                                                background: active ? 'var(--gradient-hero-subtle, rgba(139,92,246,0.12))' : 'var(--bg-card)',
                                                filter: active ? 'none' : 'grayscale(0.4)',
                                                transition: 'all 0.15s ease',
                                            }}
                                        >
                                            {f.emoji}
                                        </button>
                                    );
                                })}
                            </div>

                            <textarea
                                value={message}
                                onChange={(e) => { setMessage(e.target.value); setError(''); }}
                                placeholder="Viết góp ý, báo lỗi hoặc đề xuất tính năng…"
                                rows={4}
                                autoFocus
                                style={{
                                    width: '100%', padding: '10px 12px', borderRadius: 10,
                                    border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
                                    color: 'var(--text-primary)', fontSize: '0.85rem', lineHeight: 1.5,
                                    resize: 'vertical', outline: 'none', fontFamily: 'inherit',
                                }}
                            />

                            {error && (
                                <div style={{ fontSize: '0.76rem', color: 'var(--accent-red, #ef4444)', marginTop: 8 }}>
                                    {error}
                                </div>
                            )}

                            <button
                                onClick={submit}
                                disabled={busy || !message.trim()}
                                className="btn-primary"
                                style={{
                                    width: '100%', marginTop: 12, height: 42, fontSize: '0.88rem', fontWeight: 600,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    opacity: (busy || !message.trim()) ? 0.6 : 1,
                                }}
                            >
                                <PaperPlaneTilt size={16} weight="fill" />
                                {busy ? 'Đang gửi…' : 'Gửi góp ý'}
                            </button>
                        </>
                    )}
                </div>
            )}
        </>
    );
}
