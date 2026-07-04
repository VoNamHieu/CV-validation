'use client';

// Route-level error boundary (Next.js). Last-resort net so an uncaught render
// throw anywhere in the page shows a recoverable screen instead of a blank
// white page. `reset()` re-renders the segment without a full reload.
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        // eslint-disable-next-line no-console
        console.error('[route error]', error);
    }, [error]);

    return (
        <div style={{
            minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24,
            background: 'var(--bg-primary)', color: 'var(--text-primary)',
        }}>
            <div style={{
                maxWidth: 420, textAlign: 'center', background: 'var(--bg-card)',
                border: '1px solid var(--border-default)', borderRadius: 16, padding: 32,
            }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>⚠️</div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>Đã xảy ra lỗi</h2>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
                    Có lỗi khi hiển thị trang. Dữ liệu của bạn vẫn an toàn — thử lại hoặc tải lại trang.
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                    <button className="btn-primary" onClick={() => reset()}>Thử lại</button>
                    <button className="btn-secondary" onClick={() => location.reload()}>Tải lại trang</button>
                </div>
            </div>
        </div>
    );
}
