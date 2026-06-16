'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
    ArrowLeft, Sparkle, Warning, Briefcase,
    CheckCircle, FilePdf, FloppyDisk, CaretLeft, CaretRight,
    RocketLaunch, Lightning, CircleNotch,
    XCircle, Stop, CaretDown, CaretUp, ShieldWarning, ChartBar,
    ArrowsClockwise,
} from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import CvDocumentPreview from '@/components/CvDocumentPreview';
import EditableTemplateFrame from '@/components/EditableTemplateFrame';
import { applyCvFieldEdit } from '@/lib/cv-inline-edit';
import { diffCvChanges, type CvImprovement } from '@/lib/cv-improvements';
import CvTemplatePicker from '@/components/CvTemplatePicker';
import ScoreRing from '@/components/ScoreRing';
import { optimizeCvVariants, renderCvPdf } from '@/lib/api';
import type {
    CVData, JDData, MatchResult, CategoryScore,
    ContactInfo, PersonalInfo, EmploymentInfo, JobPreferences,
} from '@/lib/types';
import {
    EMPTY_CONTACT, EMPTY_PERSONAL, EMPTY_EMPLOYMENT, EMPTY_PREFERENCES,
} from '@/lib/types';
import { cvToExtensionProfile } from '@/lib/extension-profile';
import { syncProfileToExtension, syncCvFileToExtension } from '@/lib/extension-sync';
import { renderCvHtml, getTemplate, DEFAULT_TEMPLATE_ID } from '@/lib/cv-templates';
import type { CvTemplateId } from '@/lib/cv-templates';
import { resizeAvatarToDataUrl } from '@/lib/avatar';

type AutoApplyStatus = 'idle' | 'checking' | 'sending' | 'opened' | 'error' | 'no-extension';
type FullAutoStatus = 'idle' | 'rendering' | 'syncing' | 'launching' | 'error';

interface BatchJobStatus {
    jobUrl: string;
    jobTitle: string;
    company: string;
    status: 'pending' | 'processing' | 'done' | 'error';
    // outcome: 'submitted' = success signal seen after the agent acted;
    // 'filled' = form filled, tab left open for the user to review & submit.
    result?: { success: boolean; detail?: string; outcome?: 'submitted' | 'filled' | 'failed' };
}

interface BatchProgress {
    isProcessing: boolean;
    queue: BatchJobStatus[];
    currentIndex: number;
    total: number;
    completed: number;
    successful?: number;
    submitted?: number;
    filled?: number;
}

/**
 * Check if the JobFit AI extension is installed.
 * The extension's content-webapp.js posts JOBFIT_EXTENSION_READY on load.
 * We also listen for JOBFIT_AUTO_APPLY_RESPONSE.
 */
type JobfitWindow = Window & { __jobfitExtensionId?: string };

function isExtensionAvailable(): boolean {
    // Extension sets this on the window when content-webapp.js loads
    return !!(window as JobfitWindow).__jobfitExtensionId;
}

/* ─── HTML generation now lives in /lib/cv-templates — see renderCvHtml(cv, templateId) ─── */


/* ═══════════════════════════════════════════════════════════════════════════════
   MAIN: StepEditCv — Tab-based CV Viewer
   CV always visible, jobs as switchable tabs
   ═══════════════════════════════════════════════════════════════════════════════ */

