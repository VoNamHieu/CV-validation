'use client';

import { useAppStore } from '@/store/useAppStore';
import Stepper from '@/components/Stepper';
import StepUploadCV from '@/components/steps/StepUploadCV';
import StepInputUrl from '@/components/steps/StepInputUrl';
import StepReport from '@/components/steps/StepReport';
import StepEditCv from '@/components/steps/StepEditCv';
import { Sparkle } from '@phosphor-icons/react';

export default function Home() {
  const { currentStep } = useAppStore();

  return (
    <div style={{ minHeight: '100vh', position: 'relative' }}>
      {/* Ambient background */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'var(--gradient-mesh)',
      }} />

      {/* Header */}
      <header style={{
        padding: '16px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'rgba(17, 17, 17, 0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: 'var(--gradient-hero)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 10px rgba(79, 143, 247, 0.3)',
          }}>
            <Sparkle size={17} weight="fill" color="white" />
          </div>
          <div>
            <span style={{
              fontWeight: 700,
              fontSize: '0.95rem',
              letterSpacing: '-0.02em',
              background: 'var(--gradient-hero)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              JobFit AI
            </span>
          </div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 20,
          background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
          fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-green)' }} />
          AI Online
        </div>
      </header>

      {/* Stepper */}
      <Stepper currentStep={currentStep} />

      {/* Step Content */}
      <main style={{ paddingBottom: 80, position: 'relative', zIndex: 1 }}>
        {currentStep === 1 && <StepUploadCV />}
        {currentStep === 2 && <StepInputUrl />}
        {currentStep === 3 && <StepReport />}
        {currentStep === 4 && <StepEditCv />}
      </main>

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        padding: '20px',
        fontSize: '0.72rem',
        color: 'var(--text-muted)',
        borderTop: '1px solid var(--border-subtle)',
        background: 'rgba(17, 17, 17, 0.6)',
        position: 'relative',
        zIndex: 1,
      }}>
        <span style={{ opacity: 0.7 }}>JobFit AI · Powered by GPT-5 · No hallucination policy</span>
      </footer>
    </div>
  );
}
