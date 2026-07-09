'use client';

import { useState, useEffect } from 'react';
import {
    Sparkle, MagicWand, FileText, Briefcase, ArrowRight, SignIn,
    Target, Lightning, CheckCircle, Brain, RocketLaunch,
    FilePdf, MagnifyingGlass, GlobeHemisphereWest, DownloadSimple,
    Buildings, Play, Pause,
} from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { useAuth } from '@/lib/auth';
import { catalog } from '@/lib/db';

// Landing / front door, shown until the visitor taps "Bắt đầu" (persisted via
// the `entered` flag). Sells the product before dropping the user into the app;
// login isn't forced here — it's requested later only when a paid AI action is
// triggered (see useAuthGate). Self-contained: a <style> block carries the
// animations / hovers / media queries that inline styles can't express.

const STEPS = [
    { icon: FileText, title: 'Tải CV của bạn', desc: 'Kéo thả file PDF. AI đọc kỹ năng, kinh nghiệm, học vấn và suy ra vai trò mục tiêu.' },
    { icon: Brain, title: 'AI tìm công ty đang tuyển', desc: 'Quét các công ty trong mạng lưới và trang tuyển dụng chính thức của họ để tìm vị trí khớp.' },
    { icon: Target, title: 'Chấm điểm độ khớp', desc: 'Mỗi tin được xếp hạng theo CV, biết ngay mình hợp bao nhiêu phần trăm và còn thiếu gì.' },
    { icon: MagicWand, title: 'Tối ưu CV & ứng tuyển', desc: 'AI viết lại CV phù hợp từng vị trí (không bịa nội dung), xuất PDF, sẵn sàng nộp.' },
];

const FEATURES = [
    { icon: Brain, title: 'Phân tích CV bằng AI', desc: 'Trích xuất kỹ năng, kinh nghiệm và suy ra vai trò chỉ từ file PDF.' },
    { icon: Target, title: 'Chấm điểm độ khớp', desc: 'Biết ngay mình hợp bao nhiêu phần trăm với từng vị trí, và vì sao.' },
    { icon: MagicWand, title: 'Tối ưu CV theo job', desc: 'Gợi ý chỉnh CV cho từng vị trí, cam kết không bịa thêm nội dung.' },
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
    { name: 'Visa', domain: 'visa.com.vn' },
    { name: 'Mastercard', domain: 'mastercard.com' },
    { name: 'FPT Software', domain: 'fpt-software.com' },
    { name: 'Techcombank', domain: 'techcombank.com.vn' },
    { name: 'Vietcombank', domain: 'vietcombank.com.vn' },
    { name: 'VPBank', domain: 'vpbank.com.vn' },
    { name: 'Vinamilk', domain: 'vinamilk.com.vn' },
    { name: 'Bosch', domain: 'bosch.com.vn' },
    { name: 'Heineken', domain: 'heinekenvietnam.com' },
];

// One logo, resolved in a 3-stage fallback so admin-uploaded brands take
// priority: our stored company logo (by domain) → Clearbit CDN guess →
// wordmark. Each stage advances on the previous <img>'s load error.
function LogoItem({ name, domain }: { name: string; domain: string }) {
    const [stage, setStage] = useState<0 | 1 | 2>(0);
    if (stage === 2) return <span className="lp-logo-text">{name}</span>;
    const src = stage === 0
        ? catalog.companyLogoUrlByDomain(domain)
        : `https://logo.clearbit.com/${domain}`;
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            key={stage}
            className="lp-logo-img" alt={name} loading="lazy"
            src={src}
            onError={() => setStage((s) => (s + 1) as 0 | 1 | 2)}
        />
    );
}

// Auto-playing, video-style walkthrough of the flow: CV → tìm việc khắp nơi →
// chấm điểm → tối ưu CV. Pure CSS/JS — no real video asset. Scenes advance on a
// timer (paused on hover or via the play/pause button) and the timeline tabs let
// the visitor jump. Respects prefers-reduced-motion (no auto-advance there).
const DEMO_SCENES = [
    { label: 'Tải CV', icon: FilePdf, ms: 3400 },
    { label: 'Tìm việc khắp nơi', icon: GlobeHemisphereWest, ms: 4200 },
    { label: 'Chấm điểm độ khớp', icon: Target, ms: 4000 },
    { label: 'Tối ưu CV', icon: MagicWand, ms: 3800 },
];

