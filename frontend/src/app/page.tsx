'use client';

import { useAppStore } from '@/store/useAppStore';
import Stepper from '@/components/Stepper';
import StepUploadCV from '@/components/steps/StepUploadCV';
import StepInputUrl from '@/components/steps/StepInputUrl';
import StepReport from '@/components/steps/StepReport';
import { Sparkles } from 'lucide-react';

export default function Home() {
  const { currentStep } = useAppStore();

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

      {/* Step Content */}
      <main style={{ paddingBottom: 60 }}>
        {currentStep === 1 && <StepUploadCV />}
        {currentStep === 2 && <StepInputUrl />}
        {currentStep === 3 && <StepReport />}
      </main>

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        padding: '16px',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        borderTop: '1px solid var(--border-subtle)',
      }}>
        AI Job Fit Optimizer · Powered by Gemini AI · No hallucination policy
      </footer>
    </div>
  );
}
