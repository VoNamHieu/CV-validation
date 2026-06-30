import Link from 'next/link';
import type { ReactNode } from 'react';

// Shared layout for the static legal pages (/privacy, /terms). Public — these
// routes sit outside the app's login gate so they're reachable by anyone (and
// linkable from a Chrome Web Store listing). Server component: no interactivity.
export default function LegalShell({
    title, updated, children,
}: {
    title: string;
    updated: string;
    children: ReactNode;
}) {
    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
            <style>{LEGAL_CSS}</style>

            <header style={{
                borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)',
            }}>
                <div style={{
                    maxWidth: 760, margin: '0 auto', padding: '16px 24px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                    <Link href="/" className="legal-brand">Copo</Link>
                    <Link href="/" className="legal-back">← Về trang chủ</Link>
                </div>
            </header>

            <article className="legal-prose">
                <h1>{title}</h1>
                <p className="legal-updated">Cập nhật lần cuối: {updated}</p>
                {children}
            </article>

            <footer className="legal-footer">
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <Link href="/" className="legal-footer-link">Trang chủ</Link>
                    <Link href="/privacy" className="legal-footer-link">Quyền riêng tư</Link>
                    <Link href="/terms" className="legal-footer-link">Điều khoản sử dụng</Link>
                    <a href="mailto:vonamhieu.work@gmail.com" className="legal-footer-link">Liên hệ</a>
                </div>
                <div style={{ marginTop: 10, opacity: 0.7 }}>
                    © 2026 Copo · Vận hành bởi AI · Cam kết không bịa nội dung
                </div>
            </footer>
        </div>
    );
}

const LEGAL_CSS = `
.legal-brand { font-weight: 800; font-size: 1rem; letter-spacing: -0.02em; text-decoration: none;
  background: var(--gradient-hero); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.legal-back { font-size: 0.82rem; color: var(--text-secondary); text-decoration: none; }
.legal-back:hover { color: var(--text-primary); }

.legal-prose { max-width: 760px; margin: 0 auto; padding: 48px 24px 32px;
  color: var(--text-secondary); font-size: 0.92rem; line-height: 1.7; }
.legal-prose h1 { font-size: clamp(1.5rem, 4vw, 2rem); font-weight: 800; letter-spacing: -0.02em;
  color: var(--text-primary); margin: 0 0 6px; }
.legal-updated { color: var(--text-muted); font-size: 0.82rem; margin: 0 0 28px; }
.legal-prose h2 { font-size: 1.05rem; font-weight: 700; color: var(--text-primary); margin: 30px 0 8px; letter-spacing: -0.01em; }
.legal-prose h3 { font-size: 0.92rem; font-weight: 700; color: var(--text-primary); margin: 16px 0 4px; }
.legal-prose p { margin: 0 0 12px; }
.legal-prose ul { margin: 0 0 12px; padding-left: 20px; display: flex; flex-direction: column; gap: 7px; }
.legal-prose li { line-height: 1.6; }
.legal-prose a { color: var(--accent-blue); text-decoration: none; }
.legal-prose a:hover { text-decoration: underline; }
.legal-prose strong { color: var(--text-primary); font-weight: 600; }
.legal-prose .lead { color: var(--text-secondary); }

.legal-footer { max-width: 760px; margin: 0 auto; padding: 24px; border-top: 1px solid var(--border-subtle);
  text-align: center; font-size: 0.78rem; color: var(--text-muted); }
.legal-footer-link { color: var(--text-secondary); text-decoration: none; font-weight: 500; }
.legal-footer-link:hover { color: var(--text-primary); }
`;
