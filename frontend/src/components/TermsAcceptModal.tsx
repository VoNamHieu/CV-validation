'use client';

// Scroll-to-accept consent modal shown at signup. The "Đồng ý" button stays
// disabled until the user has scrolled through the full Terms + Privacy text —
// stronger evidence than a bare checkbox that the terms were actually presented.
import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CaretDown, CheckCircle } from '@phosphor-icons/react';
import { TermsContent, PrivacyContent, LEGAL_PROSE_CSS } from './legal/LegalContent';
import { useModalA11y } from '@/lib/useModalA11y';

export default function TermsAcceptModal({
    onAccept, onClose,
}: {
    onAccept: () => void;
    onClose: () => void;
}) {
    const [reachedEnd, setReachedEnd] = useState(false);

    const checkEnd = (el: HTMLDivElement) => {
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setReachedEnd(true);
    };

    // Callback ref: when the scroll box mounts, enable immediately if the text
    // already fits without scrolling (not an effect, so no setState-in-effect).
    const setScrollNode = useCallback((el: HTMLDivElement | null) => {
        if (el && el.scrollHeight <= el.clientHeight + 24) setReachedEnd(true);
    }, []);

    const dialogRef = useModalA11y<HTMLDivElement>(onClose);

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 130, background: 'rgba(0,0,0,0.55)',
                backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 16,
            }}
        >
            <style>{LEGAL_PROSE_CSS}</style>
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="terms-modal-title"
                tabIndex={-1}
                style={{
                    width: '100%', maxWidth: 640, maxHeight: '88vh', background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)', borderRadius: 16,
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                }}
            >
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)',
                }}>
                    <h2 id="terms-modal-title" style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                        Điều khoản Sử dụng &amp; Chính sách Quyền riêng tư
                    </h2>
                    <button
                        onClick={onClose} aria-label="Đóng"
                        style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                        <X size={18} weight="bold" />
                    </button>
                </div>

                {/* Scrollable legal text */}
                <div
                    ref={setScrollNode}
                    onScroll={(e) => checkEnd(e.currentTarget)}
                    className="legal-prose"
                    style={{ flex: 1, overflowY: 'auto', padding: '20px 22px', minHeight: 0 }}
                >
                    <h2 style={{ marginTop: 0 }}>Điều khoản Sử dụng</h2>
                    <p className="legal-updated" style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 8px' }}>
                        Cập nhật lần cuối: 30/06/2026
                    </p>
                    <TermsContent />

                    <div style={{ height: 1, background: 'var(--border-default)', margin: '32px 0 8px' }} />

                    <h2>Chính sách Quyền riêng tư</h2>
                    <PrivacyContent />
                </div>

                {/* Footer */}
                <div style={{
                    padding: '14px 20px', borderTop: '1px solid var(--border-subtle)',
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between',
                }}>
                    <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {reachedEnd
                            ? <><CheckCircle size={15} weight="fill" style={{ color: 'var(--accent-green)' }} /> Bạn đã xem hết nội dung</>
                            : <><CaretDown size={14} /> Cuộn xuống cuối để đồng ý</>}
                    </span>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button
                            onClick={onClose}
                            style={{
                                padding: '10px 16px', borderRadius: 10, cursor: 'pointer',
                                border: '1px solid var(--border-default)', background: 'var(--bg-card)',
                                color: 'var(--text-secondary)', fontSize: '0.84rem', fontWeight: 600,
                            }}
                        >
                            Đóng
                        </button>
                        <button
                            onClick={onAccept}
                            disabled={!reachedEnd}
                            style={{
                                padding: '10px 20px', borderRadius: 10, border: 'none',
                                background: 'var(--gradient-hero)', color: '#fff', fontSize: '0.84rem',
                                fontWeight: 700, cursor: reachedEnd ? 'pointer' : 'default',
                                opacity: reachedEnd ? 1 : 0.5,
                            }}
                        >
                            Tôi đã đọc &amp; đồng ý
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
