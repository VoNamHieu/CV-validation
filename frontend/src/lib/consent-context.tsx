'use client';

// Two-layer consent, persisted as evidence (profiles.terms_accepted_at /
// terms_version / agent_consent_at):
//   Layer 1 — on sign-in we flush any pending Terms acceptance from signup.
//   Layer 2 — ensureAgentConsent() gates the auto-apply agent behind a separate
//     just-in-time confirmation the first time it's used, and records it.
import {
    createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Robot, X } from '@phosphor-icons/react';
import { useAuth } from './auth';
import { account } from './db';
import { flushPendingTermsAcceptance } from './consent';

interface ConsentValue {
    agentConsented: boolean;
    /** Resolves true if the user has (or just gave) auto-apply consent; false if
     *  they declined or it couldn't be recorded. Call before any agent action. */
    ensureAgentConsent: () => Promise<boolean>;
}

const Ctx = createContext<ConsentValue | null>(null);

export function ConsentProvider({ children }: { children: ReactNode }) {
    const { enabled, user } = useAuth();
    const [agentConsented, setAgentConsented] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const resolverRef = useRef<((v: boolean) => void) | null>(null);

    // On sign-in: record any pending Terms acceptance, then load consent state.
    useEffect(() => {
        if (!enabled || !user) { setAgentConsented(false); return; }
        let active = true;
        (async () => {
            await flushPendingTermsAcceptance();
            try {
                const p = await account.getProfile();
                if (active) setAgentConsented(!!p.agent_consent_at);
            } catch { /* ignore — defaults to requiring consent */ }
        })();
        return () => { active = false; };
    }, [enabled, user]);

    const ensureAgentConsent = useCallback((): Promise<boolean> => {
        // Auth off (dev) or already consented → no prompt.
        if (!enabled || agentConsented) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
            resolverRef.current = resolve;
            setError('');
            setModalOpen(true);
        });
    }, [enabled, agentConsented]);

    const settle = useCallback((v: boolean) => {
        resolverRef.current?.(v);
        resolverRef.current = null;
        setModalOpen(false);
    }, []);

    const confirm = useCallback(async () => {
        setBusy(true);
        setError('');
        try {
            await account.recordAgentConsent();   // store evidence first
            setAgentConsented(true);
            settle(true);
        } catch {
            // Fail closed: if we couldn't record consent, don't run the agent.
            setError('Không lưu được xác nhận. Vui lòng thử lại.');
        } finally {
            setBusy(false);
        }
    }, [settle]);

    return (
        <Ctx.Provider value={{ agentConsented, ensureAgentConsent }}>
            {children}
            {modalOpen && (
                <AgentConsentModal
                    busy={busy} error={error}
                    onConfirm={confirm} onCancel={() => settle(false)}
                />
            )}
        </Ctx.Provider>
    );
}

export function useConsent(): ConsentValue {
    const c = useContext(Ctx);
    if (!c) throw new Error('useConsent must be used within <ConsentProvider>');
    return c;
}

function AgentConsentModal({
    busy, error, onConfirm, onCancel,
}: {
    busy: boolean; error: string; onConfirm: () => void; onCancel: () => void;
}) {
    const [agreed, setAgreed] = useState(false);
    if (typeof document === 'undefined') return null;

    return createPortal(
        <div
            onClick={onCancel}
            style={{
                position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', padding: 16,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 440, background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)', borderRadius: 16, padding: 24,
                    position: 'relative', boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
                }}
            >
                <button
                    onClick={onCancel} aria-label="Đóng"
                    style={{
                        position: 'absolute', top: 14, right: 14, border: 'none',
                        background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                    }}
                >
                    <X size={18} weight="bold" />
                </button>

                <div style={{
                    width: 44, height: 44, borderRadius: 12, marginBottom: 14,
                    background: 'var(--gradient-hero)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                }}>
                    <Robot size={22} weight="duotone" color="#fff" />
                </div>

                <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
                    Bật tự động điền &amp; ứng tuyển
                </h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
                    Copo sẽ thay bạn điền và có thể nộp đơn ứng tuyển trên trang tuyển dụng. Kết quả AI có
                    thể sai sót — bạn nên rà soát trước khi nộp và{' '}
                    <strong style={{ color: 'var(--text-primary)' }}>chịu trách nhiệm về nội dung được gửi đi</strong>.
                    Xem mục 5 &amp; 8 trong{' '}
                    <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue)' }}>
                        Điều khoản sử dụng
                    </a>.
                </p>

                <label style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                    fontSize: '0.84rem', color: 'var(--text-primary)', lineHeight: 1.5,
                    padding: '10px 12px', borderRadius: 10, background: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                }}>
                    <input
                        type="checkbox" checked={agreed} disabled={busy}
                        onChange={(e) => setAgreed(e.target.checked)}
                        style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }}
                    />
                    <span>
                        Tôi hiểu rằng Copo tự động điền/nộp đơn thay tôi và tôi chịu trách nhiệm về nội dung
                        được gửi đi.
                    </span>
                </label>

                {error && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--accent-red, #ef4444)', marginTop: 10 }}>
                        {error}
                    </div>
                )}

                <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                    <button
                        onClick={onCancel} disabled={busy}
                        style={{
                            flex: 1, padding: '11px 12px', borderRadius: 10, cursor: 'pointer',
                            border: '1px solid var(--border-default)', background: 'var(--bg-card)',
                            color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600,
                        }}
                    >
                        Huỷ
                    </button>
                    <button
                        onClick={onConfirm} disabled={!agreed || busy}
                        style={{
                            flex: 1, padding: '11px 12px', borderRadius: 10, border: 'none',
                            background: 'var(--gradient-hero)', color: '#fff', fontSize: '0.85rem',
                            fontWeight: 600, cursor: (!agreed || busy) ? 'default' : 'pointer',
                            opacity: (!agreed || busy) ? 0.55 : 1,
                        }}
                    >
                        {busy ? 'Đang lưu…' : 'Đồng ý & tiếp tục'}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
