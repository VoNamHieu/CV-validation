'use client';

import { useState, useEffect, useRef } from 'react';
import {
    MagicWand, FileText, Briefcase, ArrowRight, SignIn,
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


// Curated brand logos for the "opportunities from top companies" strip — real
// artwork under public/logos (transparent, professional), shown grayscale.
const FEATURED_LOGOS: { name: string; src: string; h: number }[] = [
    { name: 'Bosch', src: '/logos/bosch.webp', h: 24 },
    { name: 'Unilever', src: '/logos/unilever.png', h: 34 },
    { name: 'Visa', src: '/logos/visa.png', h: 26 },
    { name: 'NVIDIA', src: '/logos/nvidia.png', h: 35 },
    { name: 'Grab', src: '/logos/grab.png', h: 27 },
    { name: 'TikTok', src: '/logos/tiktok.png', h: 32 },
    { name: 'Vinamilk', src: '/logos/vinamilk.png', h: 30 },
    { name: 'VNG', src: '/logos/vng.webp', h: 22 },
    { name: 'Vingroup', src: '/logos/vingroup.webp', h: 34 },
    { name: 'Vietcombank', src: '/logos/vietcombank.webp', h: 27 },
];

const JOB_BANNERS = [
    'linear-gradient(135deg, #fbe9e4, #f2ccc1)',
    'linear-gradient(135deg, #e8eef6, #d0dae9)',
    'linear-gradient(135deg, #ece7f4, #d6cbe9)',
    'linear-gradient(135deg, #e6f0ea, #cfe3d7)',
];
type JobCard = { title: string; co: string; loc: string; badge: string; tags: string[]; note: string; logo: string; slug?: string };
type PromotedCard = { slug: string; title?: string; company_name?: string; location?: string; role_family?: string; seniority?: string; has_logo?: boolean };
function seniorityBadge(sen?: string): string {
    const v = (sen || '').toLowerCase();
    if (v.includes('intern') || v.includes('thực tập')) return 'Thực tập';
    if (v.includes('fresh') || v.includes('junior') || v.includes('entry') || v.includes('graduate')) return 'Fresher';
    if (v.includes('senior') || v.includes('lead') || v.includes('manager') || v.includes('cao')) return 'Cấp cao';
    return 'Toàn thời gian';
}
const JOBS: JobCard[] = [
    { title: 'Product Intern (Supply Chain)', co: 'Bosch', loc: 'Hà Nội', badge: 'Thực tập', tags: ['Supply Chain', 'Excel', 'SAP'], note: 'Phù hợp cao với hồ sơ', logo: '/logos/bosch.webp' },
    { title: 'Brand Management Intern', co: 'Unilever', loc: 'TP. HCM', badge: 'Fresher', tags: ['Marketing', 'Analytics', 'FMCG'], note: '92 người xem hôm nay', logo: '/logos/unilever.png' },
    { title: 'Software Engineer (New Grad)', co: 'NVIDIA', loc: 'Remote', badge: 'Toàn thời gian', tags: ['Python', 'System Design', 'AI'], note: 'Đang tuyển gấp', logo: '/logos/nvidia.png' },
    { title: 'Data Analyst Intern', co: 'Grab', loc: 'Singapore', badge: 'Thực tập', tags: ['SQL', 'Dashboard', 'A/B'], note: 'Hạn nộp 20/07', logo: '/logos/grab.png' },
    { title: 'Chuyên viên Sản phẩm', co: 'VNG', loc: 'TP. HCM', badge: 'Toàn thời gian', tags: ['Product', 'SQL', 'Figma'], note: 'Phù hợp 88% hồ sơ', logo: '/logos/vng.webp' },
    { title: 'Financial Analyst', co: 'Vietcombank', loc: 'Hà Nội', badge: 'Fresher', tags: ['Finance', 'Excel', 'Modeling'], note: 'Đang tuyển gấp', logo: '/logos/vietcombank.webp' },
];

// Company logo tile inside the hero dashboard — the real uploaded logo (by
// domain), falling back to a monogram tile on load error.
function MockLogo({ domain, m, cls }: { domain: string; m: string; cls: string }) {
    const [failed, setFailed] = useState(false);
    if (failed || !domain) return <span className={cls}>{m}</span>;
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={cls} alt={m} loading="lazy" src={catalog.companyLogoUrlByDomain(domain)}
            style={{ objectFit: 'cover', background: '#fff' }} onError={() => setFailed(true)} />
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
    { t: 'Senior Frontend Engineer', co: 'One Mount', s: 92, c: '#eb3a2b' },
    { t: 'Product Designer (UI/UX)', co: 'MoMo', s: 88, c: 'var(--accent-blue)' },
    { t: 'Solution Architect', co: 'FPT Software', s: 81, c: '#eb3a2b' },
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
    const logoRowRef = useRef<HTMLDivElement>(null);
    const [logoAtStart, setLogoAtStart] = useState(true);
    const [logoAtEnd, setLogoAtEnd] = useState(false);
    const scrollLogos = (dir: number) => logoRowRef.current?.scrollBy({ left: dir * 340, behavior: 'smooth' });
    const onLogoScroll = () => {
        const el = logoRowRef.current;
        if (!el) return;
        setLogoAtStart(el.scrollLeft <= 4);
        setLogoAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
    };
    useEffect(() => {
        const el = logoRowRef.current;
        if (el) setLogoAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
    }, []);
    const jobRowRef = useRef<HTMLDivElement>(null);
    const [jobAtStart, setJobAtStart] = useState(true);
    const [jobAtEnd, setJobAtEnd] = useState(false);
    const scrollJobs = (dir: number) => jobRowRef.current?.scrollBy({ left: dir * 344, behavior: 'smooth' });
    const onJobScroll = () => {
        const el = jobRowRef.current;
        if (!el) return;
        setJobAtStart(el.scrollLeft <= 4);
        setJobAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
    };
    useEffect(() => {
        const el = jobRowRef.current;
        if (el) setJobAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
    }, []);
    const [navScrolled, setNavScrolled] = useState(false);
    useEffect(() => {
        const onScroll = () => setNavScrolled(window.scrollY > 24);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);
    const [jobs, setJobs] = useState<JobCard[]>(JOBS);
    useEffect(() => {
        let alive = true;
        fetch('/api/store/promoted/featured?limit=12')
            .then((r) => (r.ok ? r.json() : null))
            .then((rows: PromotedCard[] | null) => {
                if (!alive || !Array.isArray(rows) || rows.length === 0) return;
                setJobs(rows.map((r) => ({
                    title: r.title || 'Vị trí đang tuyển',
                    co: r.company_name || '',
                    loc: r.location || 'Việt Nam',
                    badge: seniorityBadge(r.seniority),
                    tags: [r.role_family].filter((t): t is string => !!t),
                    note: 'Xem chi tiết',
                    logo: r.has_logo ? `/api/store/promoted/logo-by-slug/${encodeURIComponent(r.slug)}` : '',
                    slug: r.slug,
                })));
            })
            .catch(() => {});
        return () => { alive = false; };
    }, []);

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
                <div className="lp-grid-overlay" />
            </div>

            {/* Nav */}
            <header className={`lp-nav${navScrolled ? ' is-scrolled' : ''}`}>
                <div className="lp-brand">
                    <span className="lp-logo"><img className="lp-logo-mark" src="/copo-logo.png" alt="Copo" /></span>
                    <span className="lp-brand-name">Copo</span>
                </div>
                <nav className="lp-nav-links">
                    <a href="#featured">Cơ hội</a>
                    <a href="#how">Cách hoạt động</a>
                </nav>
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
                    <h1 className="lp-h1">
                        CV của bạn.<br />
                        Cơ hội phù hợp.<br />
                        <span className="lp-grad-text">Copo lo.</span>
                    </h1>
                    <p className="lp-sub">
                        Copo tự động phân tích CV, tìm kiếm công việc phù hợp để tối ưu
                        và giúp bạn apply tự động nhiều job cùng một lúc.
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

                {/* Product mockup — CV↔job analysis dashboard (all CSS/SVG, no image) */}
                <div className="lp-mock-wrap">
                    <div className="lp-frame">
                        <div className="lp-dash">
                            <div className="lp-hd">
                                <MockLogo domain="bosch.com.vn" m="BO" cls="lp-hd-logo" />
                                <span className="lp-hd-co">Bosch</span>
                                <span className="lp-hd-sep">·</span>
                                <span className="lp-hd-role">Product Intern (Supply Chain)</span>
                                <span className="lp-hd-sp" />
                                <span className="lp-hd-bk">♡</span>
                            </div>
                            <div className="lp-split">
                              {/* feature 1 — CV analysis & optimization (left) */}
                              <div className="lp-panel">
                                <div className="lp-panel-hd"><span className="lp-live" /> Phân tích &amp; tối ưu CV<span className="lp-panel-tag">đang chạy</span></div>
                                <div className="lp-grid2">
                                {/* col A — overall match + ATS */}
                                <div>
                                    <div className="lp-lbl">Overall Match</div>
                                    <div className="lp-donut"><span className="lp-donut-num">87<small>%</small></span></div>
                                    <div className="lp-delta">↑ 21% vs. base CV</div>
                                    <div className="lp-chips2">
                                        <span className="lp-chip lp-chip-purple">High Fit</span>
                                        <span className="lp-chip lp-chip-soft">ATS Ready</span>
                                    </div>
                                    <div className="lp-ats2">
                                        <div className="lp-lbl">ATS Resume Score</div>
                                        <div className="lp-ats-row2">
                                            <span className="lp-ats-num2">78<small>/100</small></span>
                                            <span className="lp-ats-good"><span className="lp-gdot" /> Good</span>
                                        </div>
                                        <div className="lp-improve">Improve with Copo →</div>
                                    </div>
                                </div>
                                {/* col B — skills */}
                                <div>
                                    <div className="lp-lbl">Top skills this job values</div>
                                    {[
                                        { m: 'SP', t: 'Supply Planning', v: 90 },
                                        { m: 'SAP', t: 'SAP', v: 88 },
                                        { m: 'XL', t: 'Excel', v: 88 },
                                        { m: 'EN', t: 'English', v: 76 },
                                        { m: 'JP', t: 'Japanese', v: 65 },
                                    ].map((s) => (
                                        <div key={s.t} className="lp-sk-row">
                                            <span className="lp-sk-ic2">{s.m}</span>
                                            <div className="lp-sk-b">
                                                <div className="lp-sk-top"><span className="lp-sk-name">{s.t}</span><span className="lp-sk-pct">{s.v}%</span></div>
                                                <div className="lp-sk-track"><span style={{ width: `${s.v}%` }} /></div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                </div>
                              </div>
                              {/* feature 2 — auto-apply, running in parallel (right) */}
                              <div className="lp-panel lp-panel-apply">
                                    <div className="lp-panel-hd"><span className="lp-live" /> Tự động ứng tuyển<span className="lp-apc-count">3/6</span></div>
                                    {[
                                        { m: 'FS', co: 'FPT Software', d: 'fpt-software.com', st: 'done' },
                                        { m: 'VN', co: 'VNG', d: 'vng.com.vn', st: 'done' },
                                        { m: 'MA', co: 'Maersk', d: 'maersk.com', st: 'done' },
                                        { m: 'TK', co: 'Tiki', d: 'tiki.vn', st: 'doing' },
                                        { m: 'KV', co: 'KiotViet', d: 'kiotviet.vn', st: 'queue' },
                                        { m: 'BO', co: 'Bosch', d: 'bosch.com.vn', st: 'opt' },
                                    ].map((j) => (
                                        <div key={j.co} className="lp-apc-row">
                                            <MockLogo domain={j.d} m={j.m} cls="lp-apc-logo" />
                                            <span className="lp-apc-co">{j.co}</span>
                                            {j.st === 'done' && <span className="lp-apc-st lp-apc-done"><CheckCircle size={10} weight="fill" /> Đã nộp</span>}
                                            {j.st === 'doing' && <span className="lp-apc-st lp-apc-doing"><span className="lp-apc-spin" /> Đang nộp</span>}
                                            {j.st === 'queue' && <span className="lp-apc-st lp-apc-queue">Chờ</span>}
                                            {j.st === 'opt' && <span className="lp-apc-st lp-apc-opt"><span className="lp-apc-spin lp-apc-spin-p" /> Đang tối ưu</span>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="lp-mock-glow" aria-hidden />
                </div>
            </section>

            {/* Featured company logos */}
            <section className="lp-logos">
                <p className="lp-logos-title">Cơ hội việc làm từ các công ty hàng đầu</p>
                <div className="lp-logos-carousel">
                    {!logoAtStart && (
                        <button type="button" className="lp-logos-arrow lp-logos-arrow-l" onClick={() => scrollLogos(-1)} aria-label="Xem trước">‹</button>
                    )}
                    <div className="lp-logo-row" ref={logoRowRef} onScroll={onLogoScroll} data-scrolled={!logoAtStart}>
                        {FEATURED_LOGOS.map((l) => (
                            <div className="lp-logo-cell" key={l.name}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img className="lp-logo-img" src={l.src} alt={l.name} style={{ height: l.h }} loading="lazy" />
                            </div>
                        ))}
                    </div>
                    {!logoAtEnd && (
                        <button type="button" className="lp-logos-arrow lp-logos-arrow-r" onClick={() => scrollLogos(1)} aria-label="Xem thêm">›</button>
                    )}
                </div>
                <p className="lp-logos-disclaim">
                    Logos are trademarks of their respective owners. Their appearance does not imply endorsement or partnership.
                </p>
            </section>

            {/* Featured opportunities */}
            <section className="lp-featured" id="featured">
                <div className="lp-featured-head">
                    <div>
                        <h2 className="lp-h2 lp-featured-title">Cơ hội nổi bật</h2>
                        <p className="lp-featured-sub">Vị trí tuyển chọn từ các công ty hàng đầu, cập nhật mỗi ngày.</p>
                    </div>
                    <button type="button" className="lp-featured-all" onClick={onStart}>Xem tất cả cơ hội <ArrowRight size={14} weight="bold" /></button>
                </div>
                <div className="lp-jobs-carousel">
                    {!jobAtStart && (
                        <button type="button" className="lp-logos-arrow lp-logos-arrow-l" onClick={() => scrollJobs(-1)} aria-label="Trước">‹</button>
                    )}
                    <div className="lp-jobs-row" ref={jobRowRef} onScroll={onJobScroll} data-scrolled={!jobAtStart}>
                        {jobs.map((j, i) => (
                            <a className="lp-job-card" key={j.slug || `${j.title}-${i}`} href={j.slug ? `/j/${j.slug}` : undefined}>
                                <div className="lp-job-banner" style={{ background: JOB_BANNERS[i % JOB_BANNERS.length] }}>
                                    <span className="lp-job-badge">{j.badge}</span>
                                    <span className="lp-job-logo">
                                        {j.logo ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={j.logo} alt={j.co} />
                                        ) : (
                                            <span className="lp-job-mono">{(j.co || '?').charAt(0)}</span>
                                        )}
                                    </span>
                                </div>
                                <div className="lp-job-body">
                                    <h3 className="lp-job-title">{j.title}</h3>
                                    <div className="lp-job-meta">{j.co}{j.loc ? ` · ${j.loc}` : ''}</div>
                                    {j.tags.length > 0 && <div className="lp-job-tags">{j.tags.map((t) => <span key={t}>{t}</span>)}</div>}
                                    <div className="lp-job-foot"><span className="lp-job-dot" /> {j.note}</div>
                                </div>
                            </a>
                        ))}
                    </div>
                    {!jobAtEnd && (
                        <button type="button" className="lp-logos-arrow lp-logos-arrow-r" onClick={() => scrollJobs(1)} aria-label="Sau">›</button>
                    )}
                </div>
            </section>

            {/* How it works */}
            <section className="lp-section lp-how" id="how">
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
                    <span className="lp-logo lp-logo-sm"><img className="lp-logo-mark" src="/copo-logo.png" alt="Copo" /></span>
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
.lp-root { min-height: 100vh; position: relative; overflow-x: hidden; color: var(--text-primary); padding-top: 42px; }
/* Copo signature ground — warm, muted, low-saturation gradient (not the generic purple/blue AI wash) */
.lp-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
  background:
    radial-gradient(72% 52% at 84% -8%, rgba(238,110,88,.15), transparent 56%),
    radial-gradient(66% 52% at 4% 104%, rgba(235,58,43,.09), transparent 60%),
    radial-gradient(58% 44% at 52% 110%, rgba(242,160,130,.07), transparent 62%),
    linear-gradient(158deg, #fdf4f1 0%, #fbf4f1 46%, #f9f4f1 100%); }
[data-theme="dark"] .lp-bg {
  background:
    radial-gradient(72% 52% at 84% -8%, rgba(238,110,88,.10), transparent 58%),
    radial-gradient(66% 52% at 4% 104%, rgba(235,58,43,.09), transparent 60%),
    linear-gradient(158deg, #161010 0%, #14100e 55%, #120f0e 100%); }
.lp-grid-overlay { position: absolute; inset: 0; background:
  linear-gradient(var(--border-subtle) 1px, transparent 1px) 0 0 / 44px 44px,
  linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px) 0 0 / 44px 44px;
  mask-image: radial-gradient(ellipse 80% 50% at 50% 0%, #000 35%, transparent 70%); opacity: 0.1; }
@keyframes lp-float { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(40px,30px) scale(1.08); } }

.lp-nav, .lp-hero, .lp-stats, .lp-logos, .lp-section, .lp-cta-band, .lp-footer { position: relative; z-index: 1; }
.lp-nav { position: fixed; top: 12px; left: 0; right: 0; z-index: 50; max-width: 1400px; margin: 0 auto; padding: 13px 16px 13px 24px; display: flex; align-items: center; justify-content: space-between; gap: 16px;
  background: linear-gradient(180deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.28) 100%); -webkit-backdrop-filter: blur(16px) saturate(1.5); backdrop-filter: blur(16px) saturate(1.5);
  border: 1px solid rgba(255,255,255,0.55); border-radius: 20px; box-shadow: 0 6px 22px rgba(30,18,22,0.06), inset 0 1px 0 rgba(255,255,255,0.85);
  transition: max-width .45s var(--ease-out-expo), padding .35s ease, background .3s ease, box-shadow .3s ease, border-radius .3s ease, border-color .3s ease, backdrop-filter .3s ease, -webkit-backdrop-filter .3s ease; }
.lp-nav.is-scrolled { max-width: 1080px; padding: 9px 12px 9px 18px;
  background: linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(255,255,255,0.52) 100%); -webkit-backdrop-filter: blur(30px) saturate(2); backdrop-filter: blur(30px) saturate(2);
  border-color: rgba(255,255,255,0.66); border-radius: 16px; box-shadow: 0 16px 44px rgba(30,18,22,0.14), inset 0 1px 0 rgba(255,255,255,0.92); }
[data-theme="dark"] .lp-nav { background: rgba(22,20,26,0.34); border-color: rgba(255,255,255,0.08); }
[data-theme="dark"] .lp-nav.is-scrolled { background: rgba(22,20,26,0.62); border-color: rgba(255,255,255,0.12); box-shadow: 0 16px 44px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08); }
.lp-nav-links { display: flex; align-items: center; gap: 4px; }
.lp-nav-links a { font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); text-decoration: none; padding: 8px 15px; border-radius: 10px; transition: background .2s, color .2s; }
.lp-nav-links a:hover { color: #eb3a2b; background: rgba(235,58,43,0.07); }
.lp-brand { display: flex; align-items: center; gap: 10px; }
.lp-logo { width: 34px; height: 34px; border-radius: 10px; background: #fff; display: flex; align-items: center; justify-content: center; padding: 3px; overflow: hidden; box-shadow: 0 4px 14px rgba(20,20,45,0.14); }
.lp-logo-mark { width: 100%; height: 100%; object-fit: contain; display: block; }
.lp-logo-sm { width: 24px; height: 24px; border-radius: 7px; }
.lp-brand-name { font-weight: 800; font-size: 1.05rem; letter-spacing: -0.02em; background: linear-gradient(135deg, #eb3a2b 0%, #f5795a 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }

.lp-btn-primary { display: inline-flex; align-items: center; gap: 8px; border: none; cursor: pointer; font-weight: 700; color: #fff; background: linear-gradient(158deg, #2a2730 0%, #141317 100%); border-radius: 12px; padding: 10px 18px; font-size: 0.86rem; box-shadow: 0 6px 18px rgba(18,16,22,0.30), inset 0 1px 0 rgba(255,255,255,0.06); transition: transform .2s var(--ease-spring), box-shadow .2s ease; }
[data-theme="dark"] .lp-btn-primary { background: linear-gradient(158deg, #38343e 0%, #201e24 100%); }
.lp-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(235,58,43,0.32); }
.lp-btn-ghost { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-weight: 600; font-size: 0.86rem; color: var(--text-primary); background: var(--bg-glass); border: 1px solid var(--border-default); border-radius: 12px; padding: 10px 16px; backdrop-filter: blur(8px); transition: border-color .2s, transform .2s; }
.lp-btn-ghost:hover { border-color: var(--border-accent); transform: translateY(-1px); }
.lp-btn-lg { padding: 14px 26px; font-size: 0.95rem; border-radius: 14px; }
.lp-pulse { position: relative; }
.lp-pulse::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: 0 0 0 0 rgba(230,60,45,0.5); animation: lp-pulse 2.6s ease-out infinite; }
@keyframes lp-pulse { 0% { box-shadow: 0 0 0 0 rgba(230,60,45,0.45); } 70%,100% { box-shadow: 0 0 0 18px rgba(230,60,45,0); } }

.lp-hero { max-width: 1460px; margin: 0 auto; padding: 40px 52px 30px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 46px; align-items: center; }
.lp-hero-copy { padding-left: 40px; animation: lp-rise .7s var(--ease-out-expo) both; }
.lp-badge { display: inline-flex; align-items: center; gap: 7px; font-size: 0.76rem; font-weight: 600; color: #eb3a2b; background: linear-gradient(135deg, rgba(224,85,114,0.08), rgba(242,160,138,0.05)); border: 1px solid var(--border-subtle); padding: 6px 14px; border-radius: 999px; margin-bottom: 20px; }
.lp-h1 { font-size: clamp(2.1rem, 4.8vw, 3.5rem); font-weight: 800; line-height: 1.16; letter-spacing: -0.03em; margin: 0 0 18px; }
.lp-grad-text { background: linear-gradient(135deg, #eb3a2b 0%, #f5795a 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.lp-sub { font-size: 1.02rem; color: var(--text-secondary); line-height: 1.6; max-width: 520px; margin: 0 0 28px; }
.lp-cta-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.lp-trust { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 0.8rem; color: var(--text-muted); }
.lp-trust svg { color: var(--accent-green); }
.lp-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--text-muted); margin: 0 4px; }

/* Product mockup — CV↔job analysis dashboard (glass frame + 3 cols, all CSS/SVG) */
.lp-mock-wrap { position: relative; display: flex; justify-content: flex-end; overflow: visible; perspective: 2400px; animation: lp-rise .7s var(--ease-out-expo) .12s both; }
/* mesh glow behind — irregular multi-hue blobs, heavy blur → melt unevenly */
.lp-mock-glow { position: absolute; inset: -16% -8% -18% -8%; z-index: -1; border-radius: 90px; filter: blur(66px); background:
  radial-gradient(34% 40% at 24% 32%, rgba(230,60,45,.30), transparent 60%),
  radial-gradient(30% 36% at 66% 18%, rgba(220,55,42,.26), transparent 62%),
  radial-gradient(40% 46% at 86% 60%, rgba(245,150,125,.28), transparent 60%),
  radial-gradient(32% 40% at 42% 84%, rgba(235,80,60,.24), transparent 62%),
  radial-gradient(26% 30% at 58% 48%, rgba(240,120,100,.22), transparent 58%),
  radial-gradient(24% 28% at 12% 70%, rgba(230,90,70,.16), transparent 60%); transition: transform .6s var(--ease-out-expo), filter .6s ease, opacity .6s ease; }
.lp-mock-wrap:hover .lp-mock-glow { transform: scale(1.05); filter: blur(72px) saturate(1.05); }
/* frosted-glass frame */
.lp-frame { padding: 16px; border-radius: 32px; border: 1px solid rgba(255,255,255,.7);
  transform: rotateY(-5deg) rotateX(1.5deg); transform-origin: center; transition: transform .55s var(--ease-out-expo), box-shadow .55s var(--ease-out-expo);
  background: linear-gradient(180deg, rgba(255,255,255,.55), rgba(255,255,255,.30));
  box-shadow: 0 50px 110px rgba(220,55,42,.22), 0 12px 34px rgba(80,60,150,.12), inset 0 1px 0 rgba(255,255,255,.85);
  backdrop-filter: blur(22px) saturate(150%); -webkit-backdrop-filter: blur(22px) saturate(150%); }
.lp-mock-wrap:hover .lp-frame { transform: rotateY(-1.5deg) rotateX(.5deg) translateY(-8px) scale(1.012); box-shadow: 0 66px 140px rgba(220,55,42,.30), 0 18px 44px rgba(80,60,150,.17), inset 0 1px 0 rgba(255,255,255,.92); }
/* dashboard card — stacked radial surface, light (product screenshot) */
.lp-dash { position: relative; width: 700px; overflow: hidden; border-radius: 22px; border: 1px solid rgba(24,20,26,.09); padding: 24px 26px; color: #211d22;
  background:
    radial-gradient(120% 90% at 100% -6%, rgba(235,58,43,.07), transparent 55%),
    linear-gradient(180deg, #fdf7f5, #fbf2f0);
  box-shadow: 0 30px 66px rgba(30,18,22,.16), 0 6px 16px rgba(30,18,22,.07), inset 0 1px 0 rgba(255,255,255,.85); }
.lp-hd { display: flex; align-items: center; gap: 9px; margin-bottom: 18px; }
.lp-hd-logo { width: 24px; height: 24px; border-radius: 7px; background: #20222e; color: #fff; display: grid; place-items: center; font-size: .56rem; font-weight: 800; overflow: hidden; }
.lp-hd-co { font-size: .8rem; font-weight: 700; }
.lp-hd-sep { color: #a3a4bb; }
.lp-hd-role { font-size: .76rem; font-weight: 600; color: #eb3a2b; background: #fdeeea; padding: 5px 11px; border-radius: 8px; }
.lp-hd-sp { flex: 1; }
.lp-hd-bk { width: 26px; height: 26px; border-radius: 8px; background: #fdefeb; display: grid; place-items: center; color: #f6a58f; font-size: .8rem; }
/* two parallel feature panels inside the modal — slightly separated */
.lp-split { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; align-items: stretch; }
.lp-panel { position: relative; border: 1px solid rgba(24,20,26,.08); border-radius: 15px; padding: 15px 16px;
  background: #ffffff; box-shadow: 0 6px 18px rgba(30,18,22,.06), inset 0 1px 0 #fff; }
.lp-panel-apply { background: #ffffff; }
.lp-panel-hd { display: flex; align-items: center; gap: 7px; font-size: .69rem; font-weight: 800; color: #26283a; letter-spacing: .2px; margin-bottom: 15px; }
.lp-panel-hd .lp-apc-count { margin-left: auto; }
.lp-panel-tag { margin-left: auto; font-size: .57rem; font-weight: 800; color: #12a678; background: rgba(18,166,120,.12); padding: 2px 8px; border-radius: 999px; text-transform: none; }
.lp-live { width: 6px; height: 6px; border-radius: 50%; background: #12a678; box-shadow: 0 0 0 3px rgba(18,166,120,.16); animation: lp-apply-pulse 1.4s infinite; flex-shrink: 0; }
.lp-grid2 { display: grid; grid-template-columns: 0.82fr 1fr; gap: 18px; align-items: start; }
.lp-grid3 { display: grid; grid-template-columns: 0.82fr 1fr 0.86fr; gap: 24px; align-items: start; }
.lp-lbl { font-size: .7rem; font-weight: 700; color: #6f7188; letter-spacing: .3px; margin-bottom: 12px; }
.lp-donut { position: relative; width: 138px; height: 138px; border-radius: 50%; display: grid; place-items: center; filter: drop-shadow(0 10px 24px rgba(235,58,43,.28)); transition: transform .3s var(--ease-out-expo), filter .3s ease;
  background: conic-gradient(from 188deg, #eb3a2b 0%, #f2694e 20%, #f79b7f 38%, #f27a5e 52%, #f4996f 66%, #eb3a2b 78%, #f6e3dd 78% 100%); }
.lp-donut::before { content: ''; position: absolute; width: 106px; height: 106px; border-radius: 50%; box-shadow: inset 0 1px 3px rgba(235,58,43,.10);
  background: radial-gradient(80% 80% at 32% 24%, #fff, transparent 60%), radial-gradient(90% 90% at 70% 82%, rgba(242,130,105,.12), transparent 62%), #fffbf9; }
.lp-donut-num { position: relative; font-size: 2.1rem; font-weight: 800; letter-spacing: -.03em; }
.lp-donut-num small { font-size: .9rem; color: #a3a4bb; font-weight: 700; }
.lp-dash:hover .lp-donut { transform: scale(1.03); filter: drop-shadow(0 16px 32px rgba(235,58,43,.36)); }
.lp-delta { font-size: .72rem; font-weight: 700; color: #12a678; margin: 12px 0 9px; }
.lp-chips2 { display: flex; gap: 6px; flex-wrap: wrap; }
.lp-chip { display: inline-flex; align-items: center; gap: 4px; font-size: .66rem; font-weight: 600; padding: 5px 10px; border-radius: 999px; }
.lp-chip-purple { color: #eb3a2b; background: #fdece8; }
.lp-chip-soft { color: #6b6d84; background: #fdefeb; }
.lp-ats2 { margin-top: 26px; }
.lp-ats-row2 { display: flex; align-items: baseline; gap: 10px; }
.lp-ats-num2 { font-size: 2rem; font-weight: 800; letter-spacing: -.02em; }
.lp-ats-num2 small { font-size: .9rem; color: #a3a4bb; font-weight: 700; }
.lp-ats-good { margin-left: auto; font-size: .73rem; font-weight: 700; color: #12a678; display: flex; align-items: center; gap: 5px; }
.lp-gdot { width: 7px; height: 7px; border-radius: 50%; background: #12a678; }
.lp-improve { margin-top: 8px; font-size: .72rem; font-weight: 600; color: #eb3a2b; }
.lp-sk-row { display: flex; align-items: center; gap: 11px; margin-bottom: 13px; transition: transform .2s ease; }
.lp-sk-row:hover { transform: translateX(3px); }
.lp-sk-row:hover .lp-sk-track span { filter: brightness(1.06) saturate(1.1); }
.lp-sk-ic2 { width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0; display: grid; place-items: center; font-size: .54rem; font-weight: 800; color: #eb3a2b; letter-spacing: .3px;
  background: radial-gradient(90% 90% at 28% 18%, #fff, transparent 62%), radial-gradient(120% 120% at 90% 100%, rgba(242,130,105,.22), transparent 60%), #fdece8; box-shadow: inset 0 0 0 1px rgba(235,58,43,.06); }
.lp-sk-b { flex: 1; min-width: 0; }
.lp-sk-top { display: flex; justify-content: space-between; margin-bottom: 6px; }
.lp-sk-name { font-size: .77rem; font-weight: 600; }
.lp-sk-pct { font-size: .73rem; font-weight: 700; color: #6b6d84; }
.lp-sk-track { height: 6px; border-radius: 999px; background: #f6e3dd; overflow: hidden; }
.lp-sk-track span { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #ec5540, #f2694e); }
.lp-cv { align-self: stretch; border: 1px solid rgba(235,58,43,.10); border-radius: 14px; padding: 15px;
  background: radial-gradient(120% 70% at 100% 0%, rgba(242,130,105,.14), transparent 55%), radial-gradient(90% 60% at 0% 100%, rgba(245,155,130,.10), transparent 60%), linear-gradient(180deg,#fff,#fff9f7);
  box-shadow: 0 14px 34px rgba(220,55,42,.14), inset 0 1px 0 rgba(255,255,255,.9); }
.lp-cv-hd { display: flex; align-items: center; gap: 9px; margin-bottom: 13px; }
.lp-cv-av { width: 30px; height: 30px; border-radius: 50%; background: linear-gradient(135deg,#f2694e,#eb3a2b); color: #fff; display: grid; place-items: center; font-weight: 800; font-size: .72rem; }
.lp-cv-name { font-size: .82rem; font-weight: 800; }
.lp-cv-role { font-size: .62rem; color: #a3a4bb; margin-top: 1px; }
.lp-cv-sec { font-size: .58rem; font-weight: 800; text-transform: uppercase; letter-spacing: .6px; color: #f6a58f; margin: 11px 0 7px; }
.lp-ln { height: 6px; border-radius: 999px; background: #f6e3dd; margin-bottom: 6px; }
.lp-exp { display: flex; gap: 7px; margin-bottom: 10px; }
.lp-exp-d { width: 7px; height: 7px; border-radius: 50%; background: #f6a58f; margin-top: 2px; flex-shrink: 0; }
.lp-exp-l { flex: 1; }
/* auto-apply column inside the hero dashboard */
.lp-apc-head { display: flex; align-items: center; justify-content: space-between; font-size: .7rem; font-weight: 800; color: #26283a; margin-bottom: 11px; }
.lp-apc-count { font-size: .64rem; font-weight: 700; color: #eb3a2b; background: #fdece8; padding: 2px 8px; border-radius: 999px; }
.lp-apc-row { display: flex; align-items: center; gap: 9px; padding: 9px 8px; margin: 0 -8px; border-radius: 8px; border-top: 1px solid #f0eef7; transition: background .2s ease, transform .2s ease; }
.lp-apc-row:hover { background: #f5f2fe; transform: translateX(3px); }
.lp-apc-row:hover .lp-apc-logo { transform: scale(1.06); }
.lp-apc-row:first-of-type { border-top: none; padding-top: 2px; }
.lp-apc-logo { width: 24px; height: 24px; border-radius: 7px; flex-shrink: 0; transition: transform .2s ease; display: grid; place-items: center; font-size: .52rem; font-weight: 800; color: #fff; background: linear-gradient(135deg, #f2694e, #eb3a2b); overflow: hidden; }
.lp-apc-co { flex: 1; min-width: 0; font-size: .74rem; font-weight: 600; color: #26283a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp-apc-st { display: inline-flex; align-items: center; gap: 4px; font-size: .62rem; font-weight: 700; padding: 3px 8px; border-radius: 999px; white-space: nowrap; }
.lp-apc-done { color: #12a678; background: rgba(18,166,120,.12); }
.lp-apc-doing { color: #d97706; background: rgba(217,119,6,.13); }
.lp-apc-queue { color: #a3a4bb; background: #f3f2f8; }
.lp-apc-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: lp-apply-pulse 1s infinite; }
.lp-apc-opt { color: #eb3a2b; background: rgba(220,55,42,.12); }
.lp-apc-spin { width: 11px; height: 11px; border-radius: 50%; box-sizing: border-box; border: 2px solid rgba(217,119,6,.28); border-top-color: #d97706; animation: lp-sweep .7s linear infinite; }
.lp-apc-spin-p { border-color: rgba(220,55,42,.26); border-top-color: #eb3a2b; }
/* shared by the animated walkthrough demo (lp-demo-frame) further down the page */
.lp-mock-bar { display: flex; align-items: center; gap: 7px; padding: 11px 14px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-elevated); }
.lp-mock-dot { width: 10px; height: 10px; border-radius: 50%; }
.lp-mock-url { margin-left: 10px; font-size: 0.72rem; color: var(--text-muted); }
.lp-mock-body { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.lp-mock-score { display: flex; align-items: center; gap: 16px; padding-bottom: 14px; border-bottom: 1px dashed var(--border-subtle); }
.lp-ring { position: relative; width: 76px; height: 76px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: conic-gradient(#eb3a2b 0% 92%, var(--border-subtle) 92% 100%); }
.lp-ring::before { content: ''; position: absolute; width: 60px; height: 60px; border-radius: 50%; background: var(--bg-card); }
.lp-ring-num { position: relative; font-weight: 800; font-size: 1.25rem; color: var(--text-primary); }
.lp-ring-num small { font-size: 0.7rem; font-weight: 700; color: var(--text-muted); }
.lp-mock-role { font-weight: 700; font-size: 0.95rem; }
.lp-mock-co { display: flex; align-items: center; gap: 5px; font-size: 0.76rem; color: var(--text-muted); margin: 3px 0 7px; }
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
.lp-stat-val { font-size: clamp(1.5rem, 3vw, 2rem); font-weight: 800; letter-spacing: -0.02em; background: linear-gradient(135deg, #eb3a2b 0%, #f5795a 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
.lp-stat-label { font-size: 0.74rem; color: var(--text-muted); margin-top: 2px; }

/* Featured logos marquee */
.lp-logos { max-width: 1460px; margin: 26px auto 0; padding: 8px 52px 52px 92px; text-align: left; }
.lp-logos-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.09em; color: var(--text-muted); margin: 0 0 16px; }
.lp-logos-carousel { position: relative; }
.lp-logos-arrow { position: absolute; top: 50%; transform: translateY(-50%); z-index: 2; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--border-default); background: var(--bg-card); color: var(--text-secondary); font-size: 1.15rem; line-height: 1; cursor: pointer; display: grid; place-items: center; box-shadow: 0 2px 10px rgba(0,0,0,0.08); transition: border-color .2s, color .2s, transform .2s; }
.lp-logos-arrow-l { left: -6px; }
.lp-logos-arrow-r { right: -6px; }
.lp-logos-arrow:hover { border-color: #eb3a2b; color: #eb3a2b; transform: translateY(-50%) scale(1.08); }
.lp-logo-row { display: flex; align-items: center; gap: 76px; min-width: 0; overflow-x: auto; scroll-behavior: smooth; padding: 6px 0; scrollbar-width: none; -ms-overflow-style: none;
  -webkit-mask-image: linear-gradient(90deg, #000 0, #000 93%, transparent);
  mask-image: linear-gradient(90deg, #000 0, #000 93%, transparent); }
.lp-logo-row[data-scrolled="true"] {
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 5%, #000 93%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 5%, #000 93%, transparent); }
.lp-logo-row::-webkit-scrollbar { display: none; }
.lp-marquee { position: relative; overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 7%, #000 93%, transparent); }
.lp-marquee-track { display: flex; align-items: center; width: max-content; animation: lp-scroll 45s linear infinite; }
.lp-marquee:hover .lp-marquee-track { animation-play-state: paused; }
.lp-logo-cell { flex: 0 0 auto; height: 42px; display: flex; align-items: center; justify-content: center; }
.lp-logo-img { height: 30px; width: auto; max-width: 192px; object-fit: contain; filter: grayscale(1); opacity: 0.62; transition: transform .2s ease, filter .25s ease, opacity .25s ease; }
.lp-logo-cell:hover .lp-logo-img { transform: scale(1.06); filter: none; opacity: 1; }
.lp-logo-text { font-weight: 800; font-size: 1.32rem; letter-spacing: -0.01em; color: var(--text-secondary); white-space: nowrap; opacity: 0.75; }
.lp-logo-cell:hover .lp-logo-text { color: var(--text-primary); opacity: 1; }
.lp-logos-disclaim { font-size: 0.6rem; color: var(--text-muted); opacity: 0.5; margin: 20px 0 0; text-align: center; padding-right: 40px; line-height: 1.5; }
/* Featured opportunities */
.lp-featured { max-width: 1460px; margin: 10px auto 0; padding: 44px 52px 8px 92px; }
.lp-featured-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.lp-featured-title { margin: 0 0 5px; text-align: left; font-size: clamp(1.4rem, 2.6vw, 1.9rem); font-weight: 800; color: #1b1720; }
.lp-featured-sub { font-size: 0.9rem; color: var(--text-muted); margin: 0; }
.lp-featured-all { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; font-size: 0.82rem; font-weight: 700; color: #eb3a2b; background: none; border: none; cursor: pointer; padding: 6px 2px; transition: gap .2s ease; }
.lp-featured-all:hover { gap: 10px; }
.lp-jobs-carousel { position: relative; }
.lp-jobs-row { display: flex; gap: 20px; overflow-x: auto; scroll-behavior: smooth; padding: 6px 2px 20px; scrollbar-width: none; -ms-overflow-style: none; }
.lp-jobs-row::-webkit-scrollbar { display: none; }
.lp-job-card { flex: 0 0 300px; width: 300px; border-radius: 18px; overflow: hidden; background: #fff; text-decoration: none; color: inherit; border: 1px solid rgba(24,20,26,.08); box-shadow: 0 10px 30px rgba(30,18,22,.07); transition: transform .25s var(--ease-out-expo), box-shadow .25s ease; cursor: pointer; }
.lp-job-card:hover { transform: translateY(-4px); box-shadow: 0 22px 46px rgba(30,18,22,.14); }
.lp-job-banner { position: relative; height: 110px; display: flex; align-items: flex-start; justify-content: space-between; padding: 12px; }
.lp-job-badge { font-size: 0.64rem; font-weight: 700; color: #211d22; background: rgba(255,255,255,.85); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); padding: 4px 10px; border-radius: 999px; box-shadow: 0 2px 6px rgba(0,0,0,.06); }
.lp-job-logo { width: 36px; height: 36px; border-radius: 10px; background: #fff; display: grid; place-items: center; padding: 5px; box-shadow: 0 4px 12px rgba(0,0,0,.12); overflow: hidden; }
.lp-job-logo img { width: 100%; height: 100%; object-fit: contain; }
.lp-job-mono { font-size: 0.95rem; font-weight: 800; color: #eb3a2b; }
.lp-job-body { padding: 15px 16px 16px; }
.lp-job-title { font-size: 0.98rem; font-weight: 800; letter-spacing: -0.01em; margin: 0 0 5px; line-height: 1.28; color: #1b1720; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.56em; }
.lp-job-meta { font-size: 0.78rem; color: var(--text-muted); margin-bottom: 13px; }
.lp-job-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.lp-job-tags span { font-size: 0.68rem; font-weight: 600; color: #6b6d84; background: #f4f0ef; padding: 4px 9px; border-radius: 7px; }
.lp-job-foot { display: flex; align-items: center; gap: 7px; font-size: 0.74rem; font-weight: 700; color: #12a678; }
.lp-job-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
@keyframes lp-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }

/* Sections */
.lp-section { max-width: 1000px; margin: 0 auto; padding: 56px 24px; text-align: center; }
.lp-h2 { font-size: clamp(1.4rem, 3vw, 2rem); font-weight: 800; letter-spacing: -0.025em; margin: 0 0 10px; }
.lp-section-sub { font-size: 0.92rem; color: var(--text-muted); max-width: 460px; margin: 0 auto 36px; }
/* Auto-apply-while-optimizing section */
.lp-apply-viz { max-width: 880px; margin: 0 auto; display: grid; grid-template-columns: 0.82fr 1.18fr; gap: 20px; align-items: stretch; text-align: left; }
.lp-apply-cv, .lp-apply-jobs { background: var(--bg-card); border: 1px solid var(--border-default); border-radius: 16px; padding: 18px 20px; box-shadow: var(--shadow-card); }
.lp-ac-head, .lp-aj-head { display: flex; align-items: center; gap: 8px; font-size: 0.82rem; font-weight: 700; margin-bottom: 14px; }
.lp-ac-head { color: #eb3a2b; }
.lp-ac-head svg { flex-shrink: 0; }
.lp-ac-line { height: 8px; border-radius: 999px; background: var(--border-subtle); margin-bottom: 9px; }
.lp-ac-line.is-hl { background: color-mix(in srgb, #eb3a2b 30%, var(--border-subtle)); }
.lp-ac-prog { margin-top: 18px; }
.lp-ac-prog-label { display: flex; justify-content: space-between; font-size: 0.72rem; font-weight: 600; color: var(--text-muted); margin-bottom: 7px; }
.lp-ac-prog-label span:last-child { color: var(--accent-green); font-weight: 700; }
.lp-ac-bar { height: 7px; border-radius: 999px; background: var(--border-subtle); overflow: hidden; }
.lp-ac-bar span { display: block; height: 100%; border-radius: 999px; background: linear-gradient(135deg, #eb3a2b 0%, #f5795a 100%); animation: lp-ac-grow 2.6s var(--ease-out-expo) infinite alternate; }
@keyframes lp-ac-grow { from { width: 54%; } to { width: 88%; } }
.lp-aj-head { justify-content: space-between; }
.lp-aj-count { font-size: 0.72rem; color: var(--text-muted); font-weight: 600; }
.lp-aj-row { display: flex; align-items: center; gap: 11px; padding: 9px 0; border-top: 1px solid var(--border-subtle); }
.lp-aj-row:first-of-type { border-top: none; padding-top: 0; }
.lp-aj-logo { width: 28px; height: 28px; border-radius: 8px; flex-shrink: 0; display: grid; place-items: center; font-size: 0.6rem; font-weight: 800; color: #fff; background: linear-gradient(135deg, #eb3a2b 0%, #f5795a 100%); }
.lp-aj-info { flex: 1; min-width: 0; }
.lp-aj-title { font-size: 0.8rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp-aj-co { font-size: 0.68rem; color: var(--text-muted); }
.lp-aj-status { display: inline-flex; align-items: center; gap: 5px; font-size: 0.7rem; font-weight: 700; padding: 4px 10px; border-radius: 999px; white-space: nowrap; }
.lp-aj-done { color: var(--accent-green); background: color-mix(in srgb, var(--accent-green) 13%, transparent); }
.lp-aj-doing { color: var(--accent-amber); background: color-mix(in srgb, var(--accent-amber) 14%, transparent); }
.lp-aj-queue { color: var(--text-muted); background: var(--bg-elevated); }
.lp-aj-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.lp-aj-doing .lp-aj-dot { animation: lp-apply-pulse 1s infinite; }
@keyframes lp-apply-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.lp-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.lp-step { position: relative; text-align: left; padding: 24px 20px; border-radius: 16px; border: 1px solid var(--border-subtle); background: var(--bg-card); transition: transform .25s, border-color .25s; }
.lp-step:hover { transform: translateY(-4px); border-color: var(--border-accent); }
.lp-step-num { position: absolute; top: 16px; right: 18px; font-size: 1.6rem; font-weight: 800; color: var(--border-default); }
.lp-step-icon, .lp-feature-icon { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 12px; margin-bottom: 14px; color: #fff; background: linear-gradient(135deg, #eb3a2b 0%, #f5795a 100%); box-shadow: 0 6px 18px rgba(235,80,60,0.32); }
.lp-step-title { font-weight: 700; font-size: 1rem; margin-bottom: 6px; }
.lp-step-desc, .lp-feature-desc { font-size: 0.83rem; color: var(--text-muted); line-height: 1.55; }

/* How it works — connected step flow */
.lp-how-flow { display: flex; gap: 8px; margin-top: 12px; }
.lp-how-step { position: relative; flex: 1; padding: 0 12px; text-align: center; }
.lp-how-step:not(:last-child)::after { content: ''; position: absolute; top: 28px; left: calc(50% + 36px); right: calc(-50% + 36px); height: 2px; background: linear-gradient(90deg, var(--border-accent), var(--border-subtle)); }
.lp-how-badge { position: relative; width: 56px; height: 56px; margin: 0 auto 18px; border-radius: 16px; display: flex; align-items: center; justify-content: center; color: #fff; background: linear-gradient(135deg, #eb3a2b 0%, #f5795a 100%); box-shadow: 0 8px 22px rgba(235,80,60,0.35); }
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
.lp-cta-inner { border-radius: 24px; padding: 52px 32px; text-align: center; background: linear-gradient(135deg, #eb3a2b 0%, #f5795a 100%); position: relative; overflow: hidden; box-shadow: 0 24px 60px rgba(235,80,60,0.4); }
.lp-cta-inner::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at 70% 0%, rgba(255,255,255,0.25), transparent 55%); }
.lp-cta-title { position: relative; font-size: clamp(1.5rem, 3.5vw, 2.2rem); font-weight: 800; color: #fff; margin: 0 0 8px; letter-spacing: -0.02em; }
.lp-cta-desc { position: relative; color: rgba(255,255,255,0.9); font-size: 0.95rem; margin: 0 0 24px; }
.lp-cta-band .lp-btn-primary { position: relative; background: #fff; color: #d42a1c; box-shadow: 0 10px 30px rgba(0,0,0,0.18); }
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
.lp-drop-card { position: relative; display: flex; align-items: center; gap: 12px; width: 100%; max-width: 380px; padding: 14px 16px; border-radius: 13px; border: 1px dashed var(--border-accent); background: linear-gradient(135deg, rgba(224,85,114,0.08), rgba(242,160,138,0.05)); color: #eb3a2b; overflow: hidden; }
.lp-drop-name { font-weight: 700; font-size: 0.86rem; color: var(--text-primary); }
.lp-drop-meta { font-size: 0.74rem; color: var(--text-muted); margin-top: 2px; }
.lp-scan-line { position: absolute; left: 0; top: 0; width: 100%; height: 2px; background: linear-gradient(90deg, transparent, #eb3a2b, transparent); animation: lp-scanline 1.8s ease-in-out infinite; }
@keyframes lp-scanline { 0% { transform: translateY(0); } 50% { transform: translateY(54px); } 100% { transform: translateY(0); } }
.lp-chips { display: flex; flex-wrap: wrap; gap: 7px; justify-content: center; max-width: 420px; }
.lp-chip2 { display: inline-flex; align-items: center; gap: 4px; font-size: 0.72rem; font-weight: 600; color: var(--text-secondary); background: var(--bg-elevated); border: 1px solid var(--border-subtle); padding: 4px 10px; border-radius: 999px; opacity: 0; animation: lp-pop .4s var(--ease-spring) forwards; }
.lp-chip2 svg { color: var(--accent-green); }
@keyframes lp-pop { from { opacity: 0; transform: scale(.8) translateY(6px); } to { opacity: 1; transform: none; } }
.lp-role-out { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--text-secondary); }
.lp-role-out b { color: var(--text-primary); }
.lp-role-out svg { color: #eb3a2b; }

/* Scene 2 — search everywhere */
.lp-search { display: flex; align-items: center; gap: 26px; }
.lp-radar { position: relative; width: 110px; height: 110px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #eb3a2b; background: linear-gradient(135deg, rgba(224,85,114,0.08), rgba(242,160,138,0.05)); border: 1px solid var(--border-subtle); }
.lp-ping { position: absolute; inset: 0; border-radius: 50%; border: 2px solid #eb3a2b; opacity: 0; animation: lp-ping 2.4s ease-out infinite; }
.lp-ping-2 { animation-delay: 1.2s; }
@keyframes lp-ping { 0% { transform: scale(.55); opacity: .6; } 100% { transform: scale(1.25); opacity: 0; } }
.lp-radar-sweep { position: absolute; inset: 0; border-radius: 50%; background: conic-gradient(from 0deg, transparent 0deg, color-mix(in srgb, #eb3a2b 35%, transparent) 50deg, transparent 80deg); animation: lp-sweep 2.2s linear infinite; }
@keyframes lp-sweep { to { transform: rotate(360deg); } }
.lp-search-side { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
.lp-search-head { display: flex; align-items: center; gap: 6px; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 3px; }
.lp-search-head svg { color: #eb3a2b; }
.lp-src { display: flex; align-items: center; gap: 8px; font-size: 0.78rem; color: var(--text-secondary); padding: 6px 10px; border-radius: 9px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); opacity: 0; animation: lp-slidein .45s var(--ease-out-expo) forwards; }
.lp-src svg:first-child { color: var(--text-muted); flex-shrink: 0; }
.lp-src-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp-src-ok { color: var(--accent-green); flex-shrink: 0; }
@keyframes lp-slidein { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
.lp-search-count { font-size: 0.78rem; color: var(--text-muted); margin-top: 4px; }
.lp-search-count b { color: #eb3a2b; font-weight: 800; }

/* Scene 3 — scoring (reuses hero mock classes) */
.lp-score-scene { display: flex; flex-direction: column; gap: 12px; }
.lp-job-anim { opacity: 0; animation: lp-slidein .5s var(--ease-out-expo) forwards; }
.lp-score-scene .lp-bar span { transition: width 1s var(--ease-out-expo) .3s; }

/* Scene 4 — optimize CV */
.lp-cv-scene { display: flex; gap: 22px; align-items: center; }
.lp-cv-doc { width: 200px; flex-shrink: 0; padding: 16px; border-radius: 10px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 9px; box-shadow: var(--shadow-card-hover); }
.lp-cv-h { height: 12px; width: 60%; border-radius: 4px; background: linear-gradient(135deg, #eb3a2b 0%, #f5795a 100%); }
.lp-cv-line { height: 8px; width: 100%; border-radius: 4px; background: var(--border-default); }
.lp-cv-hl { background: color-mix(in srgb, #eb3a2b 30%, var(--border-default)); animation: lp-hl 2.6s ease-in-out infinite; }
@keyframes lp-hl { 0%,100% { background: var(--border-default); } 50% { background: color-mix(in srgb, #eb3a2b 45%, transparent); } }
.lp-cv-side { flex: 1; display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.lp-cv-note { display: flex; align-items: center; gap: 7px; font-size: 0.78rem; color: var(--text-secondary); }
.lp-cv-note svg { color: var(--accent-green); flex-shrink: 0; }
.lp-cv-export { display: inline-flex; align-items: center; gap: 7px; margin-top: 4px; padding: 9px 16px; border: none; cursor: pointer; font-weight: 700; font-size: 0.82rem; color: #fff; background: linear-gradient(135deg, #eb3a2b 0%, #f5795a 100%); border-radius: 11px; box-shadow: 0 6px 18px rgba(235,80,60,0.3); }

/* Timeline */
.lp-timeline { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; padding: 10px; border-top: 1px solid var(--border-subtle); background: var(--bg-elevated); }
.lp-tl-tab { display: flex; flex-direction: column; gap: 7px; padding: 7px 8px; border: none; background: transparent; cursor: pointer; border-radius: 9px; transition: background .2s; }
.lp-tl-tab:hover { background: var(--bg-glass); }
.lp-tl-label { display: flex; align-items: center; gap: 5px; font-size: 0.72rem; font-weight: 600; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color .2s; }
.lp-tl-tab.is-active .lp-tl-label { color: var(--text-primary); }
.lp-tl-track { height: 3px; border-radius: 999px; background: var(--border-subtle); overflow: hidden; }
.lp-tl-fill { display: block; height: 100%; width: 0; border-radius: 999px; background: linear-gradient(135deg, #eb3a2b 0%, #f5795a 100%); }
@keyframes lp-tl-grow { from { width: 0; } to { width: 100%; } }
@media (max-width: 880px) {
  .lp-demo-stage { height: auto; min-height: 340px; }
  .lp-search { flex-direction: column; gap: 18px; text-align: center; }
  .lp-cv-scene { flex-direction: column; }
  .lp-cv-doc { width: 100%; }
  .lp-tl-label { font-size: 0; gap: 0; }
  .lp-tl-label svg { font-size: initial; }
}

@media (max-width: 1380px) {
  .lp-hero { grid-template-columns: 1fr; gap: 34px; justify-items: center; text-align: center; }
  .lp-hero-copy { display: flex; flex-direction: column; align-items: center; padding-left: 0; }
  .lp-sub { text-align: center; }
  .lp-cta-row, .lp-trust { justify-content: center; }
  .lp-mock-wrap { justify-content: center; }
  .lp-dash { width: min(700px, 100%); }
}

@media (max-width: 880px) {
  .lp-hero { grid-template-columns: 1fr; gap: 32px; padding-top: 24px; text-align: center; }
  .lp-hero-copy { display: flex; flex-direction: column; align-items: center; padding-left: 0; }
  .lp-cta-row, .lp-trust { justify-content: center; }
  .lp-mock-wrap { justify-content: center; margin-right: 0; }
  .lp-frame { padding: 10px; transform: none; }
  .lp-dash { width: 100%; }
  .lp-grid3 { grid-template-columns: 1fr; gap: 16px; }
  .lp-steps, .lp-features, .lp-apply-viz { grid-template-columns: 1fr; }
  .lp-stats { grid-template-columns: repeat(2, 1fr); gap: 20px 12px; }
  .lp-nav-cta { display: none; }
  .lp-nav-links { display: none; }
  .lp-featured { padding-left: 24px; padding-right: 24px; }
  .lp-featured-head { flex-direction: column; align-items: flex-start; gap: 8px; }
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
