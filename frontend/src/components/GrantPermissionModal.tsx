'use client';

// Shown when an auto-apply action fails because the Copo extension doesn't yet
// have host permission for the job site. That grant can ONLY be done from the
// extension popup (the web-app gesture is lost reaching the background worker,
// and Chrome blocks a page from opening the popup) — so this modal walks the
// user through it. Globally mounted (layout), opened via NEED_PERMISSION_EVENT.
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldCheck, CheckCircle, PushPin } from '@phosphor-icons/react';
import { NEED_PERMISSION_EVENT } from '@/lib/extension-install';
import { useModalA11y } from '@/lib/useModalA11y';

const STEPS: { text: ReactNode; img?: string; alt?: string }[] = [
    {
        text: <>Bấm biểu tượng extension <b>🧩</b> ở góc phải thanh trình duyệt, rồi chọn <b>Copo</b> (ghim lại cho dễ mở).</>,
        img: '/guide/grant-1-open.png',
        alt: 'Mở menu extension của Chrome và chọn Copo',
    },
    {
        text: <>Trong popup Copo, bấm <b>&quot;Bật cho mọi trang&quot;</b>.</>,
        img: '/guide/grant-2-allow.png',
        alt: 'Bấm nút Bật cho mọi trang trong popup Copo',
    },
    {
        text: <>Quay lại đây và bấm <b>&quot;Ứng tuyển&quot;</b> lại — agent sẽ tự chạy.</>,
    },
];

export default function GrantPermissionModal() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const onNeed = () => setOpen(true);
        window.addEventListener(NEED_PERMISSION_EVENT, onNeed);
        return () => window.removeEventListener(NEED_PERMISSION_EVENT, onNeed);
    }, []);

    if (!open) return null;
    return <GrantPermissionDialog onClose={() => setOpen(false)} />;
}

function GrantPermissionDialog({ onClose }: { onClose: () => void }) {
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
                aria-labelledby="grant-perm-modal-title"
                tabIndex={-1}
                style={{
                    width: '100%', maxWidth: 420, background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)', borderRadius: 16,
                    padding: 24, position: 'relative', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                    maxHeight: '90vh', overflowY: 'auto',
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
                    <ShieldCheck size={24} weight="fill" color="#fff" />
                </div>

                <h2 id="grant-perm-modal-title" style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
                    Cấp quyền cho Copo
                </h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.55 }}>
                    Extension đã cài nhưng chưa được cấp quyền chạy trên trang tuyển dụng. Vì lý do
                    bảo mật của Chrome, quyền này chỉ cấp được từ <b>popup của extension</b> — làm 1 lần là xong.
                </p>

                <ol style={{ margin: '0 0 18px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {STEPS.map((s, i) => (
                        <li key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 9, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                <span style={{
                                    flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
                                    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-primary)',
                                }}>{i + 1}</span>
                                <span>{s.text}</span>
                            </div>
                            {s.img && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    src={s.img} alt={s.alt} loading="lazy"
                                    style={{
                                        display: 'block', width: '100%', height: 'auto', borderRadius: 10,
                                        border: '1px solid var(--border-subtle)', marginLeft: 29,
                                        maxWidth: 'calc(100% - 29px)', boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
                                    }}
                                />
                            )}
                        </li>
                    ))}
                </ol>

                <button
                    onClick={onClose}
                    className="btn-primary"
                    style={{
                        width: '100%', height: 46, fontSize: '0.9rem', fontWeight: 600, border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                >
                    <CheckCircle size={17} weight="bold" /> Đã cấp quyền — thử lại
                </button>

                <div style={{
                    marginTop: 12, fontSize: '0.74rem', color: 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                    <PushPin size={13} weight="fill" style={{ color: 'var(--accent-purple)' }} />
                    Mẹo: ghim Copo lên thanh công cụ để lần sau mở nhanh
                </div>
            </div>
        </div>,
        document.body,
    );
}
