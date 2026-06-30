'use client';

// "Xin thêm credit" flow:
//   1st request  → grant the one-time free credits, then a "support us" screen:
//                  leave feedback, or buy-me-a-coffee (bank transfer, any amount).
//   afterwards   → a manual bank-transfer paywall (fixed pack price).
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Coins, CheckCircle, Copy, Coffee, Star, PaperPlaneTilt } from '@phosphor-icons/react';
import { credits as creditsApi, account } from '@/lib/db';
import { BANK_INFO, TOPUP_PACKS, FREE_TOPUP, TRANSFER_NOTE } from '@/lib/payment';

type View = 'intro' | 'support' | 'pay';

export default function CreditRequestModal({
    email, onClose, onGranted,
}: {
    email: string;
    onClose: () => void;
    onGranted: () => void;     // refresh the balance widget
}) {
    const [view, setView] = useState<View>('intro');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [granted, setGranted] = useState(0);

    const request = async () => {
        setBusy(true);
        setError('');
        try {
            const r = await creditsApi.requestTopup();
            if (r.requires_payment) {
                setView('pay');
            } else {
                setGranted(r.granted);
                setView('support');
                onGranted();
            }
        } catch {
            setError('Không gửi được yêu cầu. Vui lòng thử lại.');
        } finally {
            setBusy(false);
        }
    };

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            onClick={busy ? undefined : onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 16,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto',
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                    borderRadius: 16, padding: 24, position: 'relative',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                }}
            >
                <button
                    onClick={onClose} aria-label="Đóng"
                    style={{
                        position: 'absolute', top: 14, right: 14, border: 'none',
                        background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                    }}
                >
                    <X size={18} weight="bold" />
                </button>

                <div style={{
                    width: 44, height: 44, borderRadius: 12, marginBottom: 14,
                    background: 'var(--gradient-hero)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                }}>
                    {view === 'support'
                        ? <CheckCircle size={22} weight="fill" color="#fff" />
                        : <Coins size={22} weight="duotone" color="#fff" />}
                </div>

                {view === 'intro' && (
                    <>
                        <h2 style={titleStyle}>Xin thêm token</h2>
                        <p style={descStyle}>
                            Lần đầu bạn được tặng thêm <strong style={{ color: 'var(--text-primary)' }}>{FREE_TOPUP} token</strong> miễn phí.
                            Sau đó, để dùng tiếp bạn cần mua thêm qua chuyển khoản.
                        </p>
                        {error && <div style={errStyle}>{error}</div>}
                        <button onClick={request} disabled={busy} style={primaryBtn(busy)}>
                            {busy ? 'Đang xử lý…' : `Nhận thêm ${FREE_TOPUP} token`}
                        </button>
                    </>
                )}

                {view === 'support' && (
                    <SupportView granted={granted} email={email} onClose={onClose} />
                )}

                {view === 'pay' && (
                    <>
                        <h2 style={titleStyle}>Mua thêm token</h2>
                        <p style={descStyle}>
                            Bạn đã dùng hết lượt miễn phí. Chọn gói, chuyển khoản đúng số tiền + nội dung
                            bên dưới — token sẽ được cộng sau khi xác nhận.
                        </p>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                            {TOPUP_PACKS.map((p) => (
                                <div key={p.credits} style={{
                                    flex: 1, border: '1px solid var(--border-subtle)', borderRadius: 10,
                                    padding: '12px 10px', textAlign: 'center', background: 'var(--bg-card)',
                                }}>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                        {p.credits} <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)' }}>token</span>
                                    </div>
                                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-purple, #8b5cf6)', marginTop: 2 }}>
                                        {p.priceVnd.toLocaleString('vi-VN')}đ
                                    </div>
                                </div>
                            ))}
                        </div>
                        <BankTransfer note={`${TRANSFER_NOTE} ${email}`} />
                        <p style={{ ...descStyle, fontSize: '0.74rem', margin: '12px 0 14px' }}>
                            Token sẽ được cộng tự động sau khi hệ thống nhận được chuyển khoản —
                            quá trình có thể mất vài phút để hoàn tất.
                        </p>
                        <button onClick={onClose} style={primaryBtn(false)}>Đã hiểu</button>
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
}

// First-request success + optional support (feedback / coffee).
function SupportView({ granted, email, onClose }: { granted: number; email: string; onClose: () => void }) {
    const [msg, setMsg] = useState('');
    const [rating, setRating] = useState(0);
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const [showCoffee, setShowCoffee] = useState(false);

    const send = async () => {
        if (!msg.trim() || sending) return;
        setSending(true);
        try {
            await account.submitFeedback({ message: msg.trim(), rating: rating || undefined, source: 'topup' });
            setSent(true);
        } catch {
            // best-effort — don't block the user on feedback
            setSent(true);
        } finally {
            setSending(false);
        }
    };

    return (
        <>
            <h2 style={titleStyle}>Đã cộng {granted} token! 🎉</h2>
            <p style={descStyle}>
                Cảm ơn bạn đã dùng Copo. Nếu thấy hữu ích, bạn có thể ủng hộ mình một chút —
                hoàn toàn tuỳ tâm.
            </p>

            {/* Feedback */}
            {sent ? (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', fontWeight: 600,
                    color: 'var(--accent-green)', padding: '12px 14px', borderRadius: 10,
                    background: 'color-mix(in srgb, var(--accent-green) 12%, transparent)', marginBottom: 12,
                }}>
                    <CheckCircle size={16} weight="fill" /> Cảm ơn góp ý của bạn!
                </div>
            ) : (
                <div style={{
                    border: '1px solid var(--border-subtle)', borderRadius: 12,
                    padding: 14, marginBottom: 12, background: 'var(--bg-card)',
                }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
                        Góp ý để Copo tốt hơn
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                        {[1, 2, 3, 4, 5].map((n) => (
                            <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} sao`}
                                style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 0 }}>
                                <Star size={20} weight={n <= rating ? 'fill' : 'regular'}
                                    style={{ color: n <= rating ? 'var(--accent-amber, #f59e0b)' : 'var(--text-muted)' }} />
                            </button>
                        ))}
                    </div>
                    <textarea
                        value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} maxLength={4000}
                        placeholder="Bạn thích/chưa thích gì? Muốn có thêm tính năng nào?"
                        style={{
                            width: '100%', resize: 'vertical', padding: '8px 10px', borderRadius: 8,
                            background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                            color: 'var(--text-primary)', fontSize: '0.82rem', fontFamily: 'inherit', lineHeight: 1.5,
                        }}
                    />
                    <button
                        onClick={send} disabled={!msg.trim() || sending}
                        style={{
                            marginTop: 8, display: 'flex', alignItems: 'center', gap: 6,
                            padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--gradient-hero)',
                            color: '#fff', fontSize: '0.8rem', fontWeight: 600,
                            cursor: (!msg.trim() || sending) ? 'default' : 'pointer', opacity: (!msg.trim() || sending) ? 0.55 : 1,
                        }}
                    >
                        <PaperPlaneTilt size={14} weight="fill" /> {sending ? 'Đang gửi…' : 'Gửi góp ý'}
                    </button>
                </div>
            )}

            {/* Buy me a coffee */}
            {showCoffee ? (
                <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Coffee size={16} weight="duotone" style={{ color: 'var(--accent-amber, #f59e0b)' }} /> Mời mình ly cà phê (tuỳ tâm)
                    </div>
                    <BankTransfer note={`Copo cafe ${email}`} />
                </div>
            ) : (
                <button
                    onClick={() => setShowCoffee(true)}
                    style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        padding: '10px 12px', borderRadius: 10, marginBottom: 12, cursor: 'pointer',
                        border: '1px solid var(--border-default)', background: 'var(--bg-card)',
                        color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 600,
                    }}
                >
                    <Coffee size={16} weight="duotone" style={{ color: 'var(--accent-amber, #f59e0b)' }} /> Buy me a coffee ☕
                </button>
            )}

            <button onClick={onClose} style={primaryBtn(false)}>Tiếp tục</button>
        </>
    );
}

function BankTransfer({ note, amount }: { note: string; amount?: string }) {
    const [imgOk, setImgOk] = useState(true);
    const copy = (t: string) => { navigator.clipboard?.writeText(t).catch(() => {}); };
    return (
        <>
            {imgOk && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={BANK_INFO.qrImage} alt="Mã QR chuyển khoản" onError={() => setImgOk(false)}
                    style={{
                        display: 'block', width: 180, height: 180, objectFit: 'contain',
                        margin: '0 auto 12px', borderRadius: 12, background: '#fff',
                        border: '1px solid var(--border-subtle)',
                    }}
                />
            )}
            <div style={{
                display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.82rem',
                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                borderRadius: 10, padding: '12px 14px',
            }}>
                <Row label="Ngân hàng" value={BANK_INFO.bank} />
                <Row label="Số tài khoản" value={BANK_INFO.accountNumber} onCopy={() => copy(BANK_INFO.accountNumber)} />
                <Row label="Chủ tài khoản" value={BANK_INFO.accountHolder} />
                {amount && <Row label="Số tiền" value={amount} />}
                <Row label="Nội dung CK" value={note} onCopy={() => copy(note)} highlight />
            </div>
        </>
    );
}

function Row({ label, value, onCopy, highlight }: {
    label: string; value: string; onCopy?: () => void; highlight?: boolean;
}) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ color: 'var(--text-muted)' }}>{label}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{
                    fontWeight: 700, color: highlight ? 'var(--accent-purple, #8b5cf6)' : 'var(--text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{value}</span>
                {onCopy && (
                    <button onClick={onCopy} aria-label="Sao chép" title="Sao chép"
                        style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}>
                        <Copy size={14} />
                    </button>
                )}
            </span>
        </div>
    );
}

const titleStyle: React.CSSProperties = { fontSize: '1.05rem', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' };
const descStyle: React.CSSProperties = { fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' };
const errStyle: React.CSSProperties = { fontSize: '0.78rem', color: 'var(--accent-red, #ef4444)', marginBottom: 10 };

function primaryBtn(busy: boolean): React.CSSProperties {
    return {
        width: '100%', padding: '11px 12px', borderRadius: 10, border: 'none',
        background: 'var(--gradient-hero)', color: '#fff', fontSize: '0.85rem',
        fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
    };
}
