'use client';

// "Xin thêm credit" flow. The first request grants a one-time free top-up; any
// request after that switches to a manual bank-transfer view (the owner tops
// the user up after the transfer — no payment gateway yet).
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Coins, CheckCircle, Copy } from '@phosphor-icons/react';
import { credits as creditsApi } from '@/lib/db';
import { BANK_INFO, TOPUP_PACK, SUPPORT_EMAIL } from '@/lib/payment';

type View = 'intro' | 'granted' | 'pay';

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
    const [imgOk, setImgOk] = useState(true);

    const request = async () => {
        setBusy(true);
        setError('');
        try {
            const r = await creditsApi.requestTopup();
            if (r.requires_payment) {
                setView('pay');
            } else {
                setGranted(r.granted);
                setView('granted');
                onGranted();
            }
        } catch {
            setError('Không gửi được yêu cầu. Vui lòng thử lại.');
        } finally {
            setBusy(false);
        }
    };

    const note = `JobFit ${email}`;
    const copy = (t: string) => { navigator.clipboard?.writeText(t).catch(() => {}); };

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
                    width: '100%', maxWidth: 420, maxHeight: '88vh', overflowY: 'auto',
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
                    {view === 'granted'
                        ? <CheckCircle size={22} weight="fill" color="#fff" />
                        : <Coins size={22} weight="duotone" color="#fff" />}
                </div>

                {/* ── Intro: offer the request ── */}
                {view === 'intro' && (
                    <>
                        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                            Xin thêm credit
                        </h2>
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 18px' }}>
                            Lần đầu bạn được tặng thêm <strong style={{ color: 'var(--text-primary)' }}>{TOPUP_PACK.credits} credit</strong> miễn phí.
                            Sau đó, để dùng tiếp bạn cần mua thêm qua chuyển khoản.
                        </p>
                        {error && <div style={{ fontSize: '0.78rem', color: 'var(--accent-red, #ef4444)', marginBottom: 10 }}>{error}</div>}
                        <button
                            onClick={request} disabled={busy}
                            style={primaryBtn(busy)}
                        >
                            {busy ? 'Đang xử lý…' : `Nhận thêm ${TOPUP_PACK.credits} credit`}
                        </button>
                    </>
                )}

                {/* ── Granted: free top-up succeeded ── */}
                {view === 'granted' && (
                    <>
                        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                            Đã cộng {granted} credit!
                        </h2>
                        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 18px' }}>
                            Credit miễn phí đã được cộng vào tài khoản. Lần tới bạn sẽ cần mua thêm.
                        </p>
                        <button onClick={onClose} style={primaryBtn(false)}>Tiếp tục</button>
                    </>
                )}

                {/* ── Pay: manual bank transfer ── */}
                {view === 'pay' && (
                    <>
                        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 6px', color: 'var(--text-primary)' }}>
                            Mua thêm credit
                        </h2>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
                            Bạn đã dùng hết lượt miễn phí. Chuyển khoản theo thông tin dưới đây
                            ({TOPUP_PACK.credits} credit · {TOPUP_PACK.priceVnd.toLocaleString('vi-VN')}đ), ghi đúng nội dung,
                            rồi credit sẽ được cộng sau khi xác nhận.
                        </p>

                        {imgOk && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={BANK_INFO.qrImage} alt="Mã QR chuyển khoản"
                                onError={() => setImgOk(false)}
                                style={{
                                    display: 'block', width: 200, height: 200, objectFit: 'contain',
                                    margin: '0 auto 14px', borderRadius: 12, background: '#fff',
                                    border: '1px solid var(--border-subtle)',
                                }}
                            />
                        )}

                        <div style={{
                            display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.82rem',
                            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                            borderRadius: 10, padding: '12px 14px', marginBottom: 14,
                        }}>
                            <Row label="Ngân hàng" value={BANK_INFO.bank} />
                            <Row label="Số tài khoản" value={BANK_INFO.accountNumber} onCopy={() => copy(BANK_INFO.accountNumber)} />
                            <Row label="Chủ tài khoản" value={BANK_INFO.accountHolder} />
                            <Row label="Số tiền" value={`${TOPUP_PACK.priceVnd.toLocaleString('vi-VN')}đ`} />
                            <Row label="Nội dung CK" value={note} onCopy={() => copy(note)} highlight />
                        </div>

                        <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 14px' }}>
                            Sau khi chuyển, gửi biên lai tới{' '}
                            <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Mua credit JobFit')}&body=${encodeURIComponent(note)}`}
                                style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{SUPPORT_EMAIL}</a>
                            {' '}để được cộng credit sớm nhất.
                        </p>
                        <button onClick={onClose} style={primaryBtn(false)}>Đã hiểu</button>
                    </>
                )}
            </div>
        </div>,
        document.body,
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
                }}>
                    {value}
                </span>
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

function primaryBtn(busy: boolean): React.CSSProperties {
    return {
        width: '100%', padding: '11px 12px', borderRadius: 10, border: 'none',
        background: 'var(--gradient-hero)', color: '#fff', fontSize: '0.85rem',
        fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
    };
}
