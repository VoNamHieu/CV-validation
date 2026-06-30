'use client';

import { useState } from 'react';
import {
    Sparkle, MagicWand, FileText, Briefcase, ArrowRight, SignIn,
    Target, Lightning, CheckCircle, Brain, RocketLaunch,
} from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { useAuth } from '@/lib/auth';

// Landing / front door, shown until the visitor taps "Bắt đầu" (persisted via
// the `entered` flag). Sells the product before dropping the user into the app;
// login isn't forced here — it's requested later only when a paid AI action is
// triggered (see useAuthGate). Self-contained: a <style> block carries the
// animations / hovers / media queries that inline styles can't express.

const STEPS = [
    { icon: FileText, title: 'Tải CV của bạn', desc: 'Kéo thả file PDF. AI đọc kỹ năng, kinh nghiệm, học vấn và suy ra vai trò mục tiêu.' },
    { icon: Brain, title: 'AI tìm công ty đang tuyển', desc: 'Quét các công ty trong mạng lưới và trang tuyển dụng chính thức của họ để tìm vị trí khớp.' },
    { icon: Target, title: 'Chấm điểm độ khớp', desc: 'Mỗi tin được xếp hạng theo CV — biết ngay mình hợp bao nhiêu phần trăm và còn thiếu gì.' },
    { icon: MagicWand, title: 'Tối ưu CV & ứng tuyển', desc: 'AI viết lại CV phù hợp từng vị trí (không bịa nội dung), xuất PDF, sẵn sàng nộp.' },
];

const FEATURES = [
    { icon: Brain, title: 'Phân tích CV bằng AI', desc: 'Trích xuất kỹ năng, kinh nghiệm và suy ra vai trò chỉ từ file PDF.' },
    { icon: Target, title: 'Chấm điểm độ khớp', desc: 'Biết ngay mình hợp bao nhiêu phần trăm với từng vị trí, và vì sao.' },
    { icon: MagicWand, title: 'Tối ưu CV theo job', desc: 'Gợi ý chỉnh CV cho từng vị trí — cam kết không bịa thêm nội dung.' },
    { icon: Briefcase, title: 'Việc từ nguồn thật', desc: 'Link tuyển dụng chính thức của công ty, không phải tin trung gian.' },
    { icon: Lightning, title: 'Hỗ trợ tự động điền', desc: 'Đồng bộ hồ sơ để điền form ứng tuyển nhanh hơn nhiều lần.' },
    { icon: FileText, title: 'Mẫu CV & xuất PDF', desc: 'Chọn mẫu, sửa trực tiếp và tải CV chuẩn PDF chỉ trong vài giây.' },
];

const STATS = [
    { value: '3', label: 'bước từ CV đến việc' },
    { value: '50', label: 'credit miễn phí khi đăng ký' },
    { value: '0', label: 'tin tuyển dụng rác' },
];

// Recognizable employers from the featured pool, shown as a logo marquee for
// social proof. Domains feed a logo CDN; a failed load falls back to the name
// (see LogoItem) so the strip never shows a broken image.
const COMPANIES: { name: string; domain: string }[] = [
    { name: 'Shopee', domain: 'shopee.vn' },
    { name: 'VNG', domain: 'vng.com.vn' },
    { name: 'Tiki', domain: 'tiki.vn' },
    { name: 'MoMo', domain: 'momo.vn' },
    { name: 'Grab', domain: 'grab.com' },
    { name: 'Lazada', domain: 'lazada.vn' },
    { name: 'TikTok', domain: 'tiktok.com' },
    { name: 'Agoda', domain: 'agoda.com' },
    { name: 'Traveloka', domain: 'traveloka.com' },
    { name: 'Visa', domain: 'visa.com' },
    { name: 'Mastercard', domain: 'mastercard.com' },
    { name: 'FPT Software', domain: 'fpt-software.com' },
    { name: 'Techcombank', domain: 'techcombank.com.vn' },
    { name: 'Vietcombank', domain: 'vietcombank.com.vn' },
    { name: 'VPBank', domain: 'vpbank.com.vn' },
    { name: 'Vinamilk', domain: 'vinamilk.com.vn' },
    { name: 'Bosch', domain: 'bosch.com' },
    { name: 'Heineken', domain: 'heineken.com' },
];