const DEMO_JOBS = [
    { t: 'Senior Frontend Engineer', co: 'One Mount', s: 92, c: 'var(--accent-purple)' },
    { t: 'Product Designer (UI/UX)', co: 'MoMo', s: 88, c: 'var(--accent-blue)' },
    { t: 'Solution Architect', co: 'FPT Software', s: 81, c: 'var(--accent-purple)' },
    { t: 'QC Engineer (Fresher)', co: 'Tiki', s: 67, c: 'var(--accent-amber)' },
];

const DEMO_SOURCES = [
    'Trang tuyển dụng chính thức của công ty',
    'Cổng nghề nghiệp doanh nghiệp',
    'Mạng lưới công ty đang tuyển',
    'Trang career của tập đoàn',
];

function DemoPlayer() {
    const [scene, setScene] = useState(0);
    const [paused, setPaused] = useState(false);
    const [reduced, setReduced] = useState(false);

    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setReduced(mq.matches);
        update();
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, []);

    useEffect(() => {
        if (paused || reduced) return;
        const id = setTimeout(
            () => setScene((s) => (s + 1) % DEMO_SCENES.length),
            DEMO_SCENES[scene].ms,
        );
        return () => clearTimeout(id);
    }, [scene, paused, reduced]);

    return (
        <div
            className="lp-demo-frame"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
        >
            <div className="lp-mock-bar">
                <span className="lp-mock-dot" style={{ background: '#ff5f57' }} />
                <span className="lp-mock-dot" style={{ background: '#febc2e' }} />
                <span className="lp-mock-dot" style={{ background: '#28c840' }} />
                <span className="lp-mock-url">copo.ai · Demo</span>
                <button
                    className="lp-demo-play"
                    onClick={() => setPaused((p) => !p)}
                    aria-label={paused ? 'Phát demo' : 'Tạm dừng demo'}
                >
                    {paused ? <Play size={12} weight="fill" /> : <Pause size={12} weight="fill" />}
                </button>
            </div>

            <div className="lp-demo-stage">
                {/* Scene 1 — Tải CV */}
                <div className={`lp-scene ${scene === 0 ? 'is-on' : ''}`} aria-hidden={scene !== 0}>
                    <div className="lp-drop">
                        <div className="lp-drop-card">
                            <FilePdf size={26} weight="duotone" />
                            <div>
                                <div className="lp-drop-name">Nguyen_Van_A_CV.pdf</div>
                                <div className="lp-drop-meta">AI đang đọc kỹ năng & kinh nghiệm…</div>
                            </div>
                            <span className="lp-scan-line" />
                        </div>
                        <div className="lp-chips">
                            {['React', 'TypeScript', '5 năm KN', 'Frontend', 'Team lead'].map((c, i) => (
                                <span key={c} className="lp-chip2" style={{ animationDelay: `${0.5 + i * 0.28}s` }}>
                                    <CheckCircle size={11} weight="fill" /> {c}
                                </span>
                            ))}
                        </div>
                        <div className="lp-role-out">
                            <Brain size={14} weight="duotone" /> Vai trò mục tiêu: <b>Senior Frontend Engineer</b>
                        </div>
                    </div>
                </div>

                {/* Scene 2 — Tìm việc khắp nơi */}
                <div className={`lp-scene ${scene === 1 ? 'is-on' : ''}`} aria-hidden={scene !== 1}>
                    <div className="lp-search">
                        <div className="lp-radar">
                            <GlobeHemisphereWest size={34} weight="duotone" />
                            <span className="lp-ping" /><span className="lp-ping lp-ping-2" />
                            {scene === 1 && <span className="lp-radar-sweep" />}
                        </div>
                        <div className="lp-search-side">
                            <div className="lp-search-head">
                                <MagnifyingGlass size={14} weight="bold" /> Đang tìm việc phù hợp ở khắp nơi…
                            </div>
                            {DEMO_SOURCES.map((src, i) => (
                                <div key={src} className="lp-src" style={{ animationDelay: `${0.3 + i * 0.5}s` }}>
                                    <Buildings size={13} weight="duotone" />
                                    <span className="lp-src-name">{src}</span>
                                    <CheckCircle size={14} weight="fill" className="lp-src-ok" />
                                </div>
                            ))}
                            <div className="lp-search-count">
                                <b>132</b> vị trí · <b>24</b> công ty đang tuyển
                            </div>
                        </div>
                    </div>
                </div>

                {/* Scene 3 — Chấm điểm độ khớp */}
                <div className={`lp-scene ${scene === 2 ? 'is-on' : ''}`} aria-hidden={scene !== 2}>
                    <div className="lp-score-scene">
                        <div className="lp-mock-score">
                            <div className="lp-ring"><span className="lp-ring-num">92<small>%</small></span></div>
                            <div>
                                <div className="lp-mock-role">Senior Frontend Engineer</div>
                                <div className="lp-mock-co"><Briefcase size={12} weight="duotone" /> One Mount · Hà Nội</div>
                                <span className="lp-chip lp-chip-green"><CheckCircle size={11} weight="fill" /> Độ khớp rất cao</span>
                            </div>
                        </div>
                        {DEMO_JOBS.slice(1).map((j, i) => (
                            <div key={j.t} className="lp-job lp-job-anim" style={{ animationDelay: `${0.2 + i * 0.2}s` }}>
                                <div className="lp-job-info">
                                    <span className="lp-job-title">{j.t}</span>
                                    <span className="lp-job-meta">{j.co}</span>
                                </div>
                                <div className="lp-bar">
                                    <span style={{ width: scene === 2 ? `${j.s}%` : '0%', background: j.c }} />
                                </div>
                                <span className="lp-job-score">{j.s}%</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Scene 4 — Tối ưu CV */}
                <div className={`lp-scene ${scene === 3 ? 'is-on' : ''}`} aria-hidden={scene !== 3}>
                    <div className="lp-cv-scene">
                        <div className="lp-cv-doc">
                            <div className="lp-cv-h" />
                            <div className="lp-cv-line lp-cv-hl" style={{ animationDelay: '.3s' }} />
                            <div className="lp-cv-line" style={{ width: '92%' }} />
                            <div className="lp-cv-line lp-cv-hl" style={{ animationDelay: '.7s', width: '78%' }} />
                            <div className="lp-cv-line" style={{ width: '88%' }} />
                            <div className="lp-cv-line" style={{ width: '64%' }} />
                            <div className="lp-cv-line lp-cv-hl" style={{ animationDelay: '1.1s', width: '70%' }} />
                        </div>
                        <div className="lp-cv-side">
                            <span className="lp-chip lp-chip-green"><MagicWand size={11} weight="fill" /> Tối ưu cho Senior Frontend Engineer</span>
                            <div className="lp-cv-note"><CheckCircle size={13} weight="fill" /> Viết lại theo JD, không bịa nội dung</div>
                            <div className="lp-cv-note"><CheckCircle size={13} weight="fill" /> Làm nổi bật kỹ năng khớp nhất</div>
                            <button className="lp-cv-export"><DownloadSimple size={14} weight="bold" /> Xuất PDF</button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Timeline */}
            <div className="lp-timeline">
                {DEMO_SCENES.map((sc, i) => {
                    const Icon = sc.icon;
                    return (
                        <button
                            key={sc.label}
                            className={`lp-tl-tab ${scene === i ? 'is-active' : ''}`}
                            onClick={() => setScene(i)}
                        >
                            <span className="lp-tl-label"><Icon size={13} weight="duotone" /> {sc.label}</span>
                            <span className="lp-tl-track">
                                <span
                                    className="lp-tl-fill"
                                    style={
                                        scene === i && !paused && !reduced
                                            ? { animation: `lp-tl-grow ${sc.ms}ms linear forwards` }
                                            : { width: scene > i ? '100%' : scene === i ? '100%' : '0%' }
                                    }
                                />
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export default function Landing() {
    const enterApp = useAppStore((s) => s.enterApp);
    const { enabled, user, promptLogin } = useAuth();

    // Hard gate: when auth is on and nobody's signed in, every "start" CTA opens
    // the login modal instead of entering the app. Signing in flips the page to
    // the app automatically (see app/page.tsx). Auth off (dev) → enter directly.
    const onStart = () => {
        if (enabled && !user) promptLogin('Đăng nhập để bắt đầu dùng Copo');
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
                    <span className="lp-brand-name">Copo</span>
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
                        <Sparkle size={13} weight="fill" /> Tự động tìm việc khắp nơi bằng AI · không bịa nội dung
                    </span>
                    <h1 className="lp-h1">
                        Tải CV lên, AI tự động tìm kiếm job{' '}
                        <span className="lp-grad-text">ở bất cứ đâu</span> cho bạn
                    </h1>
                    <p className="lp-sub">
                        Phân tích CV, tự động tìm job khớp ở mọi nơi, chấm điểm độ phù hợp và chỉnh CV
                        theo từng vị trí. Từ một file PDF đến danh sách việc phù hợp, chỉ vài phút.
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
                            <span className="lp-mock-url">copo.ai · So khớp</span>
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
                <p className="lp-section-sub">Từ một file PDF đến danh sách việc phù hợp đã tối ưu CV, chỉ vài phút, không tin rác.</p>
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
                <div className="lp-demo-wrap">
                    <DemoPlayer />
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
                    <h2 className="lp-cta-title">Sẵn sàng để AI tự động tìm job khắp nơi?</h2>
                    <p className="lp-cta-desc">Tải CV lên và xem AI làm việc, miễn phí để bắt đầu.</p>
                    <button className="lp-btn-primary lp-btn-lg" onClick={onStart}>
                        <RocketLaunch size={18} weight="fill" /> Bắt đầu ngay
                    </button>
                </div>
            </section>

            <footer className="lp-footer">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <span className="lp-logo lp-logo-sm"><Sparkle size={13} weight="fill" color="#fff" /></span>
                    Copo · Vận hành bởi AI · Cam kết không bịa nội dung
                </div>
                <div className="lp-footer-links">
                    <a href="/privacy">Quyền riêng tư</a>
                    <span>·</span>
                    <a href="/terms">Điều khoản sử dụng</a>
                    <span>·</span>
                    <a href="mailto:charles@copoai.net">Liên hệ</a>
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

/* ── Demo player ───────────────────────────────────────────── */
.lp-demo-wrap { max-width: 720px; margin: 48px auto 0; }
.lp-demo-frame { border-radius: 18px; border: 1px solid var(--border-default); background: var(--bg-card); box-shadow: var(--shadow-card-hover), 0 30px 80px rgba(0,0,0,0.16); overflow: hidden; text-align: left; }
.lp-demo-frame .lp-mock-bar { position: relative; }
.lp-demo-play { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px; border-radius: 7px; border: 1px solid var(--border-default); background: var(--bg-glass); color: var(--text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: color .2s, border-color .2s; }
.lp-demo-play:hover { color: var(--text-primary); border-color: var(--border-accent); }
.lp-demo-stage { position: relative; height: 300px; padding: 22px; }
.lp-scene { position: absolute; inset: 22px; opacity: 0; transform: translateY(10px) scale(.99); pointer-events: none; transition: opacity .45s ease, transform .45s var(--ease-out-expo); display: flex; flex-direction: column; justify-content: center; }
.lp-scene.is-on { opacity: 1; transform: none; pointer-events: auto; }

/* Scene 1 — upload */
.lp-drop { display: flex; flex-direction: column; gap: 14px; align-items: center; }
.lp-drop-card { position: relative; display: flex; align-items: center; gap: 12px; width: 100%; max-width: 380px; padding: 14px 16px; border-radius: 13px; border: 1px dashed var(--border-accent); background: var(--gradient-hero-subtle); color: var(--accent-purple); overflow: hidden; }
.lp-drop-name { font-weight: 700; font-size: 0.86rem; color: var(--text-primary); }
.lp-drop-meta { font-size: 0.74rem; color: var(--text-muted); margin-top: 2px; }
.lp-scan-line { position: absolute; left: 0; top: 0; width: 100%; height: 2px; background: linear-gradient(90deg, transparent, var(--accent-purple), transparent); animation: lp-scanline 1.8s ease-in-out infinite; }
@keyframes lp-scanline { 0% { transform: translateY(0); } 50% { transform: translateY(54px); } 100% { transform: translateY(0); } }
.lp-chips { display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; max-width: 420px; }
.lp-chip2 { display: inline-flex; align-items: center; gap: 4px; font-size: 0.72rem; font-weight: 600; color: var(--text-secondary); background: var(--bg-elevated); border: 1px solid var(--border-subtle); padding: 4px 10px; border-radius: 999px; opacity: 0; animation: lp-pop .4s var(--ease-spring) forwards; }
.lp-chip2 svg { color: var(--accent-green); }
@keyframes lp-pop { from { opacity: 0; transform: scale(.8) translateY(6px); } to { opacity: 1; transform: none; } }
.lp-role-out { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--text-secondary); }
.lp-role-out b { color: var(--text-primary); }
.lp-role-out svg { color: var(--accent-purple); }

/* Scene 2 — search everywhere */
.lp-search { display: flex; align-items: center; gap: 26px; }
.lp-radar { position: relative; width: 110px; height: 110px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: var(--accent-purple); background: var(--gradient-hero-subtle); border: 1px solid var(--border-subtle); }
.lp-ping { position: absolute; inset: 0; border-radius: 50%; border: 2px solid var(--accent-purple); opacity: 0; animation: lp-ping 2.4s ease-out infinite; }
.lp-ping-2 { animation-delay: 1.2s; }
@keyframes lp-ping { 0% { transform: scale(.55); opacity: .6; } 100% { transform: scale(1.25); opacity: 0; } }
.lp-radar-sweep { position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, var(--accent-purple) 35%, transparent) 50deg, transparent 80deg); animation: lp-sweep 2.2s linear infinite; }
@keyframes lp-sweep { to { transform: rotate(360deg); } }
.lp-search-side { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
.lp-search-head { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 3px; }
.lp-search-head svg { color: var(--accent-purple); }
.lp-src { display: flex; align-items: center; gap: 8px; font-size: 0.78rem; color: var(--text-secondary); padding: 6px 10px; border-radius: 9px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); opacity: 0; animation: lp-slidein .45s var(--ease-out-expo) forwards; }
.lp-src svg:first-child { color: var(--text-muted); flex-shrink: 0; }
.lp-src-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp-src-ok { color: var(--accent-green); flex-shrink: 0; }
@keyframes lp-slidein { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
.lp-search-count { font-size: 0.78rem; color: var(--text-muted); margin-top: 4px; }
.lp-search-count b { color: var(--accent-purple); font-weight: 800; }

/* Scene 3 — scoring (reuses hero mock classes) */
.lp-score-scene { display: flex; flex-direction: column; gap: 12px; }
.lp-job-anim { opacity: 0; animation: lp-slidein .5s var(--ease-out-expo) forwards; }
.lp-score-scene .lp-bar span { transition: width 1s var(--ease-out-expo) .3s; }

/* Scene 4 — optimize CV */
.lp-cv-scene { display: flex; gap: 22px; align-items: center; }
.lp-cv-doc { width: 200px; flex-shrink: 0; padding: 16px; border-radius: 10px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 9px; box-shadow: var(--shadow-card-hover); }
.lp-cv-h { height: 12px; width: 60%; border-radius: 4px; background: var(--gradient-hero); }
.lp-cv-line { height: 8px; width: 100%; border-radius: 4px; background: var(--border-default); }
.lp-cv-hl { background: color-mix(in srgb, var(--accent-purple) 30%, var(--border-default)); animation: lp-hl 2.6s ease-in-out infinite; }
@keyframes lp-hl { 0%,100% { background: var(--border-default); } 50% { background: color-mix(in srgb, var(--accent-purple) 45%, transparent); } }
.lp-cv-side { flex: 1; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.lp-cv-note { display: flex; align-items: center; gap: 7px; font-size: 0.78rem; color: var(--text-secondary); }
.lp-cv-note svg { color: var(--accent-green); flex-shrink: 0; }
.lp-cv-export { display: inline-flex; align-items: center; gap: 7px; margin-top: 4px; padding: 9px 16px; border: none; cursor: pointer; font-weight: 700; font-size: 0.82rem; color: #fff; background: var(--gradient-hero); border-radius: 11px; box-shadow: 0 6px 18px rgba(99,102,241,0.3); }

/* Timeline */
.lp-timeline { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; padding: 10px; border-top: 1px solid var(--border-subtle); background: var(--bg-elevated); }
.lp-tl-tab { display: flex; flex-direction: column; gap: 7px; padding: 7px 8px; border: none; background: transparent; cursor: pointer; border-radius: 9px; transition: background .2s; }
.lp-tl-tab:hover { background: var(--bg-glass); }
.lp-tl-label { display: flex; align-items: center; gap: 5px; font-size: 0.72rem; font-weight: 600; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color .2s; }
.lp-tl-tab.is-active .lp-tl-label { color: var(--text-primary); }
.lp-tl-track { height: 3px; border-radius: 999px; background: var(--border-subtle); overflow: hidden; }
.lp-tl-fill { display: block; height: 100%; width: 0; border-radius: 999px; background: var(--gradient-hero); }
@keyframes lp-tl-grow { from { width: 0; } to { width: 100%; } }
@media (max-width: 880px) {
  .lp-demo-stage { height: auto; min-height: 340px; }
  .lp-search { flex-direction: column; gap: 18px; text-align: center; }
  .lp-cv-scene { flex-direction: column; }
  .lp-cv-doc { width: 100%; }
  .lp-tl-label { font-size: 0; gap: 0; }
  .lp-tl-label svg { font-size: initial; }
}

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
  .lp-scan-line, .lp-ping, .lp-radar-sweep, .lp-cv-hl { animation: none; }
  .lp-scene { transition: opacity .2s ease; transform: none; }
  .lp-chip2, .lp-src, .lp-job-anim { opacity: 1; animation: none; }
}
`;
