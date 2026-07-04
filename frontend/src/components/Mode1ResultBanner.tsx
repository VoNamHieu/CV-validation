'use client';

// Mode 1 — when the extension tailors the CV for a job page, the background
// pushes the result here. On arrival we auto-open the tailored CV in the full
// editor (StepEditCv) so the user lands straight on the editable/downloadable
// CV, and surface a small confirmation toast that shows the match score +
// what changed and offers one-click auto-apply. The apply call carries ONLY
// the opaque source_ref — the extension resolves it back to the real job URL
// locally, so the backend never learns the URL.

import { useCallback, useEffect, useState } from 'react';
import { onMode1Result, triggerMode1Apply, type Mode1Result } from '@/lib/extension-sync';
import { buildCvPdfCache } from '@/lib/cv-pdf-cache';
import { useAppStore, type JDData, type MatchResult } from '@/store/useAppStore';
import type { CvImprovement, CvSuggestion } from '@/lib/cv-improvements';

const hostnameOf = (u: string) => { try { return new URL(u).hostname; } catch { return ''; } };

export default function Mode1ResultBanner() {
    const [result, setResult] = useState<Mode1Result | null>(null);
    const [applying, setApplying] = useState(false);
    const [status, setStatus] = useState('');
    const { addJdEntry, addJobRecord, setSelectedJdId, setStep, setView } = useAppStore();

    // Drop the tailored result into the editor (StepEditCv) — the same view the
    // featured flow uses (template preview, improvements, edit, download) — AND
    // save the job to history like a normal one. Both are keyed by source_ref so
    // re-firing (StrictMode, a duplicate push, or a later "Xem CV" click) is
    // idempotent and never appends a duplicate.
    const openInEditor = useCallback((r: Mode1Result) => {
        const id = `mode1-${r.source_ref || Date.now()}`;
        // The job title comes from the page (extension), since the extracted JD
        // carries no title; fall back to the JD then a generic label.
        const title = r.jobTitle || (r.jd as { title?: string } | undefined)?.title || '';
        const overall = (r.match as { overall_score?: number } | undefined)?.overall_score ?? 0;
        const store = useAppStore.getState();
        if (!store.jdEntries.some(e => e.id === id)) {
            addJdEntry({
                id,
                source: 'mode1-tailor',
                applyUrl: r.jobUrl || undefined,
                label: title || 'CV đã tinh chỉnh (trang tuyển dụng)',
                status: 'done',
                jdData: (r.jd as unknown as JDData) || undefined,
                matchResult: r.match as unknown as MatchResult,
                optimizedCv: r.improved_cv,
                optimizedCvImprovements: r.improvements as CvImprovement[],
                optimizedCvSuggestions: r.suggestions as CvSuggestion[],
                jobTitle: title || undefined,
            });
        }
        // Save to history so a tailored job shows up under saved jobs.
        // addJobRecord persists to the server (public.applications, user-scoped)
        // and dedups by URL/title, so re-firing never appends a duplicate.
        const recId = `mode1-job-${r.source_ref || id}`;
        if (r.jobUrl || title) {
            addJobRecord({
                id: recId,
                jobTitle: title || 'Việc đã tinh chỉnh',
                company: '',
                jobUrl: r.jobUrl || '',
                siteName: hostnameOf(r.jobUrl || ''),
                overallScore: overall,
                timestamp: Date.now(),
                jdData: (r.jd as unknown as JDData) || undefined,
                matchResult: r.match as unknown as MatchResult,
                optimizedCv: r.improved_cv,
                status: 'saved',
            });
        }
        setSelectedJdId(id);
        setView('apply');
        setStep(3);
    }, [addJdEntry, addJobRecord, setSelectedJdId, setView, setStep]);

    // When a tailored CV arrives from the extension, go straight to the editor
    // instead of waiting on a manual click — the user tailored on a job board
    // and expects to land on the editable, downloadable CV. The banner is still
    // shown as a small confirmation toast (with one-click auto-apply); the user
    // is already in the editor behind it.
    useEffect(() => {
        const unsub = onMode1Result((r) => { setResult(r); openInEditor(r); });
        // Signal the extension that a consumer is live. If tailoring happened
        // while no app tab was open, the extension opened THIS tab and stashed
        // the result; the content script now replays it to us in response.
        window.postMessage({ type: 'JOBFIT_WEBAPP_READY' }, '*');
        return unsub;
    }, [openInEditor]);

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
        setStatus('📄 Đang tạo PDF từ CV đã tinh chỉnh…');
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
                <strong>✨ CV đã tinh chỉnh cho 1 việc</strong>
                <button
                    onClick={() => { setResult(null); setStatus(''); }}
                    style={{ background: 'transparent', border: 'none', color: '#a5b4fc', cursor: 'pointer', fontSize: 16 }}
                    aria-label="Đóng"
                >✕</button>
            </div>
            <div style={{ color: '#c7d2fe', marginBottom: 10 }}>
                {name}{score != null ? ` · độ phù hợp ${score}/100` : ''}{nChanges ? ` · ${nChanges} chỉnh sửa` : ''}
            </div>
            {/* Viewing is automatic now (the editor is already open behind this
                toast), so the banner just confirms + offers one-click apply. */}
            <button
                onClick={apply}
                disabled={applying}
                style={{
                    width: '100%', padding: '10px 14px', borderRadius: 10, border: 'none',
                    cursor: applying ? 'default' : 'pointer', fontWeight: 700,
                    background: applying ? '#4338ca' : 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: '#fff',
                }}
            >
                {applying ? '⏳…' : '🚀 Ứng tuyển'}
            </button>
            {status && <div style={{ marginTop: 8, fontSize: 12, color: '#c7d2fe' }}>{status}</div>}
        </div>
    );
}
