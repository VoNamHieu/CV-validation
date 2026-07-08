'use client';

// Shown when the user triggers an auto-apply action without the Copo Chrome
// extension installed. Globally mounted (layout) and opened via the
// NEED_EXTENSION_EVENT, so any caller just dispatches promptInstallExtension().
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, PuzzlePiece, ArrowSquareOut, CheckCircle } from '@phosphor-icons/react';
import { EXTENSION_INSTALL_URL, NEED_EXTENSION_EVENT } from '@/lib/extension-install';
import { useModalA11y } from '@/lib/useModalA11y';
import { track } from '@/lib/analytics';

const STEPS = [
    'Tải & cài extension Copo cho Chrome từ link bên dưới.',
    'Ghim extension, rồi quay lại đây và tải lại trang (F5).',
    'Bấm "Ứng tuyển tự động" lại, agent sẽ tự điền form.',
];

export default function InstallExtensionModal() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const onNeed = () => setOpen(true);
        window.addEventListener(NEED_EXTENSION_EVENT, onNeed);
        return () => window.removeEventListener(NEED_EXTENSION_EVENT, onNeed);
    }, []);

    // This component itself lives for the whole app session (mounted once at
    // the layout level) and just flips `open` — it never unmounts. A child
    // component for the actual dialog is what needs to mount/unmount each time
    // the modal opens, so useModalA11y's focus-trap/restore fires on every
    // open, not just the first.
    if (!open) return null;
    return <InstallExtensionDialog onClose={() => setOpen(false)} />;
}

function InstallExtensionDialog({ onClose }: { onClose: () => void }) {
    const dialogRef = useModalA11y<HTMLDivElement>(onClose);

    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            role="presentation"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 110,
                background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="install-ext-modal-title"
                tabIndex={-1}
                style={{
                    width: '100%', maxWidth: 400, background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)', borderRadius: 16,
                    padding: 24, position: 'relative', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
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
                    width: 48, height: 48, borderRadius: 14, marginBottom: 14,
                    background: 'var(--gradient-hero)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <PuzzlePiece size={24} weight="fill" color="#fff" />
                </div>

                <h2 id="install-ext-modal-title" style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
                    Cần cài extension Copo
                </h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.55 }}>
                    Tính năng tự động ứng tuyển cần extension Copo cho Chrome để điền form trên trang
                    tuyển dụng. Cài một lần là dùng được.
                </p>

                <ol style={{ margin: '0 0 18px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {STEPS.map((s, i) => (
                        <li key={i} style={{ display: 'flex', gap: 9, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            <span style={{
                                flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
                                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-primary)',
                            }}>{i + 1}</span>
                            {s}
                        </li>
                    ))}
                </ol>

                <a
                    href={EXTENSION_INSTALL_URL} target="_blank" rel="noopener noreferrer"
                    onClick={() => { track('extension_install_clicked', { source: 'modal' }); setTimeout(onClose, 300); }}
                    className="btn-primary"
                    style={{
                        width: '100%', height: 46, fontSize: '0.9rem', fontWeight: 600, textDecoration: 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                >
                    <ArrowSquareOut size={17} weight="bold" /> Cài extension Copo
                </a>

                <div style={{
                    marginTop: 12, fontSize: '0.74rem', color: 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                    <CheckCircle size={13} weight="fill" style={{ color: 'var(--accent-green, #22c55e)' }} />
                    Miễn phí · cài một lần
                </div>
            </div>
        </div>,
        document.body,
    );
}
