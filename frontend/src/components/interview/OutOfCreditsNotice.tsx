'use client';

// Shown when an interview action returns 402. Reuses the app-wide top-up flow
// (CreditRequestModal) instead of a bare error string, and refreshes the
// balance widget after a grant.
import { useState } from 'react';
import { Coins } from '@phosphor-icons/react';
import { useAuth } from '@/lib/auth';
import { useCredits } from '@/lib/credits-context';
import CreditRequestModal from '@/components/CreditRequestModal';

export default function OutOfCreditsNotice({ message }: { message?: string }) {
    const { user } = useAuth();
    const { refresh } = useCredits();
    const [topupOpen, setTopupOpen] = useState(false);

    return (
        <div style={{
            marginTop: 12, padding: '12px 14px', borderRadius: 'var(--radius-sm)',
            background: 'rgba(251, 191, 36, 0.08)', border: '1px solid rgba(251, 191, 36, 0.3)',
        }}>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <Coins size={15} weight="duotone" style={{ color: 'var(--accent-amber)', marginTop: 1, flexShrink: 0 }} />
                {message || 'Bạn đã hết credit cho tính năng này.'}
            </p>
            <button
                onClick={() => setTopupOpen(true)}
                className="btn-primary"
                style={{ marginTop: 10, padding: '7px 14px', fontSize: '0.8rem' }}
            >
                Nạp thêm credit
            </button>
            {topupOpen && (
                <CreditRequestModal
                    email={user?.email ?? ''}
                    onClose={() => setTopupOpen(false)}
                    onGranted={refresh}
                />
            )}
        </div>
    );
}
