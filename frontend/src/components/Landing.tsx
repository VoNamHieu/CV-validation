'use client';

import { useState, useEffect, useRef } from 'react';
import { ArrowRight, SignIn, CheckCircle, RocketLaunch } from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { useAuth } from '@/lib/auth';
import { catalog } from '@/lib/db';
import { LP_CSS } from './Landing.styles';
import HowItWorks from './HowItWorks';
import LandingContact from './LandingContact';
import { FEATURED_LOGOS, JOB_BANNERS, JOBS, seniorityBadge } from './Landing.data';
import type { JobCard, PromotedCard } from './Landing.data';

// Landing / front door, shown until the visitor taps "Bắt đầu" (persisted via
// the `entered` flag). Sells the product before dropping the user into the app;
// login isn't forced here — it's requested later only when a paid AI action is
// triggered (see useAuthGate). Constants/data live in ./Landing.data, the demo
// walkthrough in ./LandingDemoPlayer, and the <style> block in ./Landing.styles.

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

// Featured-job cards render the logo in a WIDE banner (max-width 66%,
// max-height 56px). Admin-uploaded company logos are often square/small and get
// lost there, so for known brands prefer a horizontal wordmark from
// /public/logos. Unilever's "Uniquely U" graduate site is the same brand → reuse
// the Unilever mark. Falls through to the admin logo for everyone else.
const CARD_LOGO: { re: RegExp; src: string }[] = [
    { re: /unilever|uniquely\s*u/i, src: '/logos/unilever.png' },
    { re: /mondelez/i, src: '/logos/mondelez.webp' },
    { re: /\bey\b|ernst\s*&?\s*young/i, src: '/logos/ey.png' },
    { re: /\bdhl\b/i, src: '/logos/dhl.png' },
    { re: /\bmomo\b|m_?service/i, src: '/logos/momo.png' },
];
const cardLogo = (co: string): string | undefined =>
    CARD_LOGO.find((m) => m.re.test(co))?.src;

