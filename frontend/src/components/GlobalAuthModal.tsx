'use client';

// Single app-wide AuthModal driven by the auth context's prompt state. Lives
// at the layout level so any component — the sidebar login button or the soft
// gate on an AI action — opens the same modal via promptLogin(), instead of
// each call site owning its own copy. Kept separate from auth.tsx to avoid a
// circular import (AuthModal imports useAuth).
import { useAuth } from '@/lib/auth';
import AuthModal from './AuthModal';

export default function GlobalAuthModal() {
    const { enabled, promptOpen, promptReason, closePrompt } = useAuth();
    if (!enabled || !promptOpen) return null;
    return <AuthModal onClose={closePrompt} reason={promptReason} />;
}
