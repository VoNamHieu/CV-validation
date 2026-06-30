'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { useAuth } from '@/lib/auth';
import Sidebar, { SIDEBAR_WIDTH } from '@/components/Sidebar';
import Stepper from '@/components/Stepper';
import StepUploadCV from '@/components/steps/StepUploadCV';
import StepInputUrl from '@/components/steps/StepInputUrl';
import StepEditCv from '@/components/steps/StepEditCv';
import CvEditorView from '@/components/views/CvEditorView';
import HistoryView from '@/components/views/HistoryView';
import Mode1ResultBanner from '@/components/Mode1ResultBanner';
import Landing from '@/components/Landing';

export default function Home() {
  const view = useAppStore((s) => s.view);
  const currentStep = useAppStore((s) => s.currentStep);
  const entered = useAppStore((s) => s.entered);
  const { user, enabled, loading: authLoading } = useAuth();

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

  // Front door. Hard gate: when Supabase Auth is configured, the app is only
  // reachable by a logged-in user — anonymous visitors always see the landing
  // page (its CTAs open the login modal). When auth isn't configured (dev /
  // no Supabase env), fall back to the persisted `entered` flag.
  if (enabled) {
    // Don't flash the landing while the session is still being restored, or a
    // returning logged-in user would see a blink of the front door.
    if (authLoading) return null;
    if (!user) return <Landing />;
  } else if (!entered) {
    return <Landing />;
  }

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
          background: 'var(--bg-secondary)',
          opacity: 0.9,
        }}>
          <div>Latosa · Vận hành bởi AI · Cam kết không bịa nội dung</div>
          <div style={{ marginTop: 6, display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/privacy" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Quyền riêng tư</a>
            <span>·</span>
            <a href="/terms" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Điều khoản sử dụng</a>
          </div>
        </footer>
      </div>
    </div>
  );
}
