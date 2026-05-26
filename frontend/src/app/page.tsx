'use client';

import { useAppStore } from '@/store/useAppStore';
import Sidebar, { SIDEBAR_WIDTH } from '@/components/Sidebar';
import Stepper from '@/components/Stepper';
import StepUploadCV from '@/components/steps/StepUploadCV';
import StepInputUrl from '@/components/steps/StepInputUrl';
import StepReport from '@/components/steps/StepReport';
import StepEditCv from '@/components/steps/StepEditCv';
import HistoryView from '@/components/views/HistoryView';

export default function Home() {
  const view = useAppStore((s) => s.view);
  const currentStep = useAppStore((s) => s.currentStep);

  return (
    <div style={{ minHeight: '100vh', position: 'relative' }}>
      {/* Ambient background */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'var(--gradient-mesh)',
      }} />

      <Sidebar />

      {/* Main content area */}
      <div style={{
        marginLeft: SIDEBAR_WIDTH,
        minHeight: '100vh',
        position: 'relative',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
      }}>
        <main style={{ flex: 1, paddingBottom: 60 }}>
          {view === 'apply' && (
            <>
              <Stepper currentStep={currentStep} />
              {currentStep === 1 && <StepUploadCV />}
              {currentStep === 2 && <StepInputUrl />}
              {currentStep === 3 && <StepReport />}
              {currentStep === 4 && <StepEditCv />}
            </>
          )}
          {view === 'history' && <HistoryView />}
        </main>

        <footer style={{
          textAlign: 'center',
          padding: '16px 20px',
          fontSize: '0.7rem',
          color: 'var(--text-muted)',
          borderTop: '1px solid var(--border-subtle)',
          background: 'rgba(17, 17, 17, 0.6)',
          opacity: 0.7,
        }}>
          JobFit AI · Powered by Gemini · No hallucination policy
        </footer>
      </div>
    </div>
  );
}
