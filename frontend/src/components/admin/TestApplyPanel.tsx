'use client';

// Admin "Test apply" — one random ACTIVE job per company (each company = a
// distinct apply site), so the extension's auto-apply can be exercised against
// every ATS / apply form. Each row: "Mở" opens the apply URL; "Ứng tuyển" fires
// the SAME JOBFIT_AUTO_APPLY the app's single-apply uses (extension opens the
// job + auto-fills using the operator's synced profile/CV). "Random lại" re-rolls.
//
// NOTE: the extension's web-app relay (content-webapp.js) only injects on the
// prod origins (copoai.net / *.vercel.app), NOT localhost — so "Ứng tuyển" works
// when this page is opened on copoai.net/admin with the extension installed.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowSquareOut, ArrowsClockwise, TestTube, PaperPlaneTilt, CheckCircle, Warning } from '@phosphor-icons/react';
import { admin, type TestJob } from '@/lib/db';
import { useAppStore } from '@/store/useAppStore';
import { cvToExtensionProfile } from '@/lib/extension-profile';
import { buildCvPdfCache } from '@/lib/cv-pdf-cache';
import { isExtensionAvailable } from '@/lib/api';

type ApplyStatus = { state: 'sending' | 'opened' | 'error'; msg: string };

export default function TestApplyPanel() {
    const [jobs, setJobs] = useState<TestJob[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [ats, setAts] = useState('');
    const [extReady, setExtReady] = useState(false);
    const [applyState, setApplyState] = useState<Record<string, ApplyStatus>>({});
    const cvData = useAppStore((s) => s.cvData);

    const load = useCallback(async () => {
        setLoading(true); setError('');
        try {
            setJobs(await admin.testRandomJobs(500));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Không tải được danh sách job test');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    // The extension's content-webapp relay announces JOBFIT_EXTENSION_READY, but
    // the setter that stashes __jobfitExtensionId lives on the main app page — not
    // /admin. So listen here too, and reflect if it's already set.
    useEffect(() => {
        const handler = (e: MessageEvent) => {
            if (e.source !== window) return;
            if (e.data?.type === 'JOBFIT_EXTENSION_READY' && e.data?.extensionId) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).__jobfitExtensionId = e.data.extensionId;
                setExtReady(true);
            }
        };
        window.addEventListener('message', handler);
        if (isExtensionAvailable()) setExtReady(true);
        return () => window.removeEventListener('message', handler);
    }, []);

    const setStatus = (id: string, s: ApplyStatus) => setApplyState((m) => ({ ...m, [id]: s }));

    // Fire the same single-apply message the app uses (StepEditCv): the extension
    // opens the job URL and auto-fills with the operator's synced profile. Renders
    // the structured CV to a PDF and syncs it FIRST, so account-gated ATS that
    // upload a resume (Workday "Autofill with Resume") get a real file — without it
    // hasCV=false and the agent falls back to "Apply Manually".
    const apply = async (job: TestJob) => {
        if (!isExtensionAvailable()) {
            setStatus(job.job_id, { state: 'error', msg: 'Extension chưa sẵn sàng — mở trang này trên copoai.net, cài extension rồi F5.' });
            return;
        }
        if (!cvData) {
            setStatus(job.job_id, { state: 'error', msg: 'Chưa có CV — upload CV trong app trước để có hồ sơ điền form.' });
            return;
        }
        const profile = cvToExtensionProfile(cvData);

        // Render structured CV → PDF and sync into extension storage so hasCV=true
        // (Workday Autofill needs the file). Non-fatal: on render failure we still
        // fire a text-only apply.
        setStatus(job.job_id, { state: 'sending', msg: 'Đang tạo CV PDF…' });
        const { optimizedCvPdfBase64, optimizedCvFileName } = await buildCvPdfCache(cvData, { jobTitle: job.title });
        if (!optimizedCvPdfBase64) console.warn('[TestApply] CV PDF render/sync failed — applying text-only');

        setStatus(job.job_id, { state: 'sending', msg: 'Đang gửi lệnh ứng tuyển…' });
        try {
            const res = await new Promise<{ success?: boolean; error?: string }>((resolve, reject) => {
                const handler = (e: MessageEvent) => {
                    if (e.source !== window || e.data?.type !== 'JOBFIT_AUTO_APPLY_RESPONSE') return;
                    clearTimeout(t);
                    window.removeEventListener('message', handler);
                    resolve(e.data);
                };
                const t = setTimeout(() => {
                    window.removeEventListener('message', handler);
                    reject(new Error('Extension không phản hồi (timeout).'));
                }, 12000);
                window.addEventListener('message', handler);
                window.postMessage({
                    type: 'JOBFIT_AUTO_APPLY',
                    jobUrl: job.url,
                    profile,
                    cvFileBase64: optimizedCvPdfBase64,
                    cvFileName: optimizedCvFileName,
                }, '*');
            });
            if (res?.success) setStatus(job.job_id, { state: 'opened', msg: 'Tab đã mở — agent đang phân tích & điền form.' });
            else setStatus(job.job_id, { state: 'error', msg: res?.error || 'Extension báo lỗi không rõ.' });
        } catch (e) {
            setStatus(job.job_id, { state: 'error', msg: e instanceof Error ? e.message : 'Lỗi khi ứng tuyển.' });
        }
    };

    const atsOpts = useMemo(() => {
        const m = new Map<string, number>();
        for (const j of jobs) { const k = j.ats_type || 'khác'; m.set(k, (m.get(k) || 0) + 1); }
        return [...m.entries()].sort((a, b) => b[1] - a[1]);
    }, [jobs]);
    const visible = useMemo(
        () => jobs.filter((j) => !ats || (j.ats_type || 'khác') === ats),
        [jobs, ats],
    );

    const canApply = extReady && !!cvData;

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    <TestTube size={18} weight="duotone" /> Test auto-apply
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {loading ? 'Đang tải…' : `${jobs.length} site · ${atsOpts.length} ATS`}
                </span>
                <select
                    value={ats}
                    onChange={(e) => setAts(e.target.value)}
                    style={{
                        marginLeft: 'auto', padding: '7px 12px', borderRadius: 9,
                        border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
                        color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
                    }}
                >
                    <option value="">Tất cả ATS ({jobs.length})</option>
                    {atsOpts.map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
                </select>
                <button
                    className="btn-secondary"
                    onClick={load}
                    disabled={loading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', padding: '7px 12px' }}
                >
                    <ArrowsClockwise size={14} weight="bold" /> Random lại
                </button>
            </div>

            {/* Readiness banner: extension present? CV present? */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                padding: '10px 14px', marginBottom: 12, borderRadius: 12,
                border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', fontSize: '0.8rem',
            }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: extReady ? 'var(--accent-green, #22c55e)' : 'var(--accent-amber, #f59e0b)', fontWeight: 600 }}>
                    {extReady ? <CheckCircle size={15} weight="fill" /> : <Warning size={15} weight="fill" />}
                    Extension {extReady ? 'sẵn sàng' : 'chưa phát hiện (mở trên copoai.net)'}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: cvData ? 'var(--accent-green, #22c55e)' : 'var(--accent-amber, #f59e0b)', fontWeight: 600 }}>
                    {cvData ? <CheckCircle size={15} weight="fill" /> : <Warning size={15} weight="fill" />}
                    Hồ sơ {cvData ? `từ CV: ${cvData.name || 'đã có'}` : 'chưa có (upload CV trong app)'}
                </span>
                <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
                    “Ứng tuyển” = gọi extension thật (mở tab + tốn 1 credit như luồng app).
                </span>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 14 }}>
                Mỗi công ty (site) một job ngẫu nhiên đang còn hoạt động. <b>Ứng tuyển</b> để extension mở trang &amp;
                tự điền form (test từng loại ATS); <b>Mở</b> để xem trang thủ công. “Random lại” lấy bộ khác.
            </p>

            {error && <div style={{ color: 'var(--accent-red, #ef4444)', fontSize: '0.82rem', marginBottom: 12 }}>{error}</div>}

            {!loading && jobs.length === 0 && !error && (
                <div style={{
                    padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)',
                    border: '1px dashed var(--border-subtle)', borderRadius: 12, fontSize: '0.85rem',
                }}>
                    Chưa có job nào trong kho.
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visible.map((j) => {
                    const st = applyState[j.job_id];
                    return (
                        <div key={j.job_id} className="glass-card" style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <span style={{
                                    flexShrink: 0, fontSize: '0.64rem', fontWeight: 700, textTransform: 'uppercase',
                                    letterSpacing: '.04em', padding: '3px 8px', borderRadius: 999,
                                    background: 'var(--bg-elevated)', color: 'var(--text-secondary)', minWidth: 88, textAlign: 'center',
                                }}>
                                    {j.ats_type || 'khác'}
                                </span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {j.company || j.domain || '—'}
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {j.title}{j.location ? ` · ${j.location}` : ''}{j.domain ? ` · ${j.domain}` : ''}
                                    </div>
                                </div>
                                <a
                                    href={j.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn-secondary"
                                    style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', padding: '7px 12px', textDecoration: 'none' }}
                                >
                                    <ArrowSquareOut size={14} weight="bold" /> Mở
                                </a>
                                <button
                                    className="btn-primary"
                                    onClick={() => apply(j)}
                                    disabled={!canApply || st?.state === 'sending'}
                                    title={!extReady ? 'Extension chưa sẵn sàng' : !cvData ? 'Chưa có CV' : 'Gửi lệnh ứng tuyển tới extension'}
                                    style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', padding: '7px 13px', opacity: canApply ? 1 : 0.5 }}
                                >
                                    <PaperPlaneTilt size={14} weight="fill" /> {st?.state === 'sending' ? 'Đang gửi…' : 'Ứng tuyển'}
                                </button>
                            </div>
                            {st && (
                                <div style={{
                                    marginTop: 8, fontSize: '0.76rem', fontWeight: 500,
                                    color: st.state === 'error' ? 'var(--accent-red, #ef4444)'
                                        : st.state === 'opened' ? 'var(--accent-green, #22c55e)' : 'var(--text-muted)',
                                }}>
                                    {st.msg}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {ats && (
                <div style={{ marginTop: 10, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    Hiện {visible.length}/{jobs.length} site (lọc theo <b>{ats}</b>).
                </div>
            )}
        </div>
    );
}
