'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
    Sparkle, Warning, FloppyDisk, CaretLeft, CaretRight,
    UploadSimple, FileText, SpinnerGap, CircleNotch,
} from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import CvDocumentPreview from '@/components/CvDocumentPreview';
import EditableTemplateFrame from '@/components/EditableTemplateFrame';
import CvTemplatePicker from '@/components/CvTemplatePicker';
import { PersonalInfoSection } from '@/components/steps/StepEditCv';
import { applyCvFieldEdit } from '@/lib/cv-inline-edit';
import { parsePdfWithAI, renderCvPdf } from '@/lib/api';
import { renderCvHtml, getTemplate, DEFAULT_TEMPLATE_ID } from '@/lib/cv-templates';
import type { CvTemplateId } from '@/lib/cv-templates';
import type { CVData } from '@/lib/types';
import { resizeAvatarToDataUrl } from '@/lib/avatar';
import { cvToExtensionProfile } from '@/lib/extension-profile';
import { syncProfileToExtension, syncCvDataToExtension } from '@/lib/extension-sync';

/* ═══════════════════════════════════════════════════════════════════════════════
   STANDALONE CV EDITOR — a single, self-contained feature.

   Mirrors the CV-editing half of the Apply-flow editor (StepEditCv) but stripped
   of the job/match/auto-apply machinery: there's no JD, no tournament, no batch.
   It edits the one CV held in the store (cvData) — building/refining/exporting it
   independent of any job application. When no CV is loaded yet it offers its own
   upload entry point so the feature works standalone from a fresh start.
   ═══════════════════════════════════════════════════════════════════════════════ */

export default function CvEditorView() {
    const cvData = useAppStore((s) => s.cvData);

    return (
        <div className="animate-fade-in" style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
            <header style={{ marginBottom: 20 }}>
                <h1 style={{
                    fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em',
                    margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 10,
                }}>
                    <FileText size={22} weight="duotone" style={{ color: 'var(--accent-blue)' }} />
                    Sửa CV
                </h1>
                <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', margin: 0 }}>
                    Chỉnh sửa CV, chọn mẫu và xuất PDF — không cần qua luồng ứng tuyển.
                </p>
            </header>

            {cvData ? <CvEditorWorkspace cv={cvData} /> : <UploadGate />}
        </div>
    );
}

