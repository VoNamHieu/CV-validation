'use client';

import { useCallback, useRef, useState } from 'react';
import { Upload, FileText, X } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { uploadPdfForExtraction, extractCvStructured } from '@/lib/api';

export default function StepUploadCV() {
    const { setCvRawText, setCvData, setStep, setLoading, cvFileName } = useAppStore();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const [error, setError] = useState('');
    const [uploaded, setUploaded] = useState(!!cvFileName);

    const handleFile = useCallback(async (file: File) => {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            setError('Only PDF files are supported.');
            return;
        }
        setError('');
        setLoading(true, 'Extracting text from CV...');
        try {
            const rawText = await uploadPdfForExtraction(file, 'cv');
            setCvRawText(rawText, file.name);
            setLoading(true, 'Analyzing CV with AI...');
            const structured = await extractCvStructured(rawText);
            setCvData(structured);
            setUploaded(true);
            setLoading(false);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Upload failed');
            setLoading(false);
        }
    }, [setCvRawText, setCvData, setLoading]);

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

            {!uploaded ? (
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
            ) : (
                <div className="glass-card" style={{ padding: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
                    <FileText size={32} style={{ color: 'var(--accent-green)' }} />
                    <div style={{ flex: 1 }}>
                        <p style={{ fontWeight: 600 }}>{cvFileName}</p>
                        <p style={{ color: 'var(--accent-green)', fontSize: '0.85rem' }}>✓ Parsed successfully</p>
                    </div>
                    <button
                        onClick={() => { setUploaded(false); setCvRawText('', ''); }}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                        <X size={20} />
                    </button>
                </div>
            )}

            {error && (
                <p style={{ color: 'var(--accent-red)', marginTop: 16, fontSize: '0.85rem' }}>{error}</p>
            )}

            <div style={{ marginTop: 40, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                    className="btn-primary"
                    disabled={!uploaded}
                    onClick={() => setStep(2)}
                >
                    Next: Paste Job Description →
                </button>
            </div>
        </div>
    );
}