// One logo: image from the CDN, falling back to a wordmark on load error.
function LogoItem({ name, domain }: { name: string; domain: string }) {
    const [failed, setFailed] = useState(false);
    if (failed) return <span className="lp-logo-text">{name}</span>;
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            className="lp-logo-img" alt={name} loading="lazy"
            src={`https://logo.clearbit.com/${domain}`}
            onError={() => setFailed(true)}
        />
    );
}

export default function Landing() {
    const enterApp = useAppStore((s) => s.enterApp);
    const { enabled, user, promptLogin } = useAuth();

    // Hard gate: when auth is on and nobody's signed in, every "start" CTA opens
    // the login modal instead of entering the app. Signing in flips the page to
    // the app automatically (see app/page.tsx). Auth off (dev) → enter directly.
    const onStart = () => {
        if (enabled && !user) promptLogin('Đăng nhập để bắt đầu dùng JobFit AI');
        else enterApp();
    };

    return (
        <div className="lp-root">
            <style>{LP_CSS}</style>

            {/* Ambient background */}
            <div className="lp-bg" aria-hidden>
                <div className="lp-orb lp-orb-1" />
                <div className="lp-orb lp-orb-2" />
                <div className="lp-orb lp-orb-3" />
                <div className="lp-grid-overlay" />
            </div>

            {/* Nav */}
            <header className="lp-nav">
                <div className="lp-brand">
                    <span className="lp-logo"><Sparkle size={18} weight="fill" color="#fff" /></span>
                    <span className="lp-brand-name">JobFit AI</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {enabled && !user && (
                        <button className="lp-btn-ghost" onClick={() => promptLogin()}>
                            <SignIn size={15} weight="duotone" /> Đăng nhập
                        </button>
                    )}
                    <button className="lp-btn-primary lp-nav-cta" onClick={onStart}>
                        Vào app <ArrowRight size={15} weight="bold" />
                    </button>
                </div>
            </header>

            {/* Hero */}
            <section className="lp-hero">
                <div className="lp-hero-copy">
                    <span className="lp-badge">
                        <Sparkle size={13} weight="fill" /> Trợ lý tìm việc bằng AI · không bịa nội dung
                    </span>
                    <h1 className="lp-h1">
                        Tải CV lên — AI tìm việc phù hợp và{' '}
                        <span className="lp-grad-text">tối ưu hồ sơ</span> cho bạn
                    </h1>
                    <p className="lp-sub">
                        Phân tích CV, gợi ý công ty đang tuyển, chấm điểm độ khớp và chỉnh CV theo
                        từng vị trí. Từ một file PDF đến danh sách việc phù hợp — chỉ vài phút.
                    </p>
                    <div className="lp-cta-row">
                        <button className="lp-btn-primary lp-btn-lg lp-pulse" onClick={onStart}>
                            <RocketLaunch size={18} weight="fill" /> Bắt đầu miễn phí
                        </button>
                        {enabled && !user && (
                            <button className="lp-btn-ghost lp-btn-lg" onClick={() => promptLogin()}>
                                <SignIn size={16} weight="duotone" /> Đăng nhập
                            </button>
                        )}
                    </div>
                    <div className="lp-trust">
                        <CheckCircle size={15} weight="fill" /> Đăng ký nhanh bằng email
                        <span className="lp-dot" />
                        <CheckCircle size={15} weight="fill" /> Tặng 50 credit khi tạo tài khoản
                    </div>
                </div>

                {/* Product mockup */}
                <div className="lp-mock-wrap">
                    <div className="lp-mock">
                        <div className="lp-mock-bar">
                            <span className="lp-mock-dot" style={{ background: '#ff5f57' }} />
                            <span className="lp-mock-dot" style={{ background: '#febc2e' }} />
                            <span className="lp-mock-dot" style={{ background: '#28c840' }} />
                            <span className="lp-mock-url">jobfit.ai · So khớp</span>
                        </div>
                        <div className="lp-mock-body">
                            <div className="lp-mock-score">
                                <div className="lp-ring">
                                    <span className="lp-ring-num">92<small>%</small></span>
                                </div>
                                <div>
                                    <div className="lp-mock-role">Senior Frontend Engineer</div>
                                    <div className="lp-mock-co"><Briefcase size={12} weight="duotone" /> One Mount · Hà Nội</div>
                                    <span className="lp-chip lp-chip-green"><CheckCircle size={11} weight="fill" /> Độ khớp rất cao</span>
                                </div>
                            </div>
                            {[
                                { t: 'Product Designer (UI/UX)', s: 88, c: 'var(--accent-blue)' },
                                { t: 'Solution Architect', s: 81, c: 'var(--accent-purple)' },
                                { t: 'QC Engineer (Fresher)', s: 67, c: 'var(--accent-amber)' },
                            ].map((j) => (
                                <div key={j.t} className="lp-job">
                                    <div className="lp-job-info">
                                        <span className="lp-job-title">{j.t}</span>
                                        <span className="lp-job-meta">One Mount · Hà Nội</span>
                                    </div>
                                    <div className="lp-bar"><span style={{ width: `${j.s}%`, background: j.c }} /></div>
                                    <span className="lp-job-score">{j.s}%</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="lp-mock-glow" aria-hidden />
                </div>
            </section>

            {/* Stats */}
            <section className="lp-stats">
                {STATS.map((s) => (
                    <div key={s.label} className="lp-stat">
                        <div className="lp-stat-val">{s.value}</div>
                        <div className="lp-stat-label">{s.label}</div>
                    </div>
                ))}
            </section>

            {/* Featured company logos */}
            <section className="lp-logos">
                <p className="lp-logos-title">Việc làm nổi bật từ các công ty như:</p>
                <div className="lp-marquee">
                    <div className="lp-marquee-track">
                        {[...COMPANIES, ...COMPANIES].map((c, i) => (
                            <div className="lp-logo-cell" key={`${c.name}-${i}`}>
                                <LogoItem name={c.name} domain={c.domain} />
                            </div>
                        ))}
                    </div>
                </div>
                <p className="lp-logos-disclaim">
                    Logos are trademarks of their respective owners. Their appearance does not imply endorsement or partnership.
                </p>
            </section>

            {/* How it works */}
            <section className="lp-section lp-how">
                <h2 className="lp-h2">Cách hoạt động</h2>
                <p className="lp-section-sub">Từ một file PDF đến danh sách việc phù hợp đã tối ưu CV — chỉ vài phút, không tin rác.</p>
                <div className="lp-how-flow">
                    {STEPS.map((s, i) => {
                        const Icon = s.icon;
                        return (
                            <div key={s.title} className="lp-how-step">
                                <div className="lp-how-badge">
                                    <Icon size={24} weight="duotone" />
                                    <span className="lp-how-num">{i + 1}</span>
                                </div>
                                <div className="lp-how-title">{s.title}</div>
                                <div className="lp-how-desc">{s.desc}</div>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* Features */}
            <section className="lp-section">
                <h2 className="lp-h2">Mọi thứ bạn cần để ứng tuyển thông minh hơn</h2>
                <div className="lp-features">
                    {FEATURES.map((f) => {
                        const Icon = f.icon;
                        return (
                            <div key={f.title} className="lp-feature">
                                <span className="lp-feature-icon"><Icon size={20} weight="duotone" /></span>
                                <div className="lp-feature-title">{f.title}</div>
                                <div className="lp-feature-desc">{f.desc}</div>
                            </div>
                        );
                    })}
                </div>
            </section>

            {/* CTA band */}
            <section className="lp-cta-band">
                <div className="lp-cta-inner">
                    <h2 className="lp-cta-title">Sẵn sàng tìm việc phù hợp?</h2>
                    <p className="lp-cta-desc">Tải CV lên và xem AI làm việc — miễn phí để bắt đầu.</p>
                    <button className="lp-btn-primary lp-btn-lg" onClick={onStart}>
                        <RocketLaunch size={18} weight="fill" /> Bắt đầu ngay
                    </button>
                </div>
            </section>

            <footer className="lp-footer">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <span className="lp-logo lp-logo-sm"><Sparkle size={13} weight="fill" color="#fff" /></span>
                    JobFit AI · Vận hành bởi AI · Cam kết không bịa nội dung
                </div>
                <div className="lp-footer-links">
                    <a href="/privacy">Quyền riêng tư</a>
                    <span>·</span>
                    <a href="/terms">Điều khoản sử dụng</a>
                    <span>·</span>
                    <a href="mailto:vonamhieu.work@gmail.com">Liên hệ</a>
                </div>
            </footer>
        </div>
    );
}

const LP_CSS = `
.lp-root { min-height: 100vh; position: relative; overflow-x: hidden; color: var(--text-primary); }
.lp-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; background: var(--bg-primary); }
.lp-grid-overlay { position: absolute; inset: 0; background:
  linear-gradient(var(--border-subtle) 1px, transparent 1px) 0 0 / 44px 44px,
  linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px) 0 0 / 44px 44px;
  mask-image: radial-gradient(ellipse 80% 50% at 50% 0%, #000 35%, transparent 75%); opacity: 0.5; }
.lp-orb { position: absolute; border-radius: 50%; filter: blur(70px); opacity: 0.55; }
.lp-orb-1 { width: 460px; height: 460px; top: -160px; left: -120px; background: radial-gradient(circle, #6366f1, transparent 70%); animation: lp-float 16s ease-in-out infinite; }
.lp-orb-2 { width: 520px; height: 520px; top: -120px; right: -160px; background: radial-gradient(circle, #8b5cf6, transparent 70%); animation: lp-float 20s ease-in-out infinite reverse; }
.lp-orb-3 { width: 420px; height: 420px; top: 520px; left: 40%; background: radial-gradient(circle, #22d3ee, transparent 70%); opacity: 0.28; animation: lp-float 24s ease-in-out infinite; }
@keyframes lp-float { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(40px,30px) scale(1.08); } }

.lp-nav, .lp-hero, .lp-stats, .lp-logos, .lp-section, .lp-cta-band, .lp-footer { position: relative; z-index: 1; }
.lp-nav { max-width: 1120px; margin: 0 auto; padding: 20px 24px; display: flex; align-items: center; justify-content: space-between; }
.lp-brand { display: flex; align-items: center; gap: 10px; }
.lp-logo { width: 34px; height: 34px; border-radius: 10px; background: var(--gradient-hero); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(99,102,241,0.4); }
.lp-logo-sm { width: 24px; height: 24px; border-radius: 7px; }
.lp-brand-name { font-weight: 800; font-size: 1.05rem; letter-spacing: -0.02em; background: var(--gradient-hero); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }

.lp-btn-primary { display: inline-flex; align-items: center; gap: 8px; border: none; cursor: pointer; font-weight: 700; color: #fff; background: var(--gradient-hero); border-radius: 12px; padding: 10px 18px; font-size: 0.86rem; box-shadow: 0 6px 20px rgba(99,102,241,0.35); transition: transform .2s var(--ease-spring), box-shadow .2s ease; }
.lp-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(99,102,241,0.5); }
.lp-btn-ghost { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; font-size: 0.86rem; color: var(--text-primary); background: var(--bg-glass); border: 1px solid var(--border-default); border-radius: 12px; padding: 10px 16px; backdrop-filter: blur(8px); transition: border-color .2s, transform .2s; }
.lp-btn-ghost:hover { border-color: var(--border-accent); transform: translateY(-1px); }
.lp-btn-lg { padding: 14px 26px; font-size: 0.95rem; border-radius: 14px; }
.lp-pulse { position: relative; }
.lp-pulse::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: 0 0 0 0 rgba(124,58,237,0.5); animation: lp-pulse 2.6s ease-out infinite; }
@keyframes lp-pulse { 0% { box-shadow: 0 0 0 0 rgba(124,58,237,0.45); } 70%,100% { box-shadow: 0 0 0 18px rgba(124,58,237,0); } }

.lp-hero { max-width: 1120px; margin: 0 auto; padding: 40px 24px 30px; display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 48px; align-items: center; }
.lp-hero-copy { animation: lp-rise .7s var(--ease-out-expo) both; }
.lp-badge { display: inline-flex; align-items: center; gap: 7px; font-size: 0.76rem; font-weight: 600; color: var(--accent-purple); background: var(--gradient-hero-subtle); border: 1px solid var(--border-subtle); padding: 6px 14px; border-radius: 999px; margin-bottom: 20px; }
.lp-h1 { font-size: clamp(2rem, 4.6vw, 3.3rem); font-weight: 800; line-height: 1.08; letter-spacing: -0.03em; margin: 0 0 18px; }
.lp-grad-text { background: var(--gradient-hero); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.lp-sub { font-size: 1.02rem; color: var(--text-secondary); line-height: 1.6; max-width: 520px; margin: 0 0 28px; }
.lp-cta-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.lp-trust { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.8rem; color: var(--text-muted); }
.lp-trust svg { color: var(--accent-green); }
.lp-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--text-muted); margin: 0 4px; }

/* Product mockup */
.lp-mock-wrap { position: relative; animation: lp-rise .7s var(--ease-out-expo) .12s both; }
.lp-mock-glow { position: absolute; inset: 8% 4%; background: var(--gradient-hero); filter: blur(60px); opacity: 0.28; z-index: -1; border-radius: 40px; }
.lp-mock { border-radius: 18px; border: 1px solid var(--border-default); background: var(--bg-card); box-shadow: var(--shadow-card-hover), 0 30px 80px rgba(0,0,0,0.18); overflow: hidden; transform: perspective(1400px) rotateY(-8deg) rotateX(4deg); transition: transform .5s var(--ease-out-expo); }
.lp-mock-wrap:hover .lp-mock { transform: perspective(1400px) rotateY(0deg) rotateX(0deg); }
.lp-mock-bar { display: flex; align-items: center; gap: 7px; padding: 11px 14px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-elevated); }
.lp-mock-dot { width: 10px; height: 10px; border-radius: 50%; }
.lp-mock-url { margin-left: 10px; font-size: 0.72rem; color: var(--text-muted); }
.lp-mock-body { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.lp-mock-score { display: flex; align-items: center; gap: 16px; padding-bottom: 14px; border-bottom: 1px dashed var(--border-subtle); }
.lp-ring { position: relative; width: 76px; height: 76px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: conic-gradient(var(--accent-purple) 0% 92%, var(--border-subtle) 92% 100%); }
.lp-ring::before { content: ''; position: absolute; width: 60px; height: 60px; border-radius: 50%; background: var(--bg-card); }
.lp-ring-num { position: relative; font-weight: 800; font-size: 1.25rem; color: var(--text-primary); }
.lp-ring-num small { font-size: 0.7rem; font-weight: 700; color: var(--text-muted); }
.lp-mock-role { font-weight: 700; font-size: 0.95rem; }
.lp-mock-co { display: flex; align-items: center; gap: 5px; font-size: 0.76rem; color: var(--text-muted); margin: 3px 0 7px; }
.lp-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 0.7rem; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
.lp-chip-green { color: var(--accent-green); background: color-mix(in srgb, var(--accent-green) 14%, transparent); }
.lp-job { display: flex; align-items: center; gap: 12px; }
.lp-job-info { flex: 1; min-width: 0; }
.lp-job-title { display: block; font-size: 0.82rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp-job-meta { font-size: 0.7rem; color: var(--text-muted); }
.lp-bar { width: 84px; height: 6px; border-radius: 999px; background: var(--border-subtle); overflow: hidden; flex-shrink: 0; }
.lp-bar span { display: block; height: 100%; border-radius: 999px; }
.lp-job-score { font-size: 0.76rem; font-weight: 700; color: var(--text-secondary); width: 34px; text-align: right; }

/* Stats */
.lp-stats { max-width: 800px; margin: 26px auto; padding: 22px 24px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; border: 1px solid var(--border-subtle); border-radius: 18px; background: var(--bg-glass); backdrop-filter: blur(10px); }
.lp-stat { text-align: center; }
.lp-stat-val { font-size: clamp(1.5rem, 3vw, 2rem); font-weight: 800; letter-spacing: -0.02em; background: var(--gradient-hero); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.lp-stat-label { font-size: 0.74rem; color: var(--text-muted); margin-top: 2px; }

/* Featured logos marquee */
.lp-logos { max-width: 1120px; margin: 18px auto 0; padding: 26px 24px; text-align: center; }
.lp-logos-title { font-size: 0.82rem; font-weight: 600; color: var(--text-muted); margin: 0 0 20px; }
.lp-marquee { position: relative; overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent); }
.lp-marquee-track { display: flex; align-items: center; width: max-content; animation: lp-scroll 45s linear infinite; }
.lp-marquee:hover .lp-marquee-track { animation-play-state: paused; }
.lp-logo-cell { flex-shrink: 0; height: 40px; margin: 0 26px; display: flex; align-items: center; justify-content: center; }
.lp-logo-img { height: 30px; width: auto; max-width: 132px; object-fit: contain; filter: grayscale(1); opacity: 0.6; transition: filter .25s, opacity .25s; }
.lp-logo-cell:hover .lp-logo-img { filter: none; opacity: 1; }
.lp-logo-text { font-weight: 800; font-size: 1.05rem; letter-spacing: -0.01em; color: var(--text-secondary); white-space: nowrap; opacity: 0.75; }
.lp-logo-cell:hover .lp-logo-text { color: var(--text-primary); opacity: 1; }
.lp-logos-disclaim { font-size: 0.66rem; color: var(--text-muted); opacity: 0.65; margin: 22px auto 0; max-width: 540px; line-height: 1.5; }
@keyframes lp-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }

/* Sections */
.lp-section { max-width: 1000px; margin: 0 auto; padding: 56px 24px; text-align: center; }
.lp-h2 { font-size: clamp(1.4rem, 3vw, 2rem); font-weight: 800; letter-spacing: -0.025em; margin: 0 0 10px; }
.lp-section-sub { font-size: 0.92rem; color: var(--text-muted); max-width: 460px; margin: 0 auto 36px; }
.lp-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.lp-step { position: relative; text-align: left; padding: 24px 20px; border-radius: 16px; border: 1px solid var(--border-subtle); background: var(--bg-card); transition: transform .25s, border-color .25s; }
.lp-step:hover { transform: translateY(-4px); border-color: var(--border-accent); }
.lp-step-num { position: absolute; top: 16px; right: 18px; font-size: 1.6rem; font-weight: 800; color: var(--border-default); }
.lp-step-icon, .lp-feature-icon { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 12px; margin-bottom: 14px; color: #fff; background: var(--gradient-hero); box-shadow: 0 6px 18px rgba(99,102,241,0.32); }
.lp-step-title { font-weight: 700; font-size: 1rem; margin-bottom: 6px; }
.lp-step-desc, .lp-feature-desc { font-size: 0.83rem; color: var(--text-muted); line-height: 1.55; }

/* How it works — connected step flow */
.lp-how-flow { display: flex; gap: 8px; margin-top: 12px; }
.lp-how-step { position: relative; flex: 1; padding: 0 12px; text-align: center; }
.lp-how-step:not(:last-child)::after { content: ''; position: absolute; top: 28px; left: calc(50% + 36px); right: calc(-50% + 36px); height: 2px; background: linear-gradient(90deg, var(--border-accent), var(--border-subtle)); }
.lp-how-badge { position: relative; width: 56px; height: 56px; margin: 0 auto 18px; border-radius: 16px; display: flex; align-items: center; justify-content: center; color: #fff; background: var(--gradient-hero); box-shadow: 0 8px 22px rgba(99,102,241,0.35); }
.lp-how-num { position: absolute; top: -8px; right: -8px; width: 22px; height: 22px; border-radius: 50%; background: var(--bg-card); border: 1px solid var(--border-default); color: var(--text-primary); font-size: 0.72rem; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.lp-how-title { font-weight: 700; font-size: 0.98rem; margin-bottom: 6px; }
.lp-how-desc { font-size: 0.83rem; color: var(--text-muted); line-height: 1.55; max-width: 220px; margin: 0 auto; }
@media (max-width: 880px) {
  .lp-how-flow { flex-direction: column; gap: 26px; max-width: 360px; margin: 12px auto 0; }
  .lp-how-step { padding: 0; }
  .lp-how-step:not(:last-child)::after { display: none; }
  .lp-how-desc { max-width: none; }
}

.lp-features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; text-align: left; }
.lp-feature { padding: 22px 20px; border-radius: 16px; border: 1px solid var(--border-subtle); background: var(--gradient-card), var(--bg-card); transition: transform .25s var(--ease-spring), border-color .25s, box-shadow .25s; }
.lp-feature:hover { transform: translateY(-5px); border-color: var(--border-accent); box-shadow: var(--shadow-card-hover); }
.lp-feature-icon { width: 40px; height: 40px; border-radius: 11px; }
.lp-feature-title { font-weight: 700; font-size: 0.95rem; margin-bottom: 6px; }

/* CTA band */
.lp-cta-band { max-width: 1000px; margin: 20px auto 0; padding: 0 24px; }
.lp-cta-inner { border-radius: 24px; padding: 52px 32px; text-align: center; background: var(--gradient-hero); position: relative; overflow: hidden; box-shadow: 0 24px 60px rgba(99,102,241,0.4); }
.lp-cta-inner::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at 70% 0%, rgba(255,255,255,0.25), transparent 55%); }
.lp-cta-title { position: relative; font-size: clamp(1.5rem, 3.5vw, 2.2rem); font-weight: 800; color: #fff; margin: 0 0 8px; letter-spacing: -0.02em; }
.lp-cta-desc { position: relative; color: rgba(255,255,255,0.9); font-size: 0.95rem; margin: 0 0 24px; }
.lp-cta-band .lp-btn-primary { position: relative; background: #fff; color: #4f46e5; box-shadow: 0 10px 30px rgba(0,0,0,0.18); }
.lp-cta-band .lp-btn-primary:hover { box-shadow: 0 14px 40px rgba(0,0,0,0.28); }

.lp-footer { max-width: 1000px; margin: 0 auto; padding: 40px 24px 48px; display: flex; flex-direction: column; align-items: center; gap: 12px; font-size: 0.78rem; color: var(--text-muted); }
.lp-footer-links { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
.lp-footer-links a { color: var(--text-secondary); text-decoration: none; font-weight: 500; }
.lp-footer-links a:hover { color: var(--text-primary); }

@keyframes lp-rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }

@media (max-width: 880px) {
  .lp-hero { grid-template-columns: 1fr; gap: 32px; padding-top: 24px; text-align: center; }
  .lp-hero-copy { display: flex; flex-direction: column; align-items: center; }
  .lp-cta-row, .lp-trust { justify-content: center; }
  .lp-mock { transform: none; }
  .lp-steps, .lp-features { grid-template-columns: 1fr; }
  .lp-stats { grid-template-columns: repeat(2, 1fr); gap: 20px 12px; }
  .lp-nav-cta { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .lp-orb, .lp-pulse::after { animation: none; }
  .lp-hero-copy, .lp-mock-wrap { animation: none; }
  .lp-mock { transform: none; }
  .lp-marquee-track { animation: none; }
}
`;
