'use client';

import { useAppStore } from '@/store/useAppStore';
import Stepper from '@/components/Stepper';
import StepUploadCV from '@/components/steps/StepUploadCV';
import StepPasteJD from '@/components/steps/StepPasteJD';
import StepMatchScore from '@/components/steps/StepMatchScore';
import StepOptimize from '@/components/steps/StepOptimize';
import StepDownload from '@/components/steps/StepDownload';
import { Loader2, Sparkles } from 'lucide-react';

export default function Home() {
  const { currentStep, isLoading, loadingMessage } = useAppStore();

  return (
    <div style={{ minHeight: '100vh', position: 'relative' }}>
      {/* Header */}
      <header style={{
        padding: '20px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-glass)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'var(--gradient-hero)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Sparkles size={20} style={{ color: 'white' }} />
          </div>
          <span style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>
            AI Job Fit Optimizer
          </span>
        </div>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Career Intelligence Tool
        </span>
      </header>

      {/* Stepper */}
      <Stepper currentStep={currentStep} />

      {/* Loading Overlay */}
      {isLoading && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(10, 14, 26, 0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          gap: 16,
        }}>
          <Loader2 size={40} style={{ color: 'var(--accent-blue)', animation: 'spin 1s linear infinite' }} />
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{loadingMessage}</p>
          <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* Step Content */}
      <main style={{ paddingBottom: 60 }}>
        {currentStep === 1 && <StepUploadCV />}
        {currentStep === 2 && <StepPasteJD />}
        {currentStep === 3 && <StepMatchScore />}
        {currentStep === 4 && <StepOptimize />}
        {currentStep === 5 && <StepDownload />}
      </main>

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        padding: '16px',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        borderTop: '1px solid var(--border-subtle)',
      }}>
        AI Job Fit Optimizer · Powered by Gemini 3.0 Pro · No hallucination policy
      </footer>
    </div>
  );
}