const ABOUT_COPY = {
    vi: {
        eyebrow: 'Về Copo',
        title: 'Tìm đúng cơ hội không nên phụ thuộc vào may mắn.',
        intro: [
            'Tại Copo, chúng tôi tin rằng việc tìm được một cơ hội nghề nghiệp phù hợp không nên phụ thuộc vào may mắn, việc lướt hàng giờ trên các nền tảng tuyển dụng hay phải tự tìm kiếm trên hàng trăm nguồn thông tin rời rạc.',
            'Chúng tôi đang xây dựng một nền tảng nghề nghiệp ứng dụng AI, giúp mọi người khám phá các cơ hội phù hợp, hiểu rõ mức độ tương thích của bản thân, cải thiện hồ sơ và ứng tuyển hiệu quả hơn.',
            'Copo tập hợp các cơ hội việc làm quốc tế từ những tập đoàn đa quốc gia và nhà tuyển dụng uy tín vào một nơi. Bằng cách liên tục tìm kiếm và cập nhật các vị trí mới, chúng tôi giúp ứng viên tiếp cận cơ hội sớm hơn thay vì phải chờ chúng xuất hiện trên mạng xã hội hoặc các trang tuyển dụng truyền thống.',
            'Mục tiêu của Copo không chỉ là giúp người dùng nộp nhiều hồ sơ hơn. Chúng tôi muốn giúp họ tạo ra những hồ sơ tốt hơn, tiếp cận đúng nhà tuyển dụng hơn và nhận được nhiều lời mời phỏng vấn hơn.',
        ],
        principlesTitle: 'Những điều chúng tôi tin tưởng và theo đuổi',
        principles: [
            {
                title: 'Mở rộng khả năng tiếp cận cơ hội toàn cầu.',
                body: 'Những cơ hội nghề nghiệp tốt nhất thường nằm rải rác trên hàng nghìn trang tuyển dụng của doanh nghiệp và các nền tảng việc làm khác nhau. Copo tập hợp chúng vào một nơi để ứng viên dễ dàng tiếp cận các vị trí quốc tế từ những doanh nghiệp hàng đầu.',
            },
            {
                title: 'Giúp ứng viên tiếp cận cơ hội sớm hơn.',
                body: 'Thời điểm ứng tuyển có thể tạo ra khác biệt. Copo liên tục tìm kiếm và cập nhật các vị trí mới để ứng viên có thể phát hiện và ứng tuyển ngay khi cơ hội xuất hiện.',
            },
            {
                title: 'Tối ưu cho ATS trước khi đến tay nhà tuyển dụng.',
                body: 'Nhiều CV được hệ thống Applicant Tracking System sàng lọc trước khi nhà tuyển dụng đọc. Copo giúp tăng khả năng tương thích với ATS, đồng thời đảm bảo hồ sơ vẫn trung thực và phù hợp với từng vị trí.',
            },
            {
                title: 'Ưu tiên chất lượng thay vì số lượng.',
                body: 'Ứng tuyển hàng trăm công việc không phải là một chiến lược hiệu quả. Copo ưu tiên những vị trí mà ứng viên có mức độ phù hợp cao và khả năng thành công tốt hơn.',
            },
            {
                title: 'Tự động hóa những công việc lặp lại.',
                body: 'Tìm việc, so sánh mô tả công việc, điều chỉnh CV và nộp hồ sơ đều tốn nhiều thời gian. Copo tự động hóa những công việc này để ứng viên có thể tập trung vào phỏng vấn, phát triển kỹ năng và đưa ra quyết định nghề nghiệp tốt hơn.',
            },
            {
                title: 'Đo lường thành công bằng cơ hội phỏng vấn.',
                body: 'Chúng tôi không tối ưu cho số lượng hồ sơ được gửi đi. Chúng tôi tối ưu để hồ sơ được nhìn thấy nhiều hơn, phù hợp hơn và tạo ra nhiều cơ hội phỏng vấn hơn.',
            },
        ],
    },
    en: {
        eyebrow: 'About Copo',
        title: 'Finding the right opportunity should not depend on luck.',
        intro: [
            'At Copo, we believe finding the right career opportunity should not depend on luck, endless scrolling, or searching across hundreds of disconnected platforms.',
            'We are building an AI-powered career platform that helps people discover relevant opportunities, understand where they have the strongest fit, improve their applications, and apply more efficiently.',
            'Copo brings together international job opportunities from leading multinational companies and trusted employers in one place. By continuously discovering and updating new openings, we help candidates access opportunities earlier instead of waiting for them to appear on social media or traditional job boards.',
            'Our goal is not simply to help people apply to more jobs. It is to help them make better applications, reach more relevant employers, and earn more interviews.',
        ],
        principlesTitle: 'What we believe in and pursue',
        principles: [
            {
                title: 'Discover global opportunities without limits.',
                body: 'The best career opportunities are scattered across thousands of company career pages and job platforms. Copo brings them together in one place, giving candidates broader access to international roles from leading companies.',
            },
            {
                title: 'See opportunities earlier.',
                body: 'Timing matters. We continuously discover and update new openings so candidates can find and apply for relevant roles as early as possible.',
            },
            {
                title: 'Optimize for ATS before recruiters.',
                body: 'Many resumes are screened by Applicant Tracking Systems before a recruiter reads them. Copo helps improve ATS compatibility while keeping each application truthful and relevant to the role.',
            },
            {
                title: 'Focus on quality, not quantity.',
                body: 'Applying to hundreds of jobs is not an effective strategy. We prioritize opportunities where candidates have the strongest fit and the highest potential for success.',
            },
            {
                title: 'Automate repetitive work.',
                body: 'Searching, comparing roles, tailoring resumes, and submitting applications take time. Copo automates these repetitive tasks so candidates can focus on interviews, skills, and better career decisions.',
            },
            {
                title: 'Measure success by interviews.',
                body: 'We do not optimize for the number of applications sent. We optimize for better visibility, stronger applications, and more interview opportunities.',
            },
        ],
    },
} as const;