export default function StepEditCv() {
    const {
        cvData, jdEntries, setStep, setCvData, updateJdEntry,
        fullyAutoMode, setFullyAutoMode,
        userAvatarBase64, setUserAvatar, selectedJdId,
    } = useAppStore();
    const fullAutoFiredRef = useRef(false);

    // All entries that have optimized CVs, sorted by score
    const sortedEntries = useMemo(() => {
        return [...jdEntries]
            .filter(e => e.optimizedCv)
            .sort((a, b) => (b.matchResult?.overall_score ?? 0) - (a.matchResult?.overall_score ?? 0));
    }, [jdEntries]);

    // Open on the job the user clicked through from the report (selectedJdId);
    // fall back to the top-scored CV when there's no selection or it has no
    // optimized CV yet.
    const [selectedIdx, setSelectedIdx] = useState(() => {
        const i = sortedEntries.findIndex(e => e.id === selectedJdId);
        return i >= 0 ? i : 0;
    });
    const [autoApplyStatus, setAutoApplyStatus] = useState<AutoApplyStatus>('idle');
    const [autoApplyMessage, setAutoApplyMessage] = useState('');

    // ── User-driven re-optimization ──
    // Free-text points the candidate wants emphasized; fed to the optimizer.
    const [reoptPoints, setReoptPoints] = useState('');
    const [reoptimizing, setReoptimizing] = useState(false);
    const [reoptimizeError, setReoptimizeError] = useState<string | null>(null);

    // ── Template / preview / avatar state ──
    // Preview mode and edit mode are mutually exclusive: while the template
    // preview is open, the editable document is hidden (display:none — still
    // mounted so in-progress edits survive). editedCv mirrors those edits
    // so the preview and downloads match what the user sees in the editor.
    // Defaults to preview: the optimized CV rendered in the chosen template
    // is what the user lands on; editing is the opt-in mode.
    const [livePreviewOpen, setLivePreviewOpen] = useState(true);
    const [editedCv, setEditedCv] = useState<CVData | null>(null);
    const handleEditedChange = useCallback((cv: CVData) => {
        setEditedCv(cv);
    }, []);
    const [avatarBusy, setAvatarBusy] = useState(false);
    const [avatarError, setAvatarError] = useState<string | null>(null);

    // ── Batch Apply State ──
    const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
    const [batchStarting, setBatchStarting] = useState(false);

    // ── Fully Autonomous Apply State ──
    const [fullAutoStatus, setFullAutoStatus] = useState<FullAutoStatus>('idle');
    const [fullAutoProgress, setFullAutoProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
    const [fullAutoError, setFullAutoError] = useState<string | null>(null);

    // Listen for extension announcement + progress updates
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            // Only trust messages this window posted to itself (the content script
            // relays via window.postMessage). Rejects spoofed cross-frame messages
            // that could plant a fake extension id or read the user's profile.
            if (event.source !== window) return;
            if (event.data?.type === 'JOBFIT_EXTENSION_READY' && event.data?.extensionId) {
                (window as JobfitWindow).__jobfitExtensionId = event.data.extensionId;
            }
            // Real-time progress updates from extension
            if (event.data?.type === 'JOBFIT_APPLY_PROGRESS') {
                setBatchProgress({
                    isProcessing: event.data.isProcessing,
                    queue: event.data.queue || [],
                    currentIndex: event.data.currentIndex ?? -1,
                    total: event.data.total ?? 0,
                    completed: event.data.completed ?? 0,
                    successful: event.data.successful ?? 0,
                    submitted: event.data.submitted ?? 0,
                    filled: event.data.filled ?? 0,
                });
                if (!event.data.isProcessing) {
                    setBatchStarting(false);
                }
            }
            // Response to batch start
            if (event.data?.type === 'JOBFIT_AUTO_APPLY_ALL_RESPONSE') {
                if (event.data.success) {
                    setBatchStarting(false);
                } else {
                    setBatchStarting(false);
                    setAutoApplyMessage(`Lỗi: ${event.data.error}`);
                }
            }
        };
        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, []);

    const currentEntry = sortedEntries[selectedIdx];
    const score = currentEntry?.matchResult?.overall_score ?? 0;

    // Switching jobs must show THAT job's optimized CV immediately — without
    // this, the previous entry's in-progress edits (editedCv) keep winning the
    // `editedCv ?? optimizedCv` fallback and every job looks identical.
    const currentEntryId = currentEntry?.id;
    useEffect(() => {
        setEditedCv(null);
        setReoptPoints('');
        setReoptimizeError(null);
    }, [currentEntryId]);

    // ATS keywords drawn from the JD must-have list (used by CvDocumentPreview to highlight)
    const atsKeywords = useMemo(
        () => (currentEntry?.jdData?.must_have ?? []).filter(Boolean),
        [currentEntry],
    );

    /* ─── Re-optimize this CV, folding in the candidate's own emphasis points ───
       Notes are sent to the optimizer as high-priority guidance; the prompt
       still forbids fabrication, so points are only honored where the source
       CV supports them. Invalidates the cached PDF + edits so the preview and
       download reflect the new version. */
    const handleReoptimize = useCallback(async () => {
        if (!currentEntry || !cvData || !currentEntry.jdData || !currentEntry.matchResult) return;
        setReoptimizing(true);
        setReoptimizeError(null);
        try {
            const data = await optimizeCvVariants(
                cvData,
                currentEntry.jdData,
                currentEntry.matchResult,
                { notes: reoptPoints.trim() || undefined, useGaps: true },
            );
            const variant = data.variants[0];
            if (!variant?.cv) throw new Error('Optimizer returned no CV');
            updateJdEntry(currentEntry.id, {
                optimizedCv: variant.cv,
                optimizedCvImprovements: variant.improvements,
                optimizedCvPdfBase64: undefined,
                optimizedCvFileName: undefined,
            });
            setEditedCv(null); // drop stale inline edits so the new version shows
        } catch (err) {
            setReoptimizeError(err instanceof Error ? err.message : 'Failed to re-optimize');
        } finally {
            setReoptimizing(false);
        }
    }, [currentEntry, cvData, reoptPoints, updateJdEntry]);

    /* ─── Inline edits made directly on the rendered template preview ───
       Committed into both editedCv (what the preview/download shows) and the
       entry's optimizedCv so the editable document view and the cached PDF
       stay in sync. */
    const handleTemplateFieldEdit = useCallback((path: string, text: string) => {
        if (!currentEntry?.optimizedCv) return;
        const base = editedCv ?? currentEntry.optimizedCv;
        const next = applyCvFieldEdit(base, path, text);
        if (next === base) return;
        setEditedCv(next);
        updateJdEntry(currentEntry.id, {
            optimizedCv: next,
            optimizedCvPdfBase64: undefined,
            optimizedCvFileName: undefined,
        });
    }, [currentEntry, editedCv, updateJdEntry]);

    const [downloadingPdf, setDownloadingPdf] = useState(false);
    const handleDownload = async (editedCv: CVData) => {
        if (downloadingPdf) return;
        setDownloadingPdf(true);
        try {
            const html = renderCvHtml(editedCv, currentEntry?.selectedTemplateId, {
                avatarBase64: userAvatarBase64 ?? undefined,
            });
            const filename = `${editedCv.name.replace(/\s+/g, '_')}_${(currentEntry.jobTitle || 'optimized').replace(/\s+/g, '_')}.pdf`;
            const { base64, filename: outName } = await renderCvPdf(html, filename);
            // base64 → Blob (PDF)
            const bin = atob(base64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const urlObj = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = urlObj;
            a.download = outName;
            a.click();
            URL.revokeObjectURL(urlObj);
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'PDF export failed';
            alert(`❌ Export PDF lỗi: ${msg}`);
        } finally {
            setDownloadingPdf(false);
        }
    };

    /* ─── Avatar upload ─── */
    const handleAvatarPick = useCallback(async (file: File | null) => {
        if (!file) return;
        setAvatarBusy(true);
        setAvatarError(null);
        try {
            const dataUrl = await resizeAvatarToDataUrl(file);
            setUserAvatar(dataUrl);
            // The cached PDFs no longer match the new avatar — invalidate
            // them so the next download (or batch-apply) re-renders.
            useAppStore.getState().jdEntries.forEach(e => {
                if (e.optimizedCvPdfBase64 || e.optimizedCvFileName) {
                    updateJdEntry(e.id, {
                        optimizedCvPdfBase64: undefined,
                        optimizedCvFileName: undefined,
                    });
                }
            });
        } catch (err) {
            setAvatarError(err instanceof Error ? err.message : 'Lỗi tải ảnh');
        } finally {
            setAvatarBusy(false);
        }
    }, [setUserAvatar, updateJdEntry]);

    /* ─── Build extension profile (23-field shape) from an optimized CV ───
       The personal-info fields (contact/personal/employment/preferences) are
       authored by the user against the base cvData via the Personal Info
       section, but per-job optimized variants don't necessarily carry them.
       Merge the base cvData's profile sub-objects in so every per-job push
       carries the same contact info, address, etc. */
    const buildProfile = useCallback((cv: CVData) => {
        const enrichedCv: CVData = cvData ? {
            ...cv,
            contact: cvData.contact ?? cv.contact,
            personal: cvData.personal ?? cv.personal,
            employment: cvData.employment ?? cv.employment,
            preferences: cvData.preferences ?? cv.preferences,
        } : cv;
        return cvToExtensionProfile(enrichedCv);
    }, [cvData]);

    /* ─── Auto-push profile to extension whenever cvData changes ───
       Debounced so a burst of edits in the Personal info section only emits
       one postMessage. Bypassed entirely if cvData is null. */
    useEffect(() => {
        if (!cvData) return;
        const handle = setTimeout(() => {
            const profile = cvToExtensionProfile(cvData);
            syncProfileToExtension(profile, cvData).then((res) => {
                if (!res.ok) console.warn('[JobFit] Auto-sync profile → extension failed:', res.error);
            });
        }, 500);
        return () => clearTimeout(handle);
    }, [cvData]);

    /* ─── Single Auto Apply (legacy) ─── */
    const triggerAutoApply = async () => {
        const cv = currentEntry?.optimizedCv;
        const jobUrl = currentEntry?.source;
        if (!cv || !jobUrl) {
            setAutoApplyStatus('error');
            setAutoApplyMessage('Thiếu dữ liệu CV hoặc Job URL.');
            return;
        }

        const profile = buildProfile(cv);

        setAutoApplyStatus('checking');
        setAutoApplyMessage('Đang kiểm tra Extension...');

        try {
            if (!isExtensionAvailable()) throw new Error('NO_EXTENSION');

            setAutoApplyStatus('sending');
            setAutoApplyMessage('Đang gửi lệnh Auto Apply...');

            const responsePromise = new Promise<{ success?: boolean; error?: string; detail?: string }>((resolve, reject) => {
                const handler = (event: MessageEvent) => {
                    if (event.source !== window) return;
                    if (event.data?.type === 'JOBFIT_AUTO_APPLY_RESPONSE') {
                        clearTimeout(timeout);
                        window.removeEventListener('message', handler);
                        resolve(event.data);
                    }
                };
                const timeout = setTimeout(() => {
                    window.removeEventListener('message', handler);
                    reject(new Error('Extension timeout'));
                }, 10000);
                window.addEventListener('message', handler);
            });

            window.postMessage({
                type: 'JOBFIT_AUTO_APPLY',
                jobUrl,
                profile,
                // Cached PDF from Optimize so the agent can satisfy required
                // CV-upload fields — without it every single apply runs hasCV=false.
                cvFileBase64: currentEntry?.optimizedCvPdfBase64,
                cvFileName: currentEntry?.optimizedCvFileName,
            }, '*');
            const response = await responsePromise;

            if (response?.success) {
                setAutoApplyStatus('opened');
                setAutoApplyMessage('✅ Tab đã mở! AI Agent đang tự động phân tích và điền form.');
                setTimeout(() => setAutoApplyStatus('idle'), 6000);
            } else {
                throw new Error(response?.error || 'Unknown error');
            }
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            if (message === 'NO_EXTENSION') {
                setAutoApplyStatus('no-extension');
                setAutoApplyMessage('Extension chưa cài. Đang mở trang apply...');
                window.open(jobUrl, '_blank');
            } else {
                setAutoApplyStatus('error');
                setAutoApplyMessage(`Lỗi: ${message}`);
            }
            setTimeout(() => setAutoApplyStatus('idle'), 5000);
        }
    };

    /* ═══════════════════════════════════════════════════════════════
       BATCH AUTO APPLY ALL — Send all jobs to extension at once
       ═══════════════════════════════════════════════════════════════ */
    const triggerAutoApplyAll = useCallback(() => {
        if (!isExtensionAvailable()) {
            setAutoApplyStatus('no-extension');
            setAutoApplyMessage('Extension chưa cài! Vui lòng cài JobFit AI Extension trước.');
            setTimeout(() => setAutoApplyStatus('idle'), 5000);
            return;
        }

        // Build jobs array from all optimized entries that have a source URL
        const jobs = sortedEntries
            .filter(e => e.optimizedCv && e.source)
            .map(entry => ({
                jobUrl: entry.source!,
                jobTitle: entry.jobTitle || 'Unknown',
                company: entry.company || entry.label || '',
                profile: buildProfile(entry.optimizedCv!),
            }));

        if (jobs.length === 0) {
            setAutoApplyMessage('Không có job nào có URL để apply.');
            return;
        }

        setBatchStarting(true);

        // Send batch command to extension
        window.postMessage({
            type: 'JOBFIT_AUTO_APPLY_ALL',
            jobs,
        }, '*');
    }, [sortedEntries, buildProfile]);

    /* ═══════════════════════════════════════════════════════════════
       FULLY AUTONOMOUS APPLY ALL — Generate PDFs + sync + launch batch
       1. Render every optimized CV → PDF via /api/render-cv-pdf
       2. Bundle profile + per-job cvFileBase64 + cvFileName into the batch
       3. Trigger AUTO_APPLY_ALL — extension opens each tab, writes the
          matching CV + profile into chrome.storage before agent runs.
       ═══════════════════════════════════════════════════════════════ */
    const triggerFullyAutoApply = useCallback(async () => {
        if (!isExtensionAvailable()) {
            setAutoApplyStatus('no-extension');
            setAutoApplyMessage('Extension chưa cài! Vui lòng cài JobFit AI Extension trước.');
            setTimeout(() => setAutoApplyStatus('idle'), 5000);
            return;
        }

        const candidates = sortedEntries.filter(e => e.optimizedCv && e.source);
        if (candidates.length === 0) {
            setFullAutoError('Không có job nào có CV optimize + URL.');
            setTimeout(() => setFullAutoError(null), 4000);
            return;
        }

        setFullAutoError(null);
        setFullAutoStatus('rendering');
        setFullAutoProgress({ done: 0, total: candidates.length });

        // 1. Render PDFs sequentially so the backend doesn't get hammered.
        const jobs: Array<{
            jobUrl: string;
            jobTitle: string;
            company: string;
            profile: ReturnType<typeof buildProfile>;
            cvFileBase64?: string;
            cvFileName?: string;
        }> = [];

        for (let i = 0; i < candidates.length; i++) {
            const entry = candidates[i];
            const cv = entry.optimizedCv!;
            try {
                // Use the PDF cached at Optimize time if available; only render on miss.
                let base64 = entry.optimizedCvPdfBase64;
                let outFilename = entry.optimizedCvFileName;
                if (!base64 || !outFilename) {
                    const html = renderCvHtml(cv, entry.selectedTemplateId, {
                        avatarBase64: userAvatarBase64 ?? undefined,
                    });
                    const safeTitle = (entry.jobTitle || 'job').replace(/\s+/g, '_').slice(0, 40);
                    const filename = `${cv.name.replace(/\s+/g, '_')}_${safeTitle}.pdf`;
                    const data = await renderCvPdf(html, filename);
                    base64 = data.base64;
                    outFilename = data.filename;
                }
                jobs.push({
                    jobUrl: entry.source!,
                    jobTitle: entry.jobTitle || 'Unknown',
                    company: entry.company || entry.label || '',
                    profile: buildProfile(cv),
                    cvFileBase64: base64,
                    cvFileName: outFilename,
                });
            } catch (err) {
                // Per-job render failure: include the job without a CV file
                // so the agent can still try to fill text fields.
                console.warn('[FullAuto] PDF render failed for', entry.jobTitle, err);
                jobs.push({
                    jobUrl: entry.source!,
                    jobTitle: entry.jobTitle || 'Unknown',
                    company: entry.company || entry.label || '',
                    profile: buildProfile(cv),
                });
            }
            setFullAutoProgress({ done: i + 1, total: candidates.length });
        }

        // 2. Hand off to the extension's existing batch path with embedded CV files.
        setFullAutoStatus('launching');
        setBatchStarting(true);
        window.postMessage({ type: 'JOBFIT_AUTO_APPLY_ALL', jobs }, '*');

        // Reset status after handoff — batch progress UI takes over from here.
        setTimeout(() => setFullAutoStatus('idle'), 1500);
    }, [sortedEntries, buildProfile, userAvatarBase64]);

    const cancelBatchApply = useCallback(() => {
        window.postMessage({ type: 'JOBFIT_AUTO_APPLY_CANCEL' }, '*');
        setBatchProgress(null);
        setBatchStarting(false);
    }, []);

    // ── Fully-auto handoff: when we land here in auto mode with optimized
    //    CVs already in place (from StepInputUrl's full_auto branch), fire
    //    the batch apply immediately and exit auto mode. Guarded against
    //    Strict-Mode double-mount + late hydration. ──
    useEffect(() => {
        if (!fullyAutoMode || fullAutoFiredRef.current) return;
        if (sortedEntries.length === 0) return;
        fullAutoFiredRef.current = true;
        triggerFullyAutoApply();
        setFullyAutoMode(false);
    }, [fullyAutoMode, sortedEntries, triggerFullyAutoApply, setFullyAutoMode]);

    const goPrev = () => setSelectedIdx(i => Math.max(0, i - 1));
    const goNext = () => setSelectedIdx(i => Math.min(sortedEntries.length - 1, i + 1));

    // Auto Apply button config based on status
    const autoApplyBtn = {
        idle: { label: 'Auto Apply', icon: <RocketLaunch size={14} weight="fill" />, disabled: false, bg: 'linear-gradient(135deg, #059669, #10B981)' },
        checking: { label: 'Kiểm tra...', icon: <CircleNotch size={14} className="spin" />, disabled: true, bg: 'linear-gradient(135deg, #6366f1, #818cf8)' },
        sending: { label: 'Đang gửi...', icon: <CircleNotch size={14} className="spin" />, disabled: true, bg: 'linear-gradient(135deg, #6366f1, #818cf8)' },
        opened: { label: 'Đã mở tab!', icon: <CheckCircle size={14} weight="fill" />, disabled: true, bg: 'linear-gradient(135deg, #059669, #34d399)' },
        error: { label: 'Lỗi', icon: <Warning size={14} />, disabled: true, bg: 'linear-gradient(135deg, #dc2626, #ef4444)' },
        'no-extension': { label: 'Cần Extension', icon: <Lightning size={14} />, disabled: true, bg: 'linear-gradient(135deg, #d97706, #f59e0b)' },
    }[autoApplyStatus];

    // Is batch running?
    const isBatchActive = batchStarting || (batchProgress?.isProcessing ?? false);
    const batchDone = batchProgress && !batchProgress.isProcessing && batchProgress.completed > 0;
    // Compute from the queue (not the top-level counters) so the panel stays
    // honest even with an older extension build that doesn't send outcome —
    // a 'done' without outcome was never verified as submitted.
    const batchSubmitted = batchProgress?.queue.filter(
        j => j.status === 'done' && j.result?.outcome === 'submitted').length ?? 0;
    const batchFilled = batchProgress?.queue.filter(
        j => j.status === 'done' && j.result?.outcome !== 'submitted').length ?? 0;
    const isFullAutoBusy = fullAutoStatus !== 'idle';

    // Empty state (placed AFTER all hooks to satisfy rules-of-hooks)
    if (!cvData || sortedEntries.length === 0 || !currentEntry) {
        return (
            <div className="animate-fade-in" style={{ maxWidth: 600, margin: '0 auto', padding: '60px 20px', textAlign: 'center' }}>
                <div style={{
                    width: 72, height: 72, borderRadius: 20,
                    background: 'var(--gradient-hero-subtle)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 24px',
                    border: '1px solid var(--border-subtle)',
                }}>
                    <FilePdf size={28} weight="duotone" style={{ color: 'var(--accent-blue)' }} />
                </div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: 8 }}>
                    No Optimized CVs Yet
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: 24, lineHeight: 1.6 }}>
                    No jobs have been analyzed and optimized yet. Go back to find jobs — each scored job is optimized automatically.
                </p>
                <button className="btn-secondary" onClick={() => setStep(2)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <ArrowLeft size={16} /> Back to Find Jobs
                </button>
            </div>
        );
    }

    return (
        <div className="animate-fade-in" style={{ maxWidth: 1440, margin: '0 auto', padding: '40px 20px' }}>

            {/* ── Header ── */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: (autoApplyStatus !== 'idle' || isBatchActive || batchDone) ? 8 : 20,
            }}>
                <div>
                    <h2 style={{
                        fontSize: '1.4rem', fontWeight: 700, marginBottom: 4,
                        display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                        <Sparkle size={22} weight="duotone" style={{ color: 'var(--accent-purple)' }} />
                        Optimized CVs
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                        {sortedEntries.length} CV{sortedEntries.length !== 1 ? 's' : ''} optimized — switch between jobs to view each version
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                        className="btn-secondary"
                        onClick={() => setStep(2)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}
                    >
                        <ArrowLeft size={14} /> Find Jobs
                    </button>
                    <button
                        className="btn-secondary"
                        onClick={async () => {
                            // Prefer the currently-selected optimized CV (with personal info edits
                            // applied via the Personal info section) — otherwise fall back to the
                            // base cvData so the extension still gets something.
                            const cv = currentEntry?.optimizedCv ?? cvData;
                            if (!cv) return;
                            const profile = buildProfile(cv);
                            navigator.clipboard.writeText(JSON.stringify(profile, null, 2)).catch(() => { });

                            // Wait for the extension's real ACK — a fire-and-forget
                            // postMessage shows "synced" even when nothing landed.
                            const profileRes = await syncProfileToExtension(profile, cv);
                            let cvFileMsg = '';
                            if (currentEntry?.optimizedCvPdfBase64 && currentEntry?.optimizedCvFileName) {
                                const fileRes = await syncCvFileToExtension(
                                    currentEntry.optimizedCvPdfBase64,
                                    currentEntry.optimizedCvFileName,
                                );
                                cvFileMsg = fileRes.ok
                                    ? '\n✅ File CV PDF đã sync.'
                                    : `\n⚠️ File CV PDF sync lỗi: ${fileRes.error}`;
                            } else {
                                cvFileMsg = '\nℹ️ Chưa có CV PDF cache — bấm Optimize để render trước.';
                            }
                            alert(profileRes.ok
                                ? `✅ Profile đã sync sang extension.${cvFileMsg}`
                                : `❌ Sync profile thất bại: ${profileRes.error}`);
                        }}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem',
                            background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
                            color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8,
                            cursor: 'pointer',
                        }}
                    >
                        ⚡ Resync to Extension
                    </button>

                    {/* ── Single Auto Apply Button ── */}
                    <button
                        onClick={triggerAutoApply}
                        disabled={autoApplyBtn.disabled || isBatchActive}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem',
                            background: autoApplyBtn.bg,
                            color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 8,
                            cursor: (autoApplyBtn.disabled || isBatchActive) ? 'not-allowed' : 'pointer',
                            opacity: (autoApplyBtn.disabled || isBatchActive) ? 0.7 : 1,
                            transition: 'all 0.2s ease',
                            fontWeight: 600,
                            boxShadow: autoApplyStatus === 'idle' ? '0 2px 12px rgba(5,150,105,0.3)' : 'none',
                        }}
                    >
                        {autoApplyBtn.icon} {autoApplyBtn.label}
                    </button>

                    {/* ── 🚀 AUTO APPLY ALL Button ── */}
                    {!isBatchActive ? (
                        <button
                            onClick={triggerAutoApplyAll}
                            disabled={batchStarting || sortedEntries.filter(e => e.source).length === 0}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem',
                                background: 'linear-gradient(135deg, #7C3AED, #EC4899)',
                                color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8,
                                cursor: batchStarting ? 'not-allowed' : 'pointer',
                                fontWeight: 700,
                                boxShadow: '0 2px 16px rgba(124,58,237,0.4)',
                                transition: 'all 0.2s ease',
                                opacity: batchStarting ? 0.7 : 1,
                            }}
                        >
                            {batchStarting
                                ? <><CircleNotch size={14} className="spin" /> Starting...</>
                                : <><RocketLaunch size={14} weight="fill" /> Auto Apply All ({sortedEntries.filter(e => e.source).length})</>
                            }
                        </button>
                    ) : (
                        <button
                            onClick={cancelBatchApply}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem',
                                background: 'linear-gradient(135deg, #dc2626, #ef4444)',
                                color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8,
                                cursor: 'pointer', fontWeight: 600,
                                transition: 'all 0.2s ease',
                            }}
                        >
                            <Stop size={14} weight="fill" /> Cancel Batch
                        </button>
                    )}

                    {/* ── 🤖 FULLY AUTONOMOUS APPLY — render PDFs + sync + launch ── */}
                    {!isBatchActive && (
                        <button
                            onClick={triggerFullyAutoApply}
                            disabled={isFullAutoBusy || sortedEntries.filter(e => e.optimizedCv && e.source).length === 0}
                            title="Tự render PDF từ CV optimize, đẩy sang extension, rồi launch Apply All — không cần upload thủ công."
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem',
                                background: 'linear-gradient(135deg, #f59e0b, #dc2626)',
                                color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 8,
                                cursor: isFullAutoBusy ? 'not-allowed' : 'pointer',
                                fontWeight: 700,
                                boxShadow: '0 2px 16px rgba(245,158,11,0.4)',
                                transition: 'all 0.2s ease',
                                opacity: isFullAutoBusy ? 0.7 : 1,
                            }}
                        >
                            {fullAutoStatus === 'rendering'
                                ? <><CircleNotch size={14} className="spin" /> Render PDF {fullAutoProgress.done}/{fullAutoProgress.total}</>
                                : fullAutoStatus === 'syncing'
                                    ? <><CircleNotch size={14} className="spin" /> Đang sync...</>
                                    : fullAutoStatus === 'launching'
                                        ? <><CircleNotch size={14} className="spin" /> Launching batch...</>
                                        : <><RocketLaunch size={14} weight="fill" /> Fully Auto Apply All</>
                            }
                        </button>
                    )}
                </div>
            </div>

            {/* ── Fully Auto error banner ── */}
            {fullAutoError && (
                <div style={{
                    background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 16px',
                    marginBottom: 16,
                    fontSize: '0.82rem',
                    color: '#ef4444',
                    display: 'flex', alignItems: 'center', gap: 8,
                }}>
                    <Warning size={14} /> {fullAutoError}
                </div>
            )}

            {/* ═══ Batch Apply Progress Panel ═══ */}
            {(isBatchActive || batchDone) && batchProgress && (
                <div style={{
                    background: 'linear-gradient(135deg, rgba(124,58,237,0.06), rgba(236,72,153,0.04))',
                    border: '1px solid rgba(124,58,237,0.2)',
                    borderRadius: 'var(--radius-md, 12px)',
                    padding: '16px 20px',
                    marginBottom: 16,
                    animation: 'fadeIn 0.3s ease',
                }}>
                    {/* Progress Header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {batchProgress.isProcessing
                                ? <CircleNotch size={16} className="spin" style={{ color: '#a78bfa' }} />
                                : <CheckCircle size={16} weight="fill" style={{ color: '#22c55e' }} />
                            }
                            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                {batchProgress.isProcessing
                                    ? `⚡ Batch Apply — ${batchProgress.completed}/${batchProgress.total} jobs`
                                    : `✅ Hoàn tất — ${batchSubmitted} đã nộp · ${batchFilled} đã điền (chờ bạn nộp)`
                                }
                            </span>
                        </div>
                        {/* Progress bar */}
                        <div style={{ width: 120, height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{
                                height: '100%',
                                width: `${batchProgress.total > 0 ? (batchProgress.completed / batchProgress.total) * 100 : 0}%`,
                                background: 'linear-gradient(90deg, #7c3aed, #ec4899)',
                                borderRadius: 3,
                                transition: 'width 0.5s ease',
                            }} />
                        </div>
                    </div>

                    {/* Agent never clicks Submit — filled tabs await the user */}
                    {batchDone && batchFilled > 0 && (
                        <p style={{
                            fontSize: '0.75rem', color: '#fbbf24', margin: '0 0 10px',
                            lineHeight: 1.5,
                        }}>
                            ⚠️ Agent không tự bấm Nộp. {batchFilled} tab đã điền form vẫn đang mở —
                            hãy kiểm tra thông tin và bấm nộp thủ công ở từng tab.
                        </p>
                    )}

                    {/* Job List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                        {batchProgress.queue.map((job, idx) => (
                            <div key={idx} style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '8px 12px',
                                background: job.status === 'processing'
                                    ? 'rgba(124,58,237,0.1)'
                                    : job.status === 'done'
                                        ? 'rgba(34,197,94,0.06)'
                                        : job.status === 'error'
                                            ? 'rgba(239,68,68,0.06)'
                                            : 'rgba(255,255,255,0.02)',
                                borderRadius: 8,
                                border: job.status === 'processing'
                                    ? '1px solid rgba(124,58,237,0.3)'
                                    : '1px solid rgba(255,255,255,0.05)',
                                transition: 'all 0.3s ease',
                            }}>
                                {/* Status icon */}
                                <div style={{ flexShrink: 0, width: 20, display: 'flex', justifyContent: 'center' }}>
                                    {job.status === 'pending' && <span style={{ opacity: 0.3, fontSize: '0.75rem' }}>⏳</span>}
                                    {job.status === 'processing' && <CircleNotch size={14} className="spin" style={{ color: '#a78bfa' }} />}
                                    {job.status === 'done' && <CheckCircle size={14} weight="fill" style={{ color: '#22c55e' }} />}
                                    {job.status === 'error' && <XCircle size={14} weight="fill" style={{ color: '#ef4444' }} />}
                                </div>

                                {/* Job info */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{
                                        fontSize: '0.8rem', fontWeight: 600,
                                        color: job.status === 'processing' ? '#a78bfa' : 'var(--text-primary)',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                        {job.jobTitle}
                                    </p>
                                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {job.company}
                                    </p>
                                </div>

                                {/* Status label */}
                                <span style={{
                                    fontSize: '0.65rem', fontWeight: 600, flexShrink: 0,
                                    padding: '2px 8px', borderRadius: 6,
                                    background: job.status === 'done' ? 'rgba(34,197,94,0.15)'
                                        : job.status === 'error' ? 'rgba(239,68,68,0.15)'
                                            : job.status === 'processing' ? 'rgba(124,58,237,0.15)'
                                                : 'rgba(255,255,255,0.05)',
                                    color: job.status === 'done' ? '#22c55e'
                                        : job.status === 'error' ? '#ef4444'
                                            : job.status === 'processing' ? '#a78bfa'
                                                : 'var(--text-muted)',
                                }}>
                                    {job.status === 'pending' && 'Chờ'}
                                    {job.status === 'processing' && 'Đang xử lý...'}
                                    {job.status === 'done' && (job.result?.outcome === 'submitted' ? 'Đã nộp' : 'Đã điền — chờ nộp')}
                                    {job.status === 'error' && (job.result?.detail || 'Lỗi')}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Close button when done */}
                    {batchDone && (
                        <button
                            onClick={() => setBatchProgress(null)}
                            style={{
                                marginTop: 12, padding: '6px 16px',
                                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 8, color: 'var(--text-secondary)', fontSize: '0.8rem',
                                cursor: 'pointer', fontFamily: 'inherit',
                            }}
                        >
                            Đóng
                        </button>
                    )}
                </div>
            )}

            {/* ── Single Auto Apply Status Bar ── */}
            {autoApplyStatus !== 'idle' && (
                <div style={{
                    background: autoApplyStatus === 'opened'
                        ? 'rgba(16,185,129,0.1)'
                        : autoApplyStatus === 'error' || autoApplyStatus === 'no-extension'
                            ? 'rgba(239,68,68,0.1)'
                            : 'rgba(99,102,241,0.1)',
                    border: `1px solid ${autoApplyStatus === 'opened'
                        ? 'rgba(16,185,129,0.3)'
                        : autoApplyStatus === 'error' || autoApplyStatus === 'no-extension'
                            ? 'rgba(239,68,68,0.3)'
                            : 'rgba(99,102,241,0.3)'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 16px',
                    marginBottom: 16,
                    fontSize: '0.82rem',
                    color: autoApplyStatus === 'opened'
                        ? '#10b981'
                        : autoApplyStatus === 'error' || autoApplyStatus === 'no-extension'
                            ? '#ef4444'
                            : '#818cf8',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    animation: 'fadeIn 0.2s ease',
                }}>
                    {(autoApplyStatus === 'checking' || autoApplyStatus === 'sending') && (
                        <CircleNotch size={14} className="spin" />
                    )}
                    {autoApplyStatus === 'opened' && <CheckCircle size={14} weight="fill" />}
                    {autoApplyStatus === 'error' && <Warning size={14} />}
                    {autoApplyStatus === 'no-extension' && <Lightning size={14} />}
                    <span>{autoApplyMessage}</span>
                    {autoApplyStatus === 'no-extension' && (
                        <span style={{ marginLeft: 'auto', fontSize: '0.75rem', opacity: 0.8 }}>
                            Đã mở link trong tab mới — cài Extension để auto-fill.
                        </span>
                    )}
                </div>
            )}

            {/* CSS for spin + fadeIn animation */}
            <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
                .spin { animation: spin 1s linear infinite; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
            `}
            </style>

            {/* ══════ Job Selector Tabs ══════ */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                marginBottom: 20, position: 'relative',
            }}>
                {/* Prev button */}
                {sortedEntries.length > 3 && (
                    <button
                        onClick={goPrev}
                        disabled={selectedIdx === 0}
                        style={{
                            width: 32, height: 32, borderRadius: 8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                            color: selectedIdx === 0 ? 'var(--text-muted)' : 'var(--text-primary)',
                            cursor: selectedIdx === 0 ? 'default' : 'pointer',
                            opacity: selectedIdx === 0 ? 0.4 : 1,
                            flexShrink: 0,
                        }}
                    >
                        <CaretLeft size={14} />
                    </button>
                )}

                {/* Tabs */}
                <div style={{
                    display: 'flex', gap: 6, flex: 1,
                    overflowX: 'auto', scrollbarWidth: 'none',
                    padding: '2px 0',
                }}>
                    {sortedEntries.map((entry, idx) => {
                        const isActive = idx === selectedIdx;
                        const entryScore = entry.matchResult?.overall_score ?? 0;
                        return (
                            <button
                                key={entry.id}
                                onClick={() => setSelectedIdx(idx)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '10px 16px',
                                    borderRadius: 'var(--radius-md)',
                                    border: isActive
                                        ? '1.5px solid var(--accent-blue)'
                                        : '1px solid var(--border-subtle)',
                                    background: isActive
                                        ? 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.04))'
                                        : 'var(--bg-card)',
                                    cursor: 'pointer',
                                    color: 'var(--text-primary)',
                                    transition: 'all 0.15s ease',
                                    minWidth: 0,
                                    flexShrink: 0,
                                    whiteSpace: 'nowrap',
                                    boxShadow: isActive ? '0 0 12px rgba(99,102,241,0.12)' : 'none',
                                }}
                            >
                                {/* Mini score */}
                                <ScoreRing score={entryScore} size={32} label="" />

                                <div style={{ textAlign: 'left', minWidth: 0 }}>
                                    <p style={{
                                        fontWeight: isActive ? 600 : 500,
                                        fontSize: '0.82rem',
                                        overflow: 'hidden', textOverflow: 'ellipsis',
                                        maxWidth: 180,
                                    }}>
                                        {entry.jobTitle || 'Unknown Position'}
                                    </p>
                                    <p style={{
                                        fontSize: '0.7rem',
                                        color: 'var(--text-muted)',
                                        overflow: 'hidden', textOverflow: 'ellipsis',
                                    }}>
                                        {entry.company || entry.label}
                                    </p>
                                    {entry.locationNote && (
                                        <span style={{
                                            display: 'inline-block', marginTop: 3,
                                            fontSize: '0.62rem', fontWeight: 600,
                                            padding: '1px 7px', borderRadius: 10,
                                            background: 'rgba(245,158,11,0.14)',
                                            color: '#f59e0b',
                                        }}>
                                            {entry.locationNote}
                                        </span>
                                    )}
                                </div>

                                {isActive && (
                                    <div style={{
                                        width: 6, height: 6, borderRadius: '50%',
                                        background: 'var(--accent-blue)',
                                        flexShrink: 0,
                                    }} />
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Next button */}
                {sortedEntries.length > 3 && (
                    <button
                        onClick={goNext}
                        disabled={selectedIdx === sortedEntries.length - 1}
                        style={{
                            width: 32, height: 32, borderRadius: 8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                            color: selectedIdx === sortedEntries.length - 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                            cursor: selectedIdx === sortedEntries.length - 1 ? 'default' : 'pointer',
                            opacity: selectedIdx === sortedEntries.length - 1 ? 0.4 : 1,
                            flexShrink: 0,
                        }}
                    >
                        <CaretRight size={14} />
                    </button>
                )}
            </div>

            {/* ══════ Current Job Context Card ══════ */}
            <div className="glass-card" style={{
                padding: '14px 20px', marginBottom: 16,
                display: 'flex', alignItems: 'center', gap: 16,
                background: 'linear-gradient(135deg, rgba(59,130,246,0.05), rgba(139,92,246,0.03))',
            }}>
                <ScoreRing score={score} size={48} label="" />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 2 }}>
                        {currentEntry.jobTitle || 'Unknown Position'}
                    </p>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {currentEntry.company && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <Briefcase size={11} /> {currentEntry.company}
                            </span>
                        )}
                        {currentEntry.company && <span style={{ opacity: 0.4 }}>·</span>}
                        <span>{currentEntry.label}</span>
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    {currentEntry.jdData?.domain && (
                        <span style={{
                            fontSize: '0.7rem', padding: '3px 10px', borderRadius: 12,
                            background: 'rgba(59,130,246,0.1)', color: 'var(--accent-blue)',
                        }}>{currentEntry.jdData.domain}</span>
                    )}
                    {currentEntry.jdData?.seniority_expected && (
                        <span style={{
                            fontSize: '0.7rem', padding: '3px 10px', borderRadius: 12,
                            background: 'rgba(139,92,246,0.1)', color: 'var(--accent-purple)',
                        }}>{currentEntry.jdData.seniority_expected}</span>
                    )}
                </div>
                {/* Navigation: x of y */}
                <div style={{
                    fontSize: '0.75rem', color: 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', gap: 8,
                    flexShrink: 0,
                }}>
                    <button
                        onClick={goPrev}
                        disabled={selectedIdx === 0}
                        style={{
                            background: 'none', border: 'none', cursor: selectedIdx === 0 ? 'default' : 'pointer',
                            color: selectedIdx === 0 ? 'var(--text-muted)' : 'var(--accent-blue)',
                            padding: 4, display: 'flex', opacity: selectedIdx === 0 ? 0.3 : 1,
                        }}
                    >
                        <CaretLeft size={14} weight="bold" />
                    </button>
                    <span style={{ fontWeight: 600 }}>{selectedIdx + 1} / {sortedEntries.length}</span>
                    <button
                        onClick={goNext}
                        disabled={selectedIdx === sortedEntries.length - 1}
                        style={{
                            background: 'none', border: 'none',
                            cursor: selectedIdx === sortedEntries.length - 1 ? 'default' : 'pointer',
                            color: selectedIdx === sortedEntries.length - 1 ? 'var(--text-muted)' : 'var(--accent-blue)',
                            padding: 4, display: 'flex',
                            opacity: selectedIdx === sortedEntries.length - 1 ? 0.3 : 1,
                        }}
                    >
                        <CaretRight size={14} weight="bold" />
                    </button>
                </div>
            </div>

            {/* ══════ Two-column workspace: CV editor (left) · job match analysis (right) ══════ */}
            <div className="editor-layout">
            {/* ───────────────────────── LEFT: CV editor ───────────────────────── */}
            <div style={{ minWidth: 0 }}>

            {/* ══════ AI Disclaimer ══════ */}
            <div style={{
                background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
                borderRadius: 'var(--radius-sm)', padding: '8px 14px', marginBottom: 12,
                fontSize: '0.78rem', color: 'var(--accent-amber)',
                display: 'flex', alignItems: 'center', gap: 6,
            }}>
                <Warning size={12} />
                AI-optimized for &quot;{currentEntry.jobTitle || 'this position'}&quot; — Click any text to edit, hover items to reorder/remove
            </div>

            {/* ══════ Personal Info — pre-filled from CV, editable, auto-synced ══════ */}
            <PersonalInfoSection cv={cvData} onChange={setCvData} />

            {/* ══════ Re-optimize with the candidate's own points ══════ */}
            <div className="glass-card" style={{ marginBottom: 12, padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Sparkle size={14} weight="duotone" style={{ color: 'var(--accent-purple)' }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Tinh chỉnh thêm theo ý bạn</span>
                </div>
                <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', margin: '0 0 8px', lineHeight: 1.5 }}>
                    Nhập những điểm bạn muốn nhấn mạnh hoặc bổ sung (dựa trên kinh nghiệm thật của bạn).
                    AI sẽ viết lại CV cho job này theo các điểm đó — không bịa thêm thông tin không có trong CV.
                </p>
                <textarea
                    value={reoptPoints}
                    onChange={(e) => setReoptPoints(e.target.value)}
                    placeholder="VD: Nhấn mạnh kinh nghiệm chăm sóc khách hàng B2B; nêu rõ từng dẫn dắt nhóm 5 người; ưu tiên kỹ năng giao tiếp tiếng Anh…"
                    rows={3}
                    maxLength={2000}
                    disabled={reoptimizing}
                    style={{
                        width: '100%', resize: 'vertical', padding: '8px 10px', borderRadius: 6,
                        background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)', fontSize: '0.82rem', fontFamily: 'inherit', lineHeight: 1.5,
                    }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Để trống = tối ưu lại theo JD như mặc định.
                    </span>
                    <button
                        onClick={() => void handleReoptimize()}
                        disabled={reoptimizing}
                        className="btn-primary"
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem',
                            padding: '8px 18px', opacity: reoptimizing ? 0.6 : 1,
                        }}
                    >
                        {reoptimizing
                            ? <><CircleNotch size={13} className="spin" /> Đang tối ưu lại…</>
                            : <><ArrowsClockwise size={13} weight="bold" /> Tối ưu lại CV</>}
                    </button>
                </div>
                {reoptimizeError && (
                    <div style={{
                        marginTop: 8, padding: '6px 10px', borderRadius: 6,
                        background: 'rgba(239,68,68,0.08)', color: '#ef4444',
                        fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <Warning size={12} /> {reoptimizeError}
                    </div>
                )}
            </div>

            {/* ══════ Template Picker + Avatar + Live Preview ══════ */}
            <div style={{ marginBottom: 12, padding: 12, background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 10 }}>
                    {/* Avatar uploader — only for templates that have an image holder */}
                    {getTemplate(currentEntry.selectedTemplateId).hasPhoto ? (
                        <div style={{ flex: '0 0 auto', textAlign: 'center' }}>
                            <div style={{
                                fontSize: '0.72rem', fontWeight: 600,
                                color: 'var(--text-secondary)', marginBottom: 6,
                            }}>
                                Ảnh đại diện
                            </div>
                            <label style={{
                                display: 'block', width: 64, height: 64, borderRadius: '50%',
                                cursor: avatarBusy ? 'wait' : 'pointer',
                                border: '2px dashed var(--border-subtle)',
                                background: userAvatarBase64
                                    ? `center/cover no-repeat url(${userAvatarBase64})`
                                    : 'var(--bg-card)',
                                position: 'relative', overflow: 'hidden',
                                transition: 'border-color 0.15s ease',
                            }}>
                                {!userAvatarBase64 && (
                                    <span style={{
                                        position: 'absolute', inset: 0,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: '0.7rem', color: 'var(--text-muted)',
                                    }}>
                                        {avatarBusy ? '...' : 'Tải lên'}
                                    </span>
                                )}
                                <input
                                    type="file"
                                    accept="image/*"
                                    disabled={avatarBusy}
                                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'inherit' }}
                                    onChange={(e) => {
                                        const f = e.target.files?.[0] ?? null;
                                        void handleAvatarPick(f);
                                        e.target.value = '';
                                    }}
                                />
                            </label>
                            {userAvatarBase64 && (
                                <button
                                    onClick={() => setUserAvatar(null)}
                                    type="button"
                                    style={{
                                        marginTop: 4, fontSize: '0.68rem',
                                        background: 'none', border: 'none',
                                        color: 'var(--accent-red)', cursor: 'pointer',
                                    }}
                                >
                                    Xoá
                                </button>
                            )}
                        </div>
                    ) : (
                        <div style={{ flex: '0 0 auto', textAlign: 'center', maxWidth: 90 }}>
                            <div style={{
                                fontSize: '0.72rem', fontWeight: 600,
                                color: 'var(--text-secondary)', marginBottom: 6,
                            }}>
                                Ảnh đại diện
                            </div>
                            <div style={{
                                fontSize: '0.66rem', color: 'var(--text-muted)',
                                lineHeight: 1.4,
                            }}>
                                Mẫu này không có ô ảnh
                            </div>
                        </div>
                    )}

                    {/* Template picker */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                            fontSize: '0.78rem', fontWeight: 600,
                            color: 'var(--text-secondary)', marginBottom: 6,
                            display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                            <span>Mẫu CV</span>
                            <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.72rem' }}>
                                — chọn mẫu trước khi tải xuống
                            </span>
                        </div>
                        <CvTemplatePicker
                            selected={currentEntry.selectedTemplateId ?? DEFAULT_TEMPLATE_ID}
                            onSelect={(id: CvTemplateId) => {
                                updateJdEntry(currentEntry.id, {
                                    selectedTemplateId: id,
                                    optimizedCvPdfBase64: undefined,
                                    optimizedCvFileName: undefined,
                                });
                                // Picking a template implies the user wants to
                                // see the CV in that template — switch to preview.
                                setLivePreviewOpen(true);
                            }}
                        />
                    </div>
                </div>

                {avatarError && (
                    <div style={{
                        fontSize: '0.74rem', color: 'var(--accent-red)',
                        marginBottom: 8, padding: '4px 8px',
                        background: 'rgba(239,68,68,0.06)', borderRadius: 4,
                    }}>
                        {avatarError}
                    </div>
                )}

                {/* Preview/edit mode switch — only one CV is visible at a time */}
                <button
                    type="button"
                    onClick={() => setLivePreviewOpen(v => !v)}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: 'none', border: 'none',
                        color: 'var(--text-secondary)', fontSize: '0.78rem',
                        fontWeight: 600, cursor: 'pointer', padding: '4px 0',
                    }}
                >
                    {livePreviewOpen ? <CaretLeft size={12} style={{ transform: 'rotate(-90deg)' }} /> : <CaretRight size={12} style={{ transform: 'rotate(90deg)' }} />}
                    {livePreviewOpen ? 'Quay lại chỉnh sửa nội dung' : 'Xem trước mẫu đã chọn'}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.72rem' }}>
                        {livePreviewOpen
                            ? '— CV đang hiển thị đúng theo mẫu sẽ xuất PDF'
                            : '— xem CV render theo mẫu trước khi tải xuống'}
                    </span>
                </button>

                {livePreviewOpen && (
                    <>
                        <div style={{
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'flex-end', gap: 8, marginTop: 8,
                        }}>
                            <button
                                onClick={() => void handleDownload(editedCv ?? currentEntry.optimizedCv!)}
                                disabled={downloadingPdf}
                                className="btn-primary"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 5,
                                    padding: '8px 20px', fontSize: '0.82rem',
                                    opacity: downloadingPdf ? 0.6 : 1,
                                }}
                            >
                                <FloppyDisk size={14} weight="fill" />
                                {downloadingPdf ? 'Đang xuất PDF…' : 'Save & Download'}
                            </button>
                        </div>
                        <div style={{
                            marginTop: 8, fontSize: '0.74rem', color: 'var(--text-muted)',
                        }}>
                            ✏️ Click vào nội dung trên CV để sửa trực tiếp — Enter để lưu, Esc để huỷ.
                        </div>
                        <div style={{
                            marginTop: 8, border: '1px solid var(--border-subtle)',
                            borderRadius: 6, overflow: 'hidden', background: '#fff',
                        }}>
                            <EditableTemplateFrame
                                key={`${currentEntry.id}-${currentEntry.selectedTemplateId ?? DEFAULT_TEMPLATE_ID}-${userAvatarBase64?.length ?? 0}`}
                                html={renderCvHtml(
                                    editedCv ?? currentEntry.optimizedCv!,
                                    currentEntry.selectedTemplateId,
                                    { avatarBase64: userAvatarBase64 ?? undefined },
                                )}
                                onFieldEdit={handleTemplateFieldEdit}
                                height={900}
                            />
                        </div>
                    </>
                )}
            </div>

            {/* ══════ Editable CV document — hidden (not unmounted, so edits
                 survive) while the template preview above is open ══════ */}
            <div style={{ display: livePreviewOpen ? 'none' : undefined }}>
                <CvDocumentPreview
                    key={currentEntry.id}
                    originalCv={cvData}
                    optimizedCv={currentEntry.optimizedCv!}
                    onSave={handleDownload}
                    onEditedChange={handleEditedChange}
                    keywords={atsKeywords}
                />
            </div>

            </div>{/* ───────── /LEFT ───────── */}

            {/* ──────────────────── RIGHT: job match analysis ──────────────────── */}
            <aside className="analysis-sidebar">
                <MatchAnalysisPanel
                    jd={currentEntry.jdData}
                    m={currentEntry.matchResult}
                    cvData={cvData}
                />
                {/* What the optimizer changed for THIS job — and an honest
                    warning when the content is still identical to the base CV */}
                <ImprovementsPanel
                    originalCv={cvData}
                    optimizedCv={editedCv ?? currentEntry.optimizedCv!}
                    improvements={currentEntry.optimizedCvImprovements}
                    jobTitle={currentEntry.jobTitle || currentEntry.company || currentEntry.label}
                />
            </aside>

            </div>{/* ───────── /editor-layout ───────── */}

            {/* Hide scrollbar for tabs + two-column responsive layout */}
            <style>{`
                div::-webkit-scrollbar { display: none; }
                .editor-layout {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) 360px;
                    gap: 20px;
                    align-items: start;
                }
                .analysis-sidebar {
                    position: sticky;
                    top: 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                @media (max-width: 1100px) {
                    .editor-layout { grid-template-columns: 1fr; }
                    .analysis-sidebar { position: static; }
                }
            `}</style>
        </div>
    );
}

