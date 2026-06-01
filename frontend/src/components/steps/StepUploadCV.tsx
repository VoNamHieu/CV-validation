'use client';

import { useCallback, useRef, useState } from 'react';
import {
    UploadSimple, FileText, X, SpinnerGap, Brain,
    CheckCircle, Sparkle, ArrowRight, WarningCircle, Lightning,
} from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { parsePdfWithAI } from '@/lib/api';
import { cvToExtensionProfile } from '@/lib/extension-profile';

export default function StepUploadCV() {
    const { setCvRawText, setCvData, setStep, cvFileName, setFullyAutoMode } = useAppStore();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const [error, setError] = useState('');
    const [uploaded, setUploaded] = useState(!!cvFileName);
    const [processing, setProcessing] = useState(false);
    const [processingFile, setProcessingFile] = useState('');

    const handleFile = useCallback(async (file: File) => {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            setError('Only PDF files are supported.');
            return;
        }
        setError('');
        setProcessing(true);
        setProcessingFile(file.name);
        try {
            const structured = await parsePdfWithAI(file, 'cv');
            setCvRawText('(parsed from PDF)', file.name);
            setCvData(structured);

            // Push extracted profile to the extension immediately so the popup
            // is filled the moment the CV is uploaded — without waiting for
            // the user to reach Step 4 (Edit CV).
            try {
                const profile = cvToExtensionProfile(structured);
                window.postMessage({
                    type: 'JOBFIT_EXPORT_PROFILE',
                    profile,
                    cvData: structured,
                    lastSyncedAt: Date.now(),
                }, '*');
            } catch { /* extension not installed — non-fatal */ }

            setUploaded(true);
            setProcessing(false);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Upload failed');
            setProcessing(false);
            setProcessingFile('');
        }
    }, [setCvRawText, setCvData]);

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
                    <Sparkle size={12} weight="fill" /> Step 1 of 3
                </div>
                <h2 style={{
                    fontSize: '1.8rem', fontWeight: 800, marginBottom: 10,
                    letterSpacing: '-0.03em', lineHeight: 1.2,
                }}>
                    Upload Your CV
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.6, maxWidth: 420, margin: '0 auto' }}>
                    Drop your resume as PDF. Our AI will extract skills, experience, and education to match against jobs.
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
                        AI is analyzing your CV
                    </p>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 28 }}>
                        Extracting skills, experience, education & projects...
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
                            { label: 'PDF uploaded', done: true },
                            { label: 'AI parsing document', done: false, active: true },
                            { label: 'Structuring data', done: false },
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

            {/* Upload Zone */}
            {!uploaded && !processing && (
                <div
                    className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    style={{ position: 'relative' }}
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
                        letterSpacing: '-0.01em', position: 'relative',
                    }}>
                        Drag & drop your CV here
                    </p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', position: 'relative' }}>
                        or click to browse · <span style={{ color: 'var(--text-secondary)' }}>PDF only</span>
                    </p>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf"
                        style={{ display: 'none' }}
                        onChange={onFileSelect}
                    />
                </div>
            )}

            {/* Success State */}
            {uploaded && !processing && (
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
                    }}>
                        <FileText size={20} weight="duotone" style={{ color: 'var(--accent-green)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 600, fontSize: '0.9rem', letterSpacing: '-0.01em' }}>{cvFileName}</p>
                        <p style={{
                            color: 'var(--accent-green)', fontSize: '0.8rem',
                            display: 'flex', alignItems: 'center', gap: 4, marginTop: 2,
                        }}>
                            <CheckCircle size={12} weight="fill" /> Parsed & structured
                        </p>
                    </div>
                    <button
                        aria-label="Remove uploaded CV"
                        onClick={() => { setUploaded(false); setCvRawText('', ''); }}
                        style={{
                            background: 'var(--bg-secondary)', border: '1px solid var(--border-default)',
                            color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 10,
                            width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-red)'; e.currentTarget.style.color = 'var(--accent-red)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                    >
                        <X size={15} />
                    </button>
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
                    disabled={!uploaded || processing}
                    onClick={() => setStep(2)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 28px' }}
                >
                    Find Matching Jobs <ArrowRight size={16} weight="bold" />
                </button>
                <button
                    className="btn-primary"
                    disabled={!uploaded || processing}
                    onClick={() => { setFullyAutoMode(true); setStep(2); }}
                    title="Auto-search, optimize, and apply with no further clicks"
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '13px 22px',
                        background: 'linear-gradient(135deg, #059669, #10b981)',
                        boxShadow: '0 2px 12px rgba(5,150,105,0.3)',
                    }}
                >
                    <Lightning size={16} weight="fill" /> Fully Auto Apply
                </button>
            </div>
        </div>
    );
}