/* ─── Empty state: no CV loaded — upload one to start ───────────────────────── */
function UploadGate() {
    const setCvData = useAppStore((s) => s.setCvData);
    const setCvRawText = useAppStore((s) => s.setCvRawText);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState('');
    const [dragOver, setDragOver] = useState(false);

    const handleFile = useCallback(async (file: File) => {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            setError('Chỉ hỗ trợ file PDF.');
            return;
        }
        setError('');
        setProcessing(true);
        try {
            const structured = await parsePdfWithAI(file, 'cv');
            setCvRawText('(parsed from PDF)', file.name);
            setCvData(structured);
            // Push the parsed profile + CV JSON to the extension, same as the
            // Apply-flow upload step, so the popup is filled immediately.
            const profile = cvToExtensionProfile(structured);
            syncProfileToExtension(profile, structured).catch(() => { });
            syncCvDataToExtension(structured).catch(() => { });
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Tải lên thất bại');
        } finally {
            setProcessing(false);
        }
    }, [setCvData, setCvRawText]);

    return (
        <div style={{ maxWidth: 520, margin: '40px auto 0' }}>
            <label
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files[0];
                    if (f) void handleFile(f);
                }}
                style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
                    padding: '48px 24px', borderRadius: 16, cursor: processing ? 'wait' : 'pointer',
                    border: `2px dashed ${dragOver ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                    background: dragOver ? 'var(--gradient-hero-subtle)' : 'var(--bg-card)',
                    transition: 'all 0.18s ease', textAlign: 'center',
                }}
            >
                <div style={{
                    width: 52, height: 52, borderRadius: 14,
                    background: 'var(--gradient-hero)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    {processing
                        ? <SpinnerGap size={24} color="white" className="spin" />
                        : <UploadSimple size={24} weight="bold" color="white" />}
                </div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {processing ? 'Đang đọc CV bằng AI…' : 'Tải lên CV (PDF) để bắt đầu'}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    Kéo thả file hoặc bấm để chọn — AI sẽ trích xuất nội dung để chỉnh sửa.
                </div>
                <input
                    type="file"
                    accept="application/pdf"
                    disabled={processing}
                    style={{ display: 'none' }}
                    onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        if (f) void handleFile(f);
                        e.target.value = '';
                    }}
                />
            </label>
            {error && (
                <div style={{
                    marginTop: 12, padding: '8px 12px', borderRadius: 8,
                    background: 'rgba(239,68,68,0.08)', color: 'var(--accent-red)',
                    fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                    <Warning size={13} /> {error}
                </div>
            )}
        </div>
    );
}

/* ─── The editor itself — only mounted once a CV exists ─────────────────────── */
function CvEditorWorkspace({ cv }: { cv: CVData }) {
    const setCvData = useAppStore((s) => s.setCvData);
    const userAvatarBase64 = useAppStore((s) => s.userAvatarBase64);
    const setUserAvatar = useAppStore((s) => s.setUserAvatar);

    // Template choice + preview/edit toggle are local to this feature (the
    // Apply flow keeps its own per-job template on each jdEntry).
    const [templateId, setTemplateId] = useState<CvTemplateId>(DEFAULT_TEMPLATE_ID);
    const [livePreviewOpen, setLivePreviewOpen] = useState(true);
    // Body edits live here; personal-info fields are read from cvData so a
    // later contact edit always wins (see effectiveCv below). Mirrors how the
    // Apply-flow editor separates the optimized body from the base profile.
    const [editedCv, setEditedCv] = useState<CVData | null>(null);
    const [avatarBusy, setAvatarBusy] = useState(false);
    const [avatarError, setAvatarError] = useState<string | null>(null);
    const [downloadingPdf, setDownloadingPdf] = useState(false);
    const [pdfError, setPdfError] = useState('');

    const workingCv = editedCv ?? cv;
    // Personal-info edits (contact/personal/employment/preferences) go to cvData
    // via PersonalInfoSection; fold them back over the working body so the
    // rendered template + export always reflect the latest of both.
    const effectiveCv = useMemo<CVData>(() => ({
        ...workingCv,
        contact: cv.contact,
        personal: cv.personal,
        employment: cv.employment,
        preferences: cv.preferences,
    }), [workingCv, cv.contact, cv.personal, cv.employment, cv.preferences]);

    const template = getTemplate(templateId);

    /* ─── Auto-push profile to the extension as the CV changes (debounced) ─── */
    useEffect(() => {
        const handle = setTimeout(() => {
            const profile = cvToExtensionProfile(cv);
            syncProfileToExtension(profile, cv).catch(() => { });
        }, 500);
        return () => clearTimeout(handle);
    }, [cv]);

    /* ─── Inline edits made directly on the rendered template preview ─── */
    const handleTemplateFieldEdit = useCallback((path: string, text: string) => {
        const base = editedCv ?? cv;
        const next = applyCvFieldEdit(base, path, text);
        if (next === base) return;
        setEditedCv(next);
    }, [editedCv, cv]);

    /* ─── Avatar upload ─── */
    const handleAvatarPick = useCallback(async (file: File | null) => {
        if (!file) return;
        setAvatarBusy(true);
        setAvatarError(null);
        try {
            const dataUrl = await resizeAvatarToDataUrl(file);
            setUserAvatar(dataUrl);
        } catch (err) {
            setAvatarError(err instanceof Error ? err.message : 'Lỗi tải ảnh');
        } finally {
            setAvatarBusy(false);
        }
    }, [setUserAvatar]);

    /* ─── Export the current CV → PDF ─── */
    const handleDownload = useCallback(async (cvToRender: CVData) => {
        if (downloadingPdf) return;
        setDownloadingPdf(true);
        setPdfError('');
        try {
            const merged: CVData = {
                ...cvToRender,
                contact: cv.contact,
                personal: cv.personal,
                employment: cv.employment,
                preferences: cv.preferences,
            };
            const html = renderCvHtml(merged, templateId, {
                avatarBase64: userAvatarBase64 ?? undefined,
            });
            const filename = `${(merged.name || 'cv').replace(/\s+/g, '_')}_CV.pdf`;
            const { base64, filename: outName } = await renderCvPdf(html, filename);
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
            const msg = e instanceof Error ? e.message : 'Xuất PDF thất bại';
            setPdfError(`Xuất PDF lỗi: ${msg}`);
        } finally {
            setDownloadingPdf(false);
        }
    }, [downloadingPdf, cv, templateId, userAvatarBase64]);

    return (
        <div style={{ minWidth: 0 }}>
            {/* ══════ AI Disclaimer ══════ */}
            <div style={{
                background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
                borderRadius: 'var(--radius-sm)', padding: '8px 14px', marginBottom: 12,
                fontSize: '0.78rem', color: 'var(--accent-amber)',
                display: 'flex', alignItems: 'center', gap: 6,
            }}>
                <Warning size={12} />
                Bấm vào nội dung bất kỳ để sửa, di chuột vào mục để sắp xếp/xoá — nội dung do bạn kiểm soát.
            </div>

            {/* ══════ Personal Info — editable, auto-synced to extension ══════ */}
            <PersonalInfoSection cv={cv} onChange={setCvData} />

            {/* ══════ Template Picker + Avatar + Live Preview ══════ */}
            <div style={{ marginBottom: 12, padding: 12, background: 'var(--bg-card)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 10 }}>
                    {/* Avatar uploader — only for templates with an image holder */}
                    {template.hasPhoto ? (
                        <div style={{ flex: '0 0 auto', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
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
                            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                                Ảnh đại diện
                            </div>
                            <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
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
                            selected={templateId}
                            onSelect={(id: CvTemplateId) => {
                                setTemplateId(id);
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
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                            <button
                                onClick={() => void handleDownload(effectiveCv)}
                                disabled={downloadingPdf}
                                className="btn-primary"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 5,
                                    padding: '8px 20px', fontSize: '0.82rem',
                                    opacity: downloadingPdf ? 0.6 : 1,
                                }}
                            >
                                {downloadingPdf ? <CircleNotch size={14} className="spin" /> : <FloppyDisk size={14} weight="fill" />}
                                {downloadingPdf ? 'Đang xuất PDF…' : 'Lưu & Tải xuống'}
                            </button>
                        </div>
                        {pdfError && (
                            <div role="alert" style={{
                                marginTop: 8, padding: '8px 12px', borderRadius: 6,
                                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                                color: 'var(--accent-red)', fontSize: '0.78rem',
                                display: 'flex', alignItems: 'center', gap: 6,
                            }}>
                                <Warning size={13} /> {pdfError}
                            </div>
                        )}
                        <div style={{ marginTop: 8, fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                            ✏️ Click vào nội dung trên CV để sửa trực tiếp — Enter để lưu, Esc để huỷ.
                        </div>
                        <div style={{
                            marginTop: 8, border: '1px solid var(--border-subtle)',
                            borderRadius: 6, overflow: 'hidden', background: '#fff',
                        }}>
                            <EditableTemplateFrame
                                key={`${templateId}-${userAvatarBase64?.length ?? 0}`}
                                html={renderCvHtml(effectiveCv, templateId, {
                                    avatarBase64: userAvatarBase64 ?? undefined,
                                })}
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
                    originalCv={cv}
                    optimizedCv={cv}
                    onSave={handleDownload}
                    onEditedChange={setEditedCv}
                />
            </div>

            <div style={{
                marginTop: 16, textAlign: 'center', fontSize: '0.72rem',
                color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: 6,
            }}>
                <Sparkle size={12} weight="duotone" style={{ color: 'var(--accent-purple)' }} />
                Thay đổi được tự đồng bộ sang extension để điền form nhanh hơn.
            </div>
        </div>
    );
}