/* ─── Improvements panel — explains what was tailored for the current job ───
   Primary source: the optimizer's own change list (optimizedCvImprovements).
   Ground truth: a deterministic diff vs the base CV — when that diff is empty
   the CV was NOT actually tailored, and the panel says so instead of letting
   identical content masquerade as "optimized". */
function ImprovementsPanel({
    originalCv, optimizedCv, improvements, jobTitle,
}: {
    originalCv: CVData;
    optimizedCv: CVData;
    improvements?: CvImprovement[];
    jobTitle?: string;
}) {
    const [open, setOpen] = useState(true);
    const diff = useMemo(
        () => diffCvChanges(originalCv, optimizedCv),
        [originalCv, optimizedCv],
    );
    const unchanged = diff.length === 0;
    const hasLlmExplanation = !unchanged && (improvements?.length ?? 0) > 0;

    return (
        <div style={{
            marginBottom: 10, borderRadius: 8,
            border: `1px solid ${unchanged ? 'rgba(245,158,11,0.45)' : 'var(--border-subtle)'}`,
            background: unchanged ? 'rgba(245,158,11,0.06)' : 'var(--bg-secondary)',
        }}>
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '10px 12px', textAlign: 'left',
                }}
            >
                {unchanged
                    ? <Warning size={15} weight="fill" style={{ color: '#f59e0b', flexShrink: 0 }} />
                    : <Sparkle size={15} weight="fill" style={{ color: 'var(--accent-blue)', flexShrink: 0 }} />}
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>
                    {unchanged
                        ? 'CV này chưa được tinh chỉnh theo job — nội dung giống hệt CV gốc'
                        : `Đã tối ưu cho ${jobTitle || 'job này'}`}
                    {!unchanged && (
                        <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6, fontSize: '0.72rem' }}>
                            {hasLlmExplanation ? `${improvements!.length} thay đổi` : `${diff.length} thay đổi`}
                        </span>
                    )}
                </span>
                <CaretRight size={12} style={{
                    color: 'var(--text-muted)', flexShrink: 0,
                    transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s',
                }} />
            </button>

            {open && (
                <div style={{ padding: '0 12px 12px 35px' }}>
                    {unchanged ? (
                        <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
                            Bản tối ưu tự động chưa tạo ra khác biệt nào so với CV gốc
                            (hoặc đã bị chỉnh tay về như cũ) — nội dung đang giống CV gốc.
                        </p>
                    ) : hasLlmExplanation ? (
                        <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {improvements!.map((imp, i) => (
                                <li key={i} style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{imp.section}: </span>
                                    {imp.change}
                                    {imp.reason && (
                                        <span style={{ color: 'var(--text-muted)' }}> — {imp.reason}</span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <>
                            <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {diff.map((line, i) => (
                                    <li key={i} style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                                        {line}
                                    </li>
                                ))}
                            </ul>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 6 }}>
                                So sánh tự động với CV gốc.
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

/* ─── Match analysis panel — Must-Have coverage, scoring breakdown, risk flags
   and strength summary. Mirrors what used to live on the standalone report
   page; now docked to the right of the editor. */
function MatchAnalysisPanel({
    jd, m, cvData,
}: {
    jd?: JDData;
    m?: MatchResult;
    cvData: CVData;
}) {
    const cvSkillsLower = useMemo(
        () => (cvData.skills || []).map(s => s.toLowerCase()),
        [cvData.skills],
    );

    if (!jd || !m) return null;

    const mustHave = jd.must_have ?? [];
    const aligned = mustHave.filter(sk =>
        cvSkillsLower.some(cs => cs.includes(sk.toLowerCase()) || sk.toLowerCase().includes(cs)));
    const missing = mustHave.filter(sk =>
        !cvSkillsLower.some(cs => cs.includes(sk.toLowerCase()) || sk.toLowerCase().includes(cs)));

    return (
        <div className="glass-card" style={{ padding: '16px 18px' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: '0 0 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <ChartBar size={16} weight="duotone" style={{ color: 'var(--accent-blue)' }} />
                Job Match
            </h3>

            {/* ── Must-Have coverage ── */}
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Must-Have ({aligned.length}/{mustHave.length} matched)
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
                {aligned.map((s, i) => (
                    <span key={`a-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: 'var(--accent-green)' }}>
                        <CheckCircle size={10} /> {s}
                    </span>
                ))}
                {missing.map((s, i) => (
                    <span key={`m-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, fontSize: '0.72rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--accent-red)' }}>
                        <XCircle size={10} /> {s}
                    </span>
                ))}
                {mustHave.length === 0 && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Không có yêu cầu bắt buộc rõ ràng.</span>
                )}
            </div>

            {/* ── Scoring breakdown ── */}
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Scoring Breakdown
            </p>
            <CategoryRow label="Must-Have Skills (40%)" data={m.must_have_match} />
            <CategoryRow label="Experience (25%)" data={m.experience_match} />
            <CategoryRow label="Domain (15%)" data={m.domain_match} />
            <CategoryRow label="Seniority (10%)" data={m.seniority_match} />
            <CategoryRow label="Nice-to-Have (10%)" data={m.nice_to_have_match} />

            {/* ── Risk flags ── */}
            {(m.risk_flags || []).length > 0 && (
                <div style={{ marginTop: 16 }}>
                    <p style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--accent-red)', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ShieldWarning size={13} /> Risk Flags
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {m.risk_flags.map((flag, i) => (
                            <span key={i} style={{ padding: '6px 10px', borderRadius: 6, fontSize: '0.74rem', background: 'rgba(239,68,68,0.06)', color: 'var(--text-secondary)', lineHeight: 1.45, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                                <Warning size={12} style={{ color: 'var(--accent-amber)', marginTop: 2, flexShrink: 0 }} /> {flag}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Strength summary ── */}
            {m.strength_summary && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '16px 0 0' }}>
                    {m.strength_summary}
                </p>
            )}
        </div>
    );
}

/* ─── Collapsible scoring-category row (score chip → reasoning + gaps) ─── */
function categoryColor(score: number) {
    if (score >= 80) return 'var(--accent-green)';
    if (score >= 60) return 'var(--accent-cyan)';
    if (score >= 40) return 'var(--accent-amber)';
    return 'var(--accent-red)';
}

function CategoryRow({ label, data }: { label: string; data: CategoryScore }) {
    const [open, setOpen] = useState(false);
    const color = categoryColor(data.score);
    return (
        <>
            <button
                onClick={() => setOpen(o => !o)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 0', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '0.8rem' }}
            >
                <span style={{ width: 28, height: 28, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.75rem', background: `${color}18`, color }}>
                    {data.score}
                </span>
                <span style={{ flex: 1, textAlign: 'left', fontWeight: 500 }}>{label}</span>
                {open ? <CaretUp size={12} /> : <CaretDown size={12} />}
            </button>
            {open && (
                <div style={{ padding: '6px 0 10px 36px', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <p>{data.reasoning}</p>
                    {(data.gaps?.length || 0) > 0 && (
                        <div style={{ marginTop: 6 }}>
                            {data.gaps.map((g, i) => (
                                <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'flex-start', marginBottom: 2 }}>
                                    <XCircle size={11} style={{ color: 'var(--accent-red)', marginTop: 2, flexShrink: 0 }} />
                                    <span>{g}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </>
    );
}

/* ─── Personal Info section — editable contact/personal/employment/preferences ───
   These fields are pre-filled by the LLM extractor when the CV is parsed and
   are pushed to the extension automatically via the auto-push effect above. */
function PersonalInfoSection({
    cv, onChange,
}: {
    cv: CVData;
    onChange: (updated: CVData) => void;
}) {
    const [open, setOpen] = useState(true);

    const contact: ContactInfo = { ...EMPTY_CONTACT, ...(cv.contact ?? {}) };
    const personal: PersonalInfo = { ...EMPTY_PERSONAL, ...(cv.personal ?? {}) };
    const employment: EmploymentInfo = { ...EMPTY_EMPLOYMENT, ...(cv.employment ?? {}) };
    const preferences: JobPreferences = { ...EMPTY_PREFERENCES, ...(cv.preferences ?? {}) };

    const patchContact = (patch: Partial<ContactInfo>) =>
        onChange({ ...cv, contact: { ...contact, ...patch } });
    const patchPersonal = (patch: Partial<PersonalInfo>) =>
        onChange({ ...cv, personal: { ...personal, ...patch } });
    const patchEmployment = (patch: Partial<EmploymentInfo>) =>
        onChange({ ...cv, employment: { ...employment, ...patch } });
    const patchPreferences = (patch: Partial<JobPreferences>) =>
        onChange({ ...cv, preferences: { ...preferences, ...patch } });

    const fillCount = [
        contact.email, contact.phone, contact.address_province,
        personal.date_of_birth, personal.gender,
        employment.current_title, employment.current_salary,
        preferences.desired_locations,
    ].filter(Boolean).length;

    return (
        <div className="glass-card" style={{
            marginBottom: 12, padding: open ? '14px 18px' : '10px 14px',
            transition: 'padding 0.15s',
        }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 600,
                    padding: 0,
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Briefcase size={14} weight="duotone" style={{ color: 'var(--accent-blue)' }} />
                    Personal Info
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.78rem' }}>
                        {fillCount} / 8 key fields filled · auto-synced to extension
                    </span>
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                    {open ? '▾' : '▸'}
                </span>
            </button>
            {open && (
                <div style={{
                    marginTop: 14, display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10,
                }}>
                    {/* ── Contact ── */}
                    <ProfileInput label="Email" value={contact.email}
                        onChange={(v) => patchContact({ email: v })} placeholder="you@example.com" />
                    <ProfileInput label="Phone" value={contact.phone}
                        onChange={(v) => patchContact({ phone: v })} placeholder="+84 …" />
                    <ProfileInput label="LinkedIn" value={contact.linkedin}
                        onChange={(v) => patchContact({ linkedin: v })} placeholder="linkedin.com/in/…" />
                    <ProfileInput label="GitHub" value={contact.github}
                        onChange={(v) => patchContact({ github: v })} placeholder="github.com/…" />
                    <ProfileInput label="Portfolio" value={contact.portfolio}
                        onChange={(v) => patchContact({ portfolio: v })} placeholder="https://…" />
                    <ProfileInput label="Province / City" value={contact.address_province}
                        onChange={(v) => patchContact({ address_province: v })} />
                    <ProfileInput label="District / Ward" value={contact.address_district}
                        onChange={(v) => patchContact({ address_district: v })} />
                    <ProfileInput label="Street" value={contact.address_street}
                        onChange={(v) => patchContact({ address_street: v })} />

                    {/* ── Personal ── */}
                    <ProfileInput label="Date of birth" value={personal.date_of_birth}
                        onChange={(v) => patchPersonal({ date_of_birth: v })} placeholder="YYYY-MM-DD" />
                    <ProfileInput label="Gender" value={personal.gender}
                        onChange={(v) => patchPersonal({ gender: v })} />
                    <ProfileInput label="Nationality" value={personal.nationality}
                        onChange={(v) => patchPersonal({ nationality: v })} />
                    <ProfileInput label="Marital status" value={personal.marital_status}
                        onChange={(v) => patchPersonal({ marital_status: v })} />

                    {/* ── Employment ── */}
                    <ProfileInput label="Current title" value={employment.current_title}
                        onChange={(v) => patchEmployment({ current_title: v })} />
                    <ProfileInput label="Current company" value={employment.current_company}
                        onChange={(v) => patchEmployment({ current_company: v })} />
                    <ProfileInput label="Current level" value={employment.current_level}
                        onChange={(v) => patchEmployment({ current_level: v })} placeholder="Junior / Mid / Senior" />
                    <ProfileInput label="Current industry" value={employment.current_industry}
                        onChange={(v) => patchEmployment({ current_industry: v })} />
                    <ProfileInput label="Current fields" value={employment.current_fields}
                        onChange={(v) => patchEmployment({ current_fields: v })} placeholder="Backend, Data, Product…" />
                    <ProfileInput label="Current salary" value={employment.current_salary}
                        onChange={(v) => patchEmployment({ current_salary: v })} />
                    <ProfileInput label="Years of experience" value={String(employment.years_of_experience || '')}
                        onChange={(v) => patchEmployment({ years_of_experience: parseInt(v, 10) || 0 })} />
                    <ProfileInput label="Highest degree" value={employment.highest_degree}
                        onChange={(v) => patchEmployment({ highest_degree: v })} />

                    {/* ── Preferences ── */}
                    <ProfileInput label="Desired locations" value={preferences.desired_locations}
                        onChange={(v) => patchPreferences({ desired_locations: v })} />
                    <ProfileInput label="Desired salary" value={preferences.desired_salary}
                        onChange={(v) => patchPreferences({ desired_salary: v })} />
                </div>
            )}
        </div>
    );
}

function ProfileInput({
    label, value, onChange, placeholder,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}) {
    return (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {label}
            </span>
            <input
                type="text"
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                style={{
                    padding: '6px 10px', borderRadius: 6,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)', fontSize: '0.82rem',
                    fontFamily: 'inherit',
                }}
            />
        </label>
    );
}

