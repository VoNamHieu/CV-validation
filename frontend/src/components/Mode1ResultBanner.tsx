'use client';

// Mode 1 — when the extension tailors the CV for a job page, the background
// pushes the result here. This banner surfaces it on the web app: shows the
// match score + what changed, and lets the user kick off auto-apply. The apply
// call carries ONLY the opaque source_ref — the extension resolves it back to
// the real job URL locally, so the backend never learns the URL.

import { useEffect, useState } from 'react';
import { onMode1Result, triggerMode1Apply, type Mode1Result } from '@/lib/extension-sync';
import { buildCvPdfCache } from '@/lib/cv-pdf-cache';

export default function Mode1ResultBanner() {
    const [result, setResult] = useState<Mode1Result | null>(null);
    const [applying, setApplying] = useState(false);
    const [status, setStatus] = useState('');

    useEffect(() => onMode1Result(setResult), []);

    if (!result) return null;

    const score = typeof result.match?.overall_score === 'number'
        ? (result.match.overall_score as number) : null;
    const name = (result.improved_cv as { name?: string })?.name || 'CV';
    const nChanges = Array.isArray(result.improvements) ? result.improvements.length : 0;

    const apply = async () => {
        setApplying(true);
        setStatus('');
        // Render the TAILORED CV → PDF and pass it straight to the apply call,
        // so the extension stores it ATOMICALLY with the pending-apply flag —
        // the agent then uploads THIS CV, not a stale one. Non-fatal: on render
        // failure the agent falls back to whatever PDF was last synced.
        setStatus('📄 Đang tạo PDF từ CV đã tailor…');
        let cvFileBase64: string | undefined;
        let cvFileName: string | undefined;
        try {
            const out = await buildCvPdfCache(result.improved_cv);
            cvFileBase64 = out.optimizedCvPdfBase64;
            cvFileName = out.optimizedCvFileName;
        } catch (e) {
            console.warn('[Mode1] tailored-CV PDF render failed (non-fatal):', e);
        }
        const res = await triggerMode1Apply(result.source_ref, { cvFileBase64, cvFileName });
        setApplying(false);
        setStatus(res.ok ? '🚀 Đang mở trang job và tự động ứng tuyển…' : `❌ ${res.error}`);
    };

    return (
        <div style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 9999, maxWidth: 380,
            background: 'linear-gradient(135deg, #1e1b4b, #312e81)', color: '#fff',
            padding: '16px 20px', borderRadius: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
            border: '1px solid rgba(139,92,246,0.35)', fontSize: 14, lineHeight: 1.5,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>✨ CV đã tailor cho 1 job</strong>
                <button
                    onClick={() => { setResult(null); setStatus(''); }}
                    style={{ background: 'transparent', border: 'none', color: '#a5b4fc', cursor: 'pointer', fontSize: 16 }}
                    aria-label="Đóng"
                >✕</button>
            </div>
            <div style={{ color: '#c7d2fe', marginBottom: 10 }}>
                {name}{score != null ? ` · độ phù hợp ${score}/100` : ''}{nChanges ? ` · ${nChanges} chỉnh sửa` : ''}
            </div>
            <button
                onClick={apply}
                disabled={applying}
                style={{
                    width: '100%', padding: '10px 14px', borderRadius: 10, border: 'none',
                    cursor: applying ? 'default' : 'pointer', fontWeight: 700,
                    background: applying ? '#4338ca' : 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: '#fff',
                }}
            >
                {applying ? '⏳ Đang xử lý…' : '🚀 Tự động ứng tuyển'}
            </button>
            {status && <div style={{ marginTop: 8, fontSize: 12, color: '#c7d2fe' }}>{status}</div>}
        </div>
    );
}
