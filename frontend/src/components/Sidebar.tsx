'use client';

import { useAppStore, AppView } from '@/store/useAppStore';
import { Sparkle, MagicWand, Briefcase, MagnifyingGlass } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

interface NavItem {
    id: AppView;
    label: string;
    icon: Icon;
    description: string;
}

const NAV_ITEMS: NavItem[] = [
    { id: 'apply', label: 'Apply', icon: MagicWand, description: 'CV · Match · Optimize' },
    { id: 'browse', label: 'Browse', icon: MagnifyingGlass, description: 'Explore roles · no CV' },
    { id: 'history', label: 'History', icon: Briefcase, description: 'Saved applications' },
];

export const SIDEBAR_WIDTH = 232;

export default function Sidebar() {
    const view = useAppStore((s) => s.view);
    const setView = useAppStore((s) => s.setView);
    const historyCount = useAppStore((s) => s.jobHistory.length);

    return (
        <aside
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                bottom: 0,
                width: SIDEBAR_WIDTH,
                background: 'rgba(17, 17, 17, 0.92)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                borderRight: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                padding: '20px 14px',
                gap: 18,
                zIndex: 50,
            }}
        >
            {/* Brand */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px' }}>
                <div
                    style={{
                        width: 34, height: 34, borderRadius: 10,
                        background: 'var(--gradient-hero)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 2px 10px rgba(99, 102, 241, 0.3)',
                    }}
                >
                    <Sparkle size={17} weight="fill" color="white" />
                </div>
                <span
                    style={{
                        fontWeight: 700,
                        fontSize: '0.98rem',
                        letterSpacing: '-0.02em',
                        background: 'var(--gradient-hero)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                    }}
                >
                    JobFit AI
                </span>
            </div>

            {/* Nav */}
            <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
                {NAV_ITEMS.map((item) => {
                    const isActive = view === item.id;
                    const Icon = item.icon;
                    const showBadge = item.id === 'history' && historyCount > 0;

                    return (
                        <button
                            key={item.id}
                            onClick={() => setView(item.id)}
                            aria-current={isActive ? 'page' : undefined}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                padding: '10px 12px',
                                borderRadius: 10,
                                border: '1px solid transparent',
                                background: isActive ? 'var(--gradient-hero-subtle)' : 'transparent',
                                borderColor: isActive ? 'var(--border-subtle)' : 'transparent',
                                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                                cursor: 'pointer',
                                width: '100%',
                                textAlign: 'left',
                                transition: 'all 0.18s ease',
                            }}
                            onMouseEnter={(e) => {
                                if (!isActive) {
                                    e.currentTarget.style.background = 'var(--bg-card)';
                                    e.currentTarget.style.color = 'var(--text-primary)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isActive) {
                                    e.currentTarget.style.background = 'transparent';
                                    e.currentTarget.style.color = 'var(--text-secondary)';
                                }
                            }}
                        >
                            <div
                                style={{
                                    width: 28, height: 28, borderRadius: 8,
                                    background: isActive ? 'var(--gradient-hero)' : 'var(--bg-card)',
                                    border: '1px solid',
                                    borderColor: isActive ? 'transparent' : 'var(--border-subtle)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                <Icon size={14} weight={isActive ? 'fill' : 'duotone'} color={isActive ? 'white' : 'currentColor'} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontWeight: 600, fontSize: '0.85rem', letterSpacing: '-0.01em' }}>
                                        {item.label}
                                    </span>
                                    {showBadge && (
                                        <span
                                            style={{
                                                fontSize: '0.65rem',
                                                fontWeight: 700,
                                                padding: '1px 7px',
                                                borderRadius: 10,
                                                background: isActive ? 'rgba(255,255,255,0.15)' : 'var(--bg-elevated)',
                                                color: isActive ? 'white' : 'var(--text-secondary)',
                                                lineHeight: 1.5,
                                            }}
                                        >
                                            {historyCount}
                                        </span>
                                    )}
                                </div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 1 }}>
                                    {item.description}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </nav>

            {/* Footer */}
            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 12px', borderRadius: 10,
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500,
                    }}
                >
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-green)' }} />
                    AI Online
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', padding: '0 8px', opacity: 0.7 }}>
                    Powered by Gemini · No hallucination
                </div>
            </div>
        </aside>
    );
}
