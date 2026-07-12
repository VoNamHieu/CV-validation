'use client';

// Reusable confirmation dialog — replaces native window.confirm() for
// consequential actions. Shares the app's modal shape: portal → overlay
// (role=presentation, click-outside closes) → content (role=dialog, focus-
// trapped via useModalA11y). Tone drives the accent (warning/danger/default).
import { createPortal } from 'react-dom';
import { Warning } from '@phosphor-icons/react';
import { useModalA11y } from '@/lib/useModalA11y';

type Tone = 'default' | 'warning' | 'danger';

const TONE: Record<Tone, { color: string; bg: string; border: string }> = {
    default: { color: 'var(--accent-blue)', bg: 'rgba(196, 59, 46, 0.12)', border: 'rgba(196, 59, 46, 0.35)' },
    warning: { color: 'var(--accent-amber)', bg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.35)' },
    danger: { color: 'var(--accent-red)', bg: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.35)' },
};

export default function ConfirmModal({
    title, children, confirmLabel = 'Xác nhận', cancelLabel = 'Hủy',
    tone = 'default', icon, busy = false, onConfirm, onClose,
}: {
    title: string;
    children: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    tone?: Tone;
    icon?: React.ReactNode;
    busy?: boolean;
    onConfirm: () => void;
    onClose: () => void;
}) {
    const contentRef = useModalA11y<HTMLDivElement>(onClose);
    if (typeof document === 'undefined') return null;
    const t = TONE[tone];

    return createPortal(
        <div
            role="presentation"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 140, background: 'rgba(0,0,0,0.55)',
                backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 16,
            }}
        >
            <div
                ref={contentRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="confirm-modal-title"
                tabIndex={-1}
                style={{
                    width: '100%', maxWidth: 440, background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)', borderRadius: 16,
                    overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
                }}
            >
                <div style={{ padding: '22px 22px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                        <span style={{
                            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            background: t.bg, border: `1px solid ${t.border}`, color: t.color,
                        }}>
                            {icon ?? <Warning size={20} weight="fill" />}
                        </span>
                        <h2 id="confirm-modal-title" style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.01em', margin: 0 }}>
                            {title}
                        </h2>
                    </div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        {children}
                    </div>
                </div>
                <div style={{
                    display: 'flex', gap: 10, justifyContent: 'flex-end',
                    padding: '14px 22px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
                }}>
                    <button
                        className="btn-secondary"
                        onClick={onClose}
                        disabled={busy}
                        style={{ padding: '9px 18px', fontSize: '0.85rem' }}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        className="btn-primary"
                        onClick={() => onConfirm()}
                        disabled={busy}
                        style={{
                            padding: '9px 18px', fontSize: '0.85rem',
                            // Tone the button only for destructive actions; default/
                            // warning keep the standard accent (warning is carried by
                            // the icon + copy), which keeps text contrast correct.
                            ...(tone === 'danger' ? { background: 'var(--accent-red)' } : {}),
                            opacity: busy ? 0.6 : 1,
                        }}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
