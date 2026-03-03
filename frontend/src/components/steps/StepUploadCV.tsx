'use client';

import { useCallback, useRef, useState } from 'react';
import { Upload, FileText, X, Loader2, Brain, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { parsePdfWithAI } from '@/lib/api';

export default function StepUploadCV() {
    const { setCvRawText, setCvData, setStep, cvFileName } = useAppStore();
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
        <div className="animate-fade-in" style={{ maxWidth: 600, margin: '0 auto', padding: '40px 20px' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 8 }}>
                Upload Your CV
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32, fontSize: '0.95rem' }}>
                Upload your resume as a PDF file. Our AI will extract and structure the content automatically.
            </p>

            {/* ── Processing State ── */}
            {processing && (
                <div className="glass-card" style={{
                    padding: '32px 28px',
                    textAlign: 'center',
                    background: 'linear-gradient(135deg, rgba(59,130,246,0.06), rgba(139,92,246,0.04))',
                }}>
                    {/* Animated brain icon */}
                    <div style={{
                        width: 64, height: 64, borderRadius: '50%',
                        background: 'var(--gradient-hero)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 20px',
                        animation: 'pulse-glow 2s infinite',
                    }}>
                        <Brain size={28} style={{ color: 'white' }} />
                    </div>

                    <p style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 6 }}>
                        AI is analyzing your CV
                    </p>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20 }}>
                        Extracting skills, experience, education, and projects...
                    </p>

                    {/* File info */}
                    <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        padding: '8px 16px', borderRadius: 8,
                        background: 'var(--bg-secondary)',
                        fontSize: '0.82rem',
                    }}>
                        <FileText size={14} style={{ color: 'var(--accent-blue)' }} />
                        <span style={{ color: 'var(--text-secondary)' }}>{processingFile}</span>
                    </div>

                    {/* Progress steps */}
                    <div style={{
                        display: 'flex', flexDirection: 'column', gap: 10,
                        marginTop: 24, textAlign: 'left',
                        maxWidth: 300, margin: '24px auto 0',
                    }}>
                        {[
                            { label: 'Uploading PDF', done: true },
                            { label: 'AI reading document', done: false, active: true },
                            { label: 'Structuring data', done: false },
                        ].map((step, i) => (
                            <div key={i} style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                opacity: step.done || step.active ? 1 : 0.4,
                            }}>
                                {step.done ? (
                                    <CheckCircle2 size={18} style={{ color: 'var(--accent-green)', flexShrink: 0 }} />
                                ) : step.active ? (
                                    <Loader2 size={18} style={{
                                        color: 'var(--accent-blue)', flexShrink: 0,
                                        animation: 'spin 1s linear infinite',
                                    }} />
                                ) : (
                                    <div style={{
                                        width: 18, height: 18, borderRadius: '50%',
                                        border: '2px solid var(--border-subtle)', flexShrink: 0,
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
                    <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
                </div>
            )}

            {/* ── Upload Zone ── */}
            {!uploaded && !processing && (
                <div
                    className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <Upload size={48} style={{ color: 'var(--accent-blue)', marginBottom: 16 }} />
                    <p style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 8 }}>
                        Drag & drop your CV here
                    </p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        or click to browse ·  PDF only
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

            {/* ── Success State ── */}
            {uploaded && !processing && (
                <div className="glass-card" style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: 10,
                        background: 'rgba(16,185,129,0.12)', display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                    }}>
                        <FileText size={22} style={{ color: 'var(--accent-green)' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <p style={{ fontWeight: 600 }}>{cvFileName}</p>
                        <p style={{ color: 'var(--accent-green)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle2 size={13} /> Parsed successfully
                        </p>
                    </div>
                    <button
                        onClick={() => { setUploaded(false); setCvRawText('', ''); }}
                        style={{
                            background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                            color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 8,
                            width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {error && (
                <div style={{
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.25)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 16px',
                    marginTop: 16,
                    fontSize: '0.85rem',
                    color: 'var(--accent-red)',
                }}>
                    {error}
                </div>
            )}

            <div style={{ marginTop: 40, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                    className="btn-primary"
                    disabled={!uploaded || processing}
                    onClick={() => setStep(2)}
                >
                    Next: Input Job URL →
                </button>
            </div>
        </div>
    );
}
