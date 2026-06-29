'use client';

import { Sparkle, MagicWand, FileText, Briefcase, ArrowRight, SignIn } from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { useAuth } from '@/lib/auth';

// Landing / front door, shown until the visitor taps "Bắt đầu" (persisted via
// the `entered` flag). Sells the product before dropping the user into the app;
// login isn't forced here — it's requested later only when a paid AI action is
// triggered (see useAuthGate).
const FEATURES = [
    { icon: FileText, title: 'Phân tích CV bằng AI', desc: 'Tải CV lên, AI trích xuất kỹ năng, kinh nghiệm và suy ra vai trò phù hợp.' },
    { icon: MagicWand, title: 'So khớp & tối ưu', desc: 'Chấm điểm độ khớp với từng việc và gợi ý chỉnh CV — không bịa nội dung.' },
    { icon: Briefcase, title: 'Việc từ trang tuyển dụng thật', desc: 'Gợi ý công ty và link tuyển dụng chính thức của họ, không phải tin rác.' },
];

export default function Landing() {
    const enterApp = useAppStore((s) => s.enterApp);
    const { enabled, user, promptLogin } = useAuth();

    return (
        <div style={{ minHeight: '100vh', position: 'relative', overflow: 'hidden' }}>
            <div style={{
                position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
                background: 'var(--gradient-mesh)',
            }} />

            <div style={{
                position: 'relative', zIndex: 1, maxWidth: 880, margin: '0 auto',
                padding: '72px 24px 64px', display: 'flex', flexDirection: 'column', alignItems: 'center',
                textAlign: 'center',
            }}>
                {/* Brand */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
                    <div style={{
                        width: 38, height: 38, borderRadius: 11, background: 'var(--gradient-hero)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 2px 12px rgba(99, 102, 241, 0.35)',
                    }}>
                        <Sparkle size={19} weight="fill" color="white" />
                    </div>
                    <span style={{
                        fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-0.02em',
                        background: 'var(--gradient-hero)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                    }}>
                        JobFit AI
                    </span>
                </div>

                <h1 style={{
                    fontSize: 'clamp(1.8rem, 5vw, 3rem)', fontWeight: 800, lineHeight: 1.1,
                    letterSpacing: '-0.03em', margin: '0 0 16px', color: 'var(--text-primary)',
                    maxWidth: 720,
                }}>
                    Tải CV lên — để AI tìm việc phù hợp và{' '}
                    <span style={{ background: 'var(--gradient-hero)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                        tối ưu hồ sơ
                    </span>{' '}
                    cho bạn
                </h1>
                <p style={{
                    fontSize: '1rem', color: 'var(--text-secondary)', maxWidth: 560,
                    lineHeight: 1.6, margin: '0 0 32px',
                }}>
                    Trợ lý tìm việc bằng AI: phân tích CV, gợi ý công ty đang tuyển, chấm điểm độ khớp
                    và chỉnh CV theo từng vị trí — cam kết không bịa nội dung.
                </p>

                {/* CTAs */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 12 }}>
                    <button
                        className="btn-primary"
                        onClick={enterApp}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 30px', fontSize: '0.92rem' }}
                    >
                        Bắt đầu miễn phí <ArrowRight size={17} weight="bold" />
                    </button>
                    {enabled && !user && (
                        <button
                            onClick={() => promptLogin()}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8, padding: '13px 24px',
                                fontSize: '0.92rem', fontWeight: 600, cursor: 'pointer',
                                borderRadius: 'var(--radius-sm, 10px)', color: 'var(--text-primary)',
                                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                            }}
                        >
                            <SignIn size={16} weight="duotone" /> Đăng nhập
                        </button>
                    )}
                </div>
                <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0 0 48px' }}>
                    Dùng thử không cần đăng nhập · tặng 50 credit khi tạo tài khoản
                </p>

                {/* Features */}
                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 16, width: '100%', textAlign: 'left',
                }}>
                    {FEATURES.map((f) => {
                        const Icon = f.icon;
                        return (
                            <div key={f.title} className="glass-card" style={{ padding: '18px 18px 20px' }}>
                                <div style={{
                                    width: 34, height: 34, borderRadius: 9, marginBottom: 12,
                                    background: 'var(--gradient-hero-subtle, rgba(99,102,241,0.12))',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <Icon size={18} weight="duotone" style={{ color: 'var(--accent-purple, #8b5cf6)' }} />
                                </div>
                                <div style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--text-primary)', marginBottom: 5 }}>
                                    {f.title}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
                                    {f.desc}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
