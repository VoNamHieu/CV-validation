'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    UploadSimple, FileText, SpinnerGap, Brain,
    CheckCircle, Sparkle, ArrowRight, WarningCircle, Lightning,
    Target, MapPin, Stack,
} from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { useAuthGate } from '@/lib/auth';
import { parsePdfWithAI } from '@/lib/api';
import { cvToExtensionProfile } from '@/lib/extension-profile';
import { syncProfileToExtension, syncCvDataToExtension } from '@/lib/extension-sync';
import { CITY_OPTIONS, SENIORITY_OPTIONS, canonSeniority } from '@/lib/job-targeting';

export default function StepUploadCV() {
    const {
        setCvRawText, setCvData, setStep, cvFileName, cvData, setFullyAutoMode,
        targetJobTitle, setTargetJobTitle, targetLocation, setTargetLocation,
        targetLevel, setTargetLevel,
    } = useAppStore();
    const gate = useAuthGate();
    const GATE_MSG = 'Đăng nhập để nhận 50 credit miễn phí và bắt đầu tìm việc.';
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const [error, setError] = useState('');
    // "Tải CV mới" — user with an existing CV explicitly chose to replace it.
    const [wantNew, setWantNew] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [processingFile, setProcessingFile] = useState('');
    // null = not attempted, true = extension ACKed, false = no ACK (not
    // installed / wrong URL / needs tab refresh after extension reload).
    const [extSynced, setExtSynced] = useState<boolean | null>(null);
    const [extSyncError, setExtSyncError] = useState('');

    // A CV already exists (freshly parsed this session OR restored from the
    // account on login via syncActiveCvProfile). "ready" = we can proceed
    // without an upload; show the reuse card instead of the empty dropzone.
    const hasCv = !!cvData;
    const ready = hasCv && !wantNew;
    const reuseTitle =
        cvData?.desired_job_title?.trim()
        || cvData?.employment?.current_title?.trim()
        || '';

    // A CV restored from the account (no fresh upload this session, so no
    // cvFileName) hasn't been pushed to the extension yet — sync it once so the
    // popup is pre-filled and auto-apply works without re-uploading.
    const reusedSyncedRef = useRef(false);
    useEffect(() => {
        if (!cvData || cvFileName || reusedSyncedRef.current) return;
        reusedSyncedRef.current = true;
        const profile = cvToExtensionProfile(cvData);
        syncProfileToExtension(profile, cvData).then((res) => {
            setExtSynced(res.ok);
            setExtSyncError(res.error ?? '');
        }).catch(() => { });
        syncCvDataToExtension(cvData).catch(() => { });
    }, [cvData, cvFileName]);

    const handleFile = useCallback(async (file: File) => {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            setError('Chỉ hỗ trợ file PDF.');
            return;
        }
        setError('');
        setProcessing(true);
        setProcessingFile(file.name);
        try {
            const structured = await parsePdfWithAI(file, 'cv');
            setCvRawText('(parsed from PDF)', file.name);
            setCvData(structured);

            // Seed the target role from the AI-inferred desired title (falling
            // back to the most-recent title) so the user just confirms/tweaks it
            // — no second LLM round-trip on the next step.
            setTargetJobTitle(
                structured.desired_job_title?.trim()
                || structured.employment?.current_title?.trim()
                || ''
            );
            // Pre-select the seniority chip from the CV's inferred level ('' if
            // it doesn't map — the user can pick, and the backend infers from the
            // CV level anyway when none is chosen).
            setTargetLevel(canonSeniority(structured.employment?.current_level || ''));

            // Push extracted profile to the extension immediately so the popup
            // is filled the moment the CV is uploaded — without waiting for
            // the user to reach Step 4 (Edit CV). Awaits the extension's ACK
            // so a dead relay shows up in the UI instead of failing silently.
            const profile = cvToExtensionProfile(structured);
            syncProfileToExtension(profile, structured).then((res) => {
                setExtSynced(res.ok);
                setExtSyncError(res.error ?? '');
                if (!res.ok) console.warn('[Copo] Profile sync → extension failed:', res.error);
            });
            // Also sync the rich CV JSON so the extension can tailor it on a job
            // page (Mode 1) — the relay drops cvData from the profile message.
            syncCvDataToExtension(structured).catch(() => { });

            setWantNew(false);
            setProcessing(false);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Tải lên thất bại');
            setProcessing(false);
            setProcessingFile('');
        }
    }, [setCvRawText, setCvData, setTargetJobTitle, setTargetLevel]);

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    };

    return (
        <div className="animate-fade-in" style={{ maxWidth: 580, margin: '0 auto', padding: '48px 20px' }}>
            {/* Hero */}
            <div style={{ textAlign: 'center', marginBottom: 40 }}>
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 14px', borderRadius: 20,
                    background: 'var(--gradient-hero-subtle)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.72rem', fontWeight: 500, color: 'var(--accent-purple)',
                    marginBottom: 16,
                }}>
                    <Sparkle size={12} weight="fill" /> Bước 1 / 3
                </div>
                <h2 style={{
                    fontSize: '1.8rem', fontWeight: 800, marginBottom: 10,
                    letterSpacing: '-0.03em', lineHeight: 1.2,
                }}>
                    Tải CV của bạn lên
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.6, maxWidth: 420, margin: '0 auto' }}>
                    Thả CV dạng PDF vào đây. AI sẽ trích xuất kỹ năng, kinh nghiệm và học vấn để so khớp với các việc làm.
                </p>
            </div>

            {/* Processing State */}
            {processing && (
                <div className="glass-card" style={{
                    padding: '40px 32px',
                    textAlign: 'center',
                    background: 'var(--gradient-hero-subtle)',
                }}>
                    <div className="animate-float" style={{
                        width: 72, height: 72, borderRadius: 20,
                        background: 'var(--gradient-hero)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 24px',
                        boxShadow: '0 8px 32px rgba(99, 102, 241, 0.25)',
                    }}>
                        <Brain size={32} weight="duotone" color="white" />
                    </div>

                    <p style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 6, letterSpacing: '-0.02em' }}>
                        AI đang phân tích CV của bạn
                    </p>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 28 }}>
                        Đang trích xuất kỹ năng, kinh nghiệm, học vấn & dự án...
                    </p>

                    {/* File badge */}
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        padding: '8px 16px', borderRadius: 8,
                        background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                        fontSize: '0.82rem',
                    }}>
                        <FileText size={14} weight="duotone" style={{ color: 'var(--accent-blue)' }} />
                        <span style={{ color: 'var(--text-secondary)' }}>{processingFile}</span>
                    </div>

                    {/* Progress */}
                    <div style={{
                        display: 'flex', flexDirection: 'column', gap: 12,
                        marginTop: 28, maxWidth: 260, margin: '28px auto 0',
                    }}>
                        {[
                            { label: 'Đã tải PDF lên', done: true },
                            { label: 'AI đang đọc tài liệu', done: false, active: true },
                            { label: 'Đang cấu trúc dữ liệu', done: false },
                        ].map((step, i) => (
                            <div key={i} style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                opacity: step.done || step.active ? 1 : 0.35,
                                transition: 'opacity 0.3s ease',
                            }}>
                                {step.done ? (
                                    <CheckCircle size={18} weight="fill" style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                                ) : step.active ? (
                                    <SpinnerGap size={18} style={{
                                        color: 'var(--accent-blue)', flexShrink: 0,
                                        animation: 'spin 1s linear infinite',
                                    }} />
                                ) : (
                                    <div style={{
                                        width: 18, height: 18, borderRadius: '50%',
                                        border: '2px solid var(--border-default)', flexShrink: 0,
                                    }} />
                                )}
                                <span style={{
                                    fontSize: '0.83rem',
                                    fontWeight: step.active ? 600 : 400,
                                    color: step.done ? 'var(--accent-green)' : step.active ? 'var(--text-primary)' : 'var(--text-muted)',
                                }}>
                                    {step.label}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Upload Zone — shown when there's no CV yet, or the user chose "Tải CV mới" */}
            {!ready && !processing && (
                <>
                {wantNew && hasCv && (
                    <button
                        onClick={() => { setWantNew(false); setError(''); }}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12,
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--accent-purple)', fontSize: '0.82rem', fontWeight: 600, padding: 0,
                        }}
                    >
                        <ArrowRight size={14} weight="bold" style={{ transform: 'rotate(180deg)' }} /> Dùng lại CV đã lưu
                    </button>
                )}
                {/* A real <button> — not a <div onClick> — so the dropzone is
                    reachable by Tab and activates on Enter/Space. The file
                    input stays display:none (that part's fine; hidden inputs
                    just can't be the thing a keyboard user interacts with). */}
                <button
                    type="button"
                    className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                        position: 'relative', display: 'block', width: '100%', font: 'inherit',
                        appearance: 'none', WebkitAppearance: 'none', color: 'inherit',
                    }}
                >
                    <div style={{
                        width: 64, height: 64, borderRadius: 16,
                        background: 'var(--gradient-hero-subtle)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 20px',
                    }}>
                        <UploadSimple size={26} weight="duotone" style={{ color: 'var(--accent-blue)' }} />
                    </div>
                    <p style={{
                        fontSize: '1rem', fontWeight: 600, marginBottom: 6,
                        letterSpacing: '-0.01em', position: 'relative', color: 'var(--text-primary)',
                    }}>
                        Kéo & thả CV vào đây
                    </p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', position: 'relative' }}>
                        hoặc bấm để chọn file · <span style={{ color: 'var(--text-secondary)' }}>chỉ PDF</span>
                    </p>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf"
                        tabIndex={-1}
                        aria-hidden="true"
                        style={{ display: 'none' }}
                        onChange={onFileSelect}
                    />
                </button>
                </>
            )}

            {/* Ready state — a CV is available (freshly parsed or reused from the
                account). Show its identity + a "Tải CV mới" escape hatch instead
                of forcing a re-upload. */}
            {ready && !processing && (
                <div className="glass-card" style={{
                    padding: '20px 24px',
                    display: 'flex', alignItems: 'center', gap: 16,
                    background: 'rgba(52, 211, 153, 0.04)',
                    borderColor: 'rgba(52, 211, 153, 0.15)',
                }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: 'rgba(52, 211, 153, 0.1)',
                        border: '1px solid rgba(52, 211, 153, 0.2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                    }}>
                        <FileText size={20} weight="duotone" style={{ color: 'var(--accent-green)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 600, fontSize: '0.9rem', letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {cvData?.name || cvFileName || 'CV của bạn'}
                            {reuseTitle && (
                                <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · {reuseTitle}</span>
                            )}
                        </p>
                        <p style={{
                            color: 'var(--accent-green)', fontSize: '0.8rem',
                            display: 'flex', alignItems: 'center', gap: 4, marginTop: 2,
                        }}>
                            <CheckCircle size={12} weight="fill" /> {cvFileName ? 'Đã đọc & cấu trúc xong' : 'Đang dùng CV đã lưu — không cần tải lại'}
                        </p>
                        {extSynced !== null && (
                            <p
                                title={extSynced ? undefined : extSyncError}
                                style={{
                                    color: extSynced ? 'var(--accent-green)' : '#facc15',
                                    fontSize: '0.75rem',
                                    display: 'flex', alignItems: 'center', gap: 4, marginTop: 2,
                                }}
                            >
                                {extSynced
                                    ? <><CheckCircle size={12} weight="fill" /> Đã sync profile sang extension</>
                                    : <><WarningCircle size={12} weight="fill" /> Extension chưa nhận data — {extSyncError}</>}
                            </p>
                        )}
                    </div>
                    <button
                        onClick={() => { setWantNew(true); setError(''); setExtSynced(null); }}
                        title="Tải lên một CV khác"
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                            background: 'var(--bg-secondary)', border: '1px solid var(--border-default)',
                            color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 10,
                            padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600,
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-purple)'; e.currentTarget.style.color = 'var(--accent-purple)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >
                        <UploadSimple size={14} weight="bold" /> Tải CV mới
                    </button>
                </div>
            )}

            {/* Target role + location — confirm before finding jobs.
                Title is pre-filled from the AI-inferred desired role; the user
                can edit it or pick a city. No city = freestyle (any location). */}
            {ready && !processing && (
                <div className="glass-card" style={{ padding: '20px 24px', marginTop: 16 }}>
                    <label htmlFor="target-job-title" style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10,
                    }}>
                        <Target size={14} weight="duotone" style={{ color: 'var(--accent-purple)' }} />
                        Vị trí mong muốn
                    </label>
                    <div style={{ position: 'relative', marginBottom: 20 }}>
                        <div style={{
                            position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                            color: 'var(--text-muted)', pointerEvents: 'none',
                        }}>
                            <Brain size={16} weight="duotone" />
                        </div>
                        <input
                            id="target-job-title"
                            className="input-field"
                            type="text"
                            value={targetJobTitle}
                            onChange={(e) => setTargetJobTitle(e.target.value)}
                            placeholder="VD: Frontend Engineer"
                            style={{ paddingLeft: 42, height: 48, fontSize: '0.92rem', width: '100%', borderRadius: 'var(--radius-lg)' }}
                        />
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: -12, marginBottom: 20 }}>
                        Chọn vị trí bạn muốn ứng tuyển — kể cả khác với CV. Chúng tôi tìm việc theo vị trí này, rồi dùng CV để ước lượng độ phù hợp.
                    </p>

                    {/* A <label> would misleadingly claim to describe a single
                        control — this heads a group of toggle buttons, so it's
                        a plain heading; the group itself carries the a11y name. */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10,
                    }}>
                        <Stack size={14} weight="duotone" style={{ color: 'var(--accent-purple)' }} />
                        Cấp bậc <span style={{ textTransform: 'none', fontWeight: 400, letterSpacing: 0 }}>· không bắt buộc</span>
                    </div>
                    <div role="group" aria-label="Cấp bậc" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                        {SENIORITY_OPTIONS.map((s) => {
                            const active = targetLevel === s.key;
                            return (
                                <button
                                    key={s.key}
                                    type="button"
                                    onClick={() => setTargetLevel(active ? '' : s.key)}
                                    style={{
                                        padding: '8px 16px', borderRadius: 20, cursor: 'pointer',
                                        fontSize: '0.83rem', fontWeight: active ? 600 : 400,
                                        border: `1px solid ${active ? 'var(--accent-purple)' : 'var(--border-default)'}`,
                                        background: active ? 'rgba(139,92,246,0.12)' : 'var(--bg-secondary)',
                                        color: active ? 'var(--accent-purple)' : 'var(--text-secondary)',
                                        transition: 'all 0.18s ease',
                                    }}
                                >
                                    {s.label}
                                </button>
                            );
                        })}
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 20 }}>
                        {targetLevel
                            ? 'Các vị trí lệch xa cấp bậc này sẽ bị xếp hạng thấp hơn.'
                            : 'Chưa chọn cấp bậc — chúng tôi sẽ suy ra từ CV của bạn.'}
                    </p>

                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)',
                        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10,
                    }}>
                        <MapPin size={14} weight="duotone" style={{ color: 'var(--accent-blue)' }} />
                        Địa điểm <span style={{ textTransform: 'none', fontWeight: 400, letterSpacing: 0 }}>· không bắt buộc</span>
                    </div>
                    <div role="group" aria-label="Địa điểm" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {CITY_OPTIONS.map((c) => {
                            const active = targetLocation === c.key;
                            return (
                                <button
                                    key={c.key}
                                    type="button"
                                    onClick={() => setTargetLocation(active ? '' : c.key)}
                                    style={{
                                        padding: '8px 16px', borderRadius: 20, cursor: 'pointer',
                                        fontSize: '0.83rem', fontWeight: active ? 600 : 400,
                                        border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border-default)'}`,
                                        background: active ? 'rgba(59,130,246,0.12)' : 'var(--bg-secondary)',
                                        color: active ? 'var(--accent-blue)' : 'var(--text-secondary)',
                                        transition: 'all 0.18s ease',
                                    }}
                                >
                                    {c.label}
                                </button>
                            );
                        })}
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 10 }}>
                        {targetLocation
                            ? 'Việc được so khớp theo vị trí và thành phố này. Nếu không có đúng thành phố → vẫn hiển thị vị trí này ở nơi khác.'
                            : 'Chưa chọn thành phố — việc được so khớp theo vị trí này ở mọi địa điểm.'}
                    </p>
                </div>
            )}

            {/* Error */}
            {error && (
                <div style={{
                    background: 'rgba(248, 113, 113, 0.06)',
                    border: '1px solid rgba(248, 113, 113, 0.2)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 16px',
                    marginTop: 16,
                    fontSize: '0.85rem',
                    color: 'var(--accent-red)',
                    display: 'flex', alignItems: 'center', gap: 8,
                }}>
                    <WarningCircle size={16} weight="fill" style={{ flexShrink: 0 }} /> {error}
                </div>
            )}

            {/* Action */}
            <div style={{ marginTop: 40, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button
                    className="btn-primary"
                    disabled={!ready || processing}
                    onClick={() => { if (gate(GATE_MSG)) setStep(2); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 28px' }}
                >
                    Tìm việc phù hợp <ArrowRight size={16} weight="bold" />
                </button>
                <button
                    className="btn-primary"
                    disabled={!ready || processing}
                    onClick={() => { if (gate(GATE_MSG)) { setFullyAutoMode(true); setStep(2); } }}
                    title="Tự động tìm việc, tối ưu CV và ứng tuyển — không cần thao tác thêm"
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '13px 22px',
                        background: 'linear-gradient(135deg, #059669, #10b981)',
                        boxShadow: '0 2px 12px rgba(5,150,105,0.3)',
                    }}
                >
                    <Lightning size={16} weight="fill" /> Ứng tuyển tự động hoàn toàn
                </button>
            </div>
        </div>
    );
}
