'use client';

// Before/after compare: the original CV vs the optimized one rendered in the
// SAME template, side by side (stacked on mobile), so the user can see exactly
// what tailoring changed. Read-only iframes (no inline editing here).
import { createPortal } from 'react-dom';
import { X, ArrowsLeftRight } from '@phosphor-icons/react';
import { renderCvHtml } from '@/lib/cv-templates';
import type { CvTemplateId } from '@/lib/cv-templates';
import type { CVData } from '@/lib/types';
import { useModalA11y } from '@/lib/useModalA11y';

export default function BeforeAfterModal({
    original, optimized, templateId, avatarBase64, onClose,
}: {
    original: CVData;
    optimized: CVData;
    templateId?: CvTemplateId;
    avatarBase64?: string;
    onClose: () => void;
}) {
    const dialogRef = useModalA11y<HTMLDivElement>(onClose);

    if (typeof document === 'undefined') return null;

    const frame = (cv: CVData) => renderCvHtml(cv, templateId, { avatarBase64 });

    const col = (label: string, color: string, cv: CVData) => (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px',
                fontSize: '0.78rem', fontWeight: 700, color,
                borderBottom: '1px solid var(--border-subtle)',
            }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                {label}
            </div>
            <iframe
                title={label} srcDoc={frame(cv)}
                style={{ flex: 1, width: '100%', border: 'none', background: '#fff', minHeight: 0 }}
            />
        </div>
    );

    return createPortal(
        <div
            role="presentation"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 16,
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="before-after-modal-title"
                tabIndex={-1}
                style={{
                    width: '100%', maxWidth: 1100, height: '90vh', background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)', borderRadius: 16,
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
                }}
            >
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)',
                }}>
                    <h2 id="before-after-modal-title" style={{ fontSize: '0.98rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <ArrowsLeftRight size={17} weight="duotone" style={{ color: 'var(--accent-purple, #c43b2e)' }} />
                        So sánh CV: gốc &harr; đã tối ưu
                    </h2>
                    <button onClick={onClose} aria-label="Đóng"
                        style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        <X size={18} weight="bold" />
                    </button>
                </div>

                <div className="ba-cols" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                    {col('CV gốc', 'var(--text-muted)', original)}
                    <div className="ba-divider" style={{ width: 1, background: 'var(--border-subtle)' }} />
                    {col('Đã tối ưu', 'var(--accent-purple, #c43b2e)', optimized)}
                </div>
            </div>

            <style>{`
                @media (max-width: 760px) {
                    .ba-cols { flex-direction: column; overflow-y: auto; }
                    .ba-cols iframe { min-height: 70vh; }
                    .ba-divider { width: 100% !important; height: 1px; }
                }
            `}</style>
        </div>,
        document.body,
    );
}
