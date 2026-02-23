'use client';

import { useState, useRef, useCallback } from 'react';
import { FileText, ArrowLeft, Upload } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { uploadPdfForExtraction, extractJdStructured } from '@/lib/api';

export default function StepPasteJD() {
    const { setStep, jdRawText, setJdRawText, setJdData, setLoading } = useAppStore();
    const [text, setText] = useState(jdRawText);
    const [error, setError] = useState('');
    const [parsed, setParsed] = useState(!!jdRawText);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleAnalyze = async (rawText: string) => {
        if (!rawText.trim()) {
            setError('Please paste or upload a job description.');
            return;
        }
        setError('');
        setLoading(true, 'Analyzing Job Description with AI...');
        try {
            setJdRawText(rawText);
            const structured = await extractJdStructured(rawText);
            setJdData(structured);
            setParsed(true);
            setLoading(false);
            setStep(3);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Analysis failed');
            setLoading(false);
        }
    };

    const handlePdfUpload = useCallback(async (file: File) => {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            setError('Only PDF files are supported.');
            return;
        }
        setError('');
        setLoading(true, 'Extracting text from JD PDF...');
        try {
            const raw = await uploadPdfForExtraction(file, 'jd');
            setText(raw);
            setJdRawText(raw);
            setLoading(false);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Upload failed');
            setLoading(false);
        }
    }, [setJdRawText, setLoading]);

    const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handlePdfUpload(file);
    };

    return (
        <div className="animate-fade-in" style={{ maxWidth: 700, margin: '0 auto', padding: '40px 20px' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 8 }}>
                Job Description
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: '0.95rem' }}>
                Paste the job description text below, or upload a JD as PDF.
            </p>

            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <button
                    className="btn-secondary"
                    onClick={() => fileInputRef.current?.click()}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                >
                    <Upload size={16} /> Upload JD (PDF)
                </button>
                <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={onFileSelect} />
            </div>

            <textarea
                className="input-field"
                rows={14}
                placeholder="Paste the full job description here..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                style={{ lineHeight: 1.6 }}
            />

            {error && (
                <p style={{ color: 'var(--accent-red)', marginTop: 12, fontSize: '0.85rem' }}>{error}</p>
            )}

            <div style={{ marginTop: 32, display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn-secondary" onClick={() => setStep(1)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ArrowLeft size={16} /> Back
                </button>
                <button className="btn-primary" onClick={() => handleAnalyze(text)}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileText size={16} /> Analyze Match
                    </span>
                </button>
            </div>
        </div>
    );
}