function AboutUsSection() {
    const [lang, setLang] = useState<'vi' | 'en'>('vi');
    const copy = ABOUT_COPY[lang];

    return (
        <section className="lp-about" id="about">
            <div className="lp-about-head">
                <div>
                    <span className="lp-about-eyebrow">{copy.eyebrow}</span>
                    <h2 className="lp-about-title">{copy.title}</h2>
                </div>
                <div className="lp-lang-switch" role="group" aria-label="Chọn ngôn ngữ">
                    <button
                        type="button"
                        className={`lp-lang-option${lang === 'vi' ? ' is-active' : ''}`}
                        onClick={() => setLang('vi')}
                        aria-pressed={lang === 'vi'}
                    >
                        Tiếng Việt
                    </button>
                    <button
                        type="button"
                        className={`lp-lang-option${lang === 'en' ? ' is-active' : ''}`}
                        onClick={() => setLang('en')}
                        aria-pressed={lang === 'en'}
                    >
                        English
                    </button>
                </div>
            </div>

            <div className="lp-about-grid">
                <div className="lp-about-copy">
                    {copy.intro.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                    ))}
                </div>
                <div className="lp-principles">
                    <h3>{copy.principlesTitle}</h3>
                    <div className="lp-principle-list">
                        {copy.principles.map((principle, index) => (
                            <details className="lp-principle" key={principle.title} open={index === 0}>
                                <summary>
                                    <span>{String(index + 1).padStart(2, '0')}</span>
                                    <h4>{principle.title}</h4>
                                </summary>
                                <p>{principle.body}</p>
                            </details>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}

// Plain-text FAQ — drives both the visible accordion and the FAQPage schema.
const FAQ_ITEMS: { q: string; a: string }[] = [
    {
        q: 'CV của tôi được lưu ở đâu và ai đọc được?',
        a: 'CV của bạn được mã hoá và chỉ dùng để phân tích cho chính bạn. Chúng tôi không bán, không chia sẻ hồ sơ cho nhà tuyển dụng hay bên thứ ba. Bạn có thể xoá tài khoản cùng toàn bộ dữ liệu bất cứ lúc nào, và xoá là xoá thật.',
    },
    {
        q: '"Không bịa nội dung" hoạt động thế nào?',
        a: 'AI chỉ được phép viết lại dựa trên dữ kiện đã có trong CV gốc của bạn. Mỗi thay đổi đều truy vết được về nguồn. Nếu bạn thiếu một kỹ năng mà vị trí yêu cầu, chúng tôi nói thẳng trong báo cáo khoảng cách thay vì bịa ra để bạn thất bại ở vòng phỏng vấn.',
    },
    {
        q: 'Việc làm trên Copo lấy từ đâu?',
        a: 'Trực tiếp từ trang tuyển dụng chính thức của các công ty trong mạng lưới, được hệ thống quét và làm mới mỗi 24 giờ. Không tin đăng trung gian, không vị trí đã đóng.',
    },
    {
        q: 'Hết 50 credit miễn phí thì sao?',
        a: 'Bạn vẫn xem được việc khớp với CV của mình, phần đó miễn phí vĩnh viễn. Chỉ các thao tác AI chuyên sâu (chấm điểm chi tiết, tối ưu CV, luyện phỏng vấn) mới dùng credit, và bạn nạp thêm khi cần. Không gói tháng bắt buộc, không tự động trừ tiền.',
    },
];

function FaqSection() {
    const faqJsonLd = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: FAQ_ITEMS.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
    }).replace(/</g, '\\u003c');

    return (
        <section className="lp-about" id="faq">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd }} />
            <div className="lp-about-head">
                <div>
                    <span className="lp-about-eyebrow">Những điều bạn có quyền hỏi</span>
                    <h2 className="lp-about-title">Câu hỏi thẳng, trả lời thẳng.</h2>
                </div>
            </div>
            <div className="lp-principle-list">
                {FAQ_ITEMS.map((f, index) => (
                    <details className="lp-principle" key={f.q} open={index === 0}>
                        <summary>
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            <h4>{f.q}</h4>
                        </summary>
                        <p>{f.a}</p>
                    </details>
                ))}
            </div>
        </section>
    );
}

