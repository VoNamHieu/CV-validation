'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import Sidebar, { SIDEBAR_WIDTH } from '@/components/Sidebar';
import Stepper from '@/components/Stepper';
import StepUploadCV from '@/components/steps/StepUploadCV';
import StepInputUrl from '@/components/steps/StepInputUrl';
import StepEditCv from '@/components/steps/StepEditCv';
import CvEditorView from '@/components/views/CvEditorView';
import HistoryView from '@/components/views/HistoryView';
import Mode1ResultBanner from '@/components/Mode1ResultBanner';

export default function Home() {
  const view = useAppStore((s) => s.view);
  const currentStep = useAppStore((s) => s.currentStep);

  // Global listener so __jobfitExtensionId is set as soon as the
  // extension's content-webapp.js posts JOBFIT_EXTENSION_READY,
  // regardless of which step the user is currently on.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      if (event.data?.type === 'JOBFIT_EXTENSION_READY' && event.data?.extensionId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__jobfitExtensionId = event.data.extensionId;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div style={{ minHeight: '100vh', position: 'relative' }}>
      {/* Ambient background */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
        background: 'var(--gradient-mesh)',
      }} />

      <Sidebar />

      {/* Mode 1 — tailored-CV result pushed from the extension */}
      <Mode1ResultBanner />

      {/* Main content area */}
      <div className="app-main" style={{
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
              {currentStep === 3 && <StepEditCv />}
            </>
          )}
          {view === 'editor' && <CvEditorView />}
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
          JobFit AI · Vận hành bởi AI · Cam kết không bịa nội dung
        </footer>
      </div>
    </div>
  );
}