export default function Landing() {
    const enterApp = useAppStore((s) => s.enterApp);
    const setView = useAppStore((s) => s.setView);
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

    // Scroll-spy: track the section currently in view. A thin activation band
    // near the viewport middle (rootMargin) makes exactly one section active as
    // you scroll. Defaults to 'top' (homepage/hero) so the pill starts there.
    const NAV_IDS = ['top', 'featured', 'about', 'how-it-works', 'contact'];
    const [activeSection, setActiveSection] = useState('top');
    useEffect(() => {
        const els = NAV_IDS.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
        if (!els.length) return;
        const visible = new Set<string>();
        const obs = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (e.isIntersecting) visible.add(e.target.id);
                    else visible.delete(e.target.id);
                }
                // first section (document order) still in the band wins; fall
                // back to 'top' so the indicator never disappears.
                setActiveSection(NAV_IDS.find((id) => visible.has(id)) || 'top');
            },
            { rootMargin: '-45% 0px -50% 0px', threshold: 0 },
        );
        els.forEach((el) => obs.observe(el));
        return () => obs.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Liquid-glass sliding indicator: measure the active link's box and drive a
    // single absolutely-positioned pill that transitions left/width between
    // links. Re-measures on resize and once the display font swaps in.
    const navLinksRef = useRef<HTMLElement>(null);
    const [pill, setPill] = useState({ left: 0, top: 0, width: 0, height: 0, opacity: 0 });
    useEffect(() => {
        const measure = () => {
            const wrap = navLinksRef.current;
            if (!wrap) return;
            const el = wrap.querySelector<HTMLElement>(`a[data-section="${activeSection}"]`);
            if (!el) { setPill((p) => ({ ...p, opacity: 0 })); return; }
            setPill({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight, opacity: 1 });
        };
        measure();
        window.addEventListener('resize', measure);
        (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready?.then?.(measure);
        return () => window.removeEventListener('resize', measure);
    }, [activeSection]);
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
                    // Prefer a horizontal brand wordmark for the wide card banner;
                    // fall back to the admin (square) logo, then a monogram.
                    logo: cardLogo(r.company_name || '')
                        ?? (r.has_logo ? `/api/store/promoted/logo-by-slug/${encodeURIComponent(r.slug)}` : ''),
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
                <nav className="lp-nav-links" ref={navLinksRef}>
                    <span className="lp-nav-pill" aria-hidden style={{ left: pill.left, top: pill.top, width: pill.width, height: pill.height, opacity: pill.opacity }} />
                    <a href="#top" data-section="top" className={activeSection === 'top' ? 'is-active' : undefined} aria-current={activeSection === 'top' ? 'true' : undefined}>Trang chủ</a>
                    <a href="#featured" data-section="featured" className={activeSection === 'featured' ? 'is-active' : undefined} aria-current={activeSection === 'featured' ? 'true' : undefined}>Cơ hội</a>
                    <a href="#about" data-section="about" className={activeSection === 'about' ? 'is-active' : undefined} aria-current={activeSection === 'about' ? 'true' : undefined}>Về Copo</a>
                    <a href="#how-it-works" data-section="how-it-works" className={activeSection === 'how-it-works' ? 'is-active' : undefined} aria-current={activeSection === 'how-it-works' ? 'true' : undefined}>Cách hoạt động</a>
                    <a href="#contact" data-section="contact" className={activeSection === 'contact' ? 'is-active' : undefined} aria-current={activeSection === 'contact' ? 'true' : undefined}>Liên hệ</a>
                </nav>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {enabled && !user && (
                        <button className="lp-btn-ghost" onClick={() => promptLogin()}>
                            <SignIn size={15} weight="duotone" /> Đăng nhập
                        </button>
                    )}
                </div>
            </header>

            {/* Hero */}
            <section className="lp-hero" id="top">
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
                    <button
                        type="button"
                        className="lp-featured-all"
                        onClick={() => {
                            // Land on the featured view once inside the app. A fresh
                            // anon→login doesn't reset the store (see resetUserData
                            // gate), so setting view here survives the login hop.
                            setView('featured');
                            if (enabled && !user) promptLogin('Đăng nhập để xem cơ hội nổi bật');
                            else enterApp();
                        }}
                    >
                        Xem tất cả cơ hội <ArrowRight size={14} weight="bold" />
                    </button>
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
                                    {j.logo ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img className="lp-job-logo-img" src={j.logo} alt={j.co} />
                                    ) : (
                                        <span className="lp-job-mono">{(j.co || '?').charAt(0)}</span>
                                    )}
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

            <AboutUsSection />

            {/* How it works — self-contained animated section (shadow-DOM isolated) */}
            <HowItWorks />

            {/* Contact — anonymous form → admin feedback panel (source='contact') */}
            <LandingContact />

            <FaqSection />

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
                    <a href="#contact">Liên hệ</a>
                </div>
            </footer>
        </div>
    );
}
