'use client';

// In-app "Cơ hội nổi bật" view (Sidebar → featured). Master-detail layout:
// a scrollable job list on the left, the selected job's detail on the right.
// Each detail carries two CTAs — "Tối ưu CV" (kicks off the in-app optimize
// flow via the store, same path a public /j/<slug> page uses) and "Xem chi
// tiết" (opens the full self-hosted landing page). Shown only inside the authed
// app shell, so no auth guard here.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
    ArrowLeft, ArrowSquareOut, Sparkle, MapPin, Buildings,
    ChartLineUp, SpinnerGap, Briefcase,
} from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import { renderJd } from '@/lib/renderJd';
import styles from './featuredJobs.module.css';

type FeaturedJob = {
    slug: string;
    title?: string;
    company_name?: string;
    location?: string;
    industry?: string;
    role_family?: string;
    seniority?: string;
    has_logo?: boolean;
};

type JobDetail = {
    slug: string;
    has_logo?: boolean;
    job: {
        title: string;
        company_name: string;
        location: string;
        description: string;
        industry: string;
        role_family: string;
        seniority: string;
    };
};

function seniorityBadge(sen?: string): string {
    const v = (sen || '').toLowerCase();
    if (v.includes('intern') || v.includes('thực tập')) return 'Thực tập';
    if (v.includes('fresh') || v.includes('junior') || v.includes('entry') || v.includes('graduate')) return 'Fresher';
    if (v.includes('senior') || v.includes('lead') || v.includes('manager') || v.includes('cao')) return 'Cấp cao';
    return 'Toàn thời gian';
}

// Level filter: map each raw taxonomy seniority to a compact VN label, ordered
// entry-level → executive so the menu reads top-down. Filtering matches the raw
// `seniority` value exactly (keyword match, no embedding) — the label is display
// only. Unknown values fall through to their raw string.
const LEVEL_ORDER = ['Intern', 'Fresher', 'Junior', 'Mid', 'Senior', 'Lead/Manager', 'Director/Head+'];
const LEVEL_LABEL: Record<string, string> = {
    'Intern': 'Thực tập',
    'Fresher': 'Fresher',
    'Junior': 'Junior',
    'Mid': 'Mid',
    'Senior': 'Senior',
    'Lead/Manager': 'Quản lý',
    'Director/Head+': 'Giám đốc / Head',
};
const levelLabel = (s: string) => LEVEL_LABEL[s] || s;

const logoSrc = (slug: string) => `/api/store/promoted/logo-by-slug/${encodeURIComponent(slug)}`;

export default function FeaturedJobsView() {
    const [jobs, setJobs] = useState<FeaturedJob[]>([]);
    // loading / ready / error — never collapse a transient fetch failure into
    // the "empty pool" message (see the earlier flicker fix).
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [selected, setSelected] = useState<string | null>(null);
    // Mobile only: the detail pane is an off-canvas overlay; this toggles it.
    const [mobileOpen, setMobileOpen] = useState(false);
    const [details, setDetails] = useState<Record<string, JobDetail>>({});
    const [detailStatus, setDetailStatus] = useState<'idle' | 'loading' | 'error'>('idle');
    // Keyword (structured) filters over the loaded featured set — industry +
    // seniority, matched exactly against each job's own field. No pool search,
    // no embedding: we just narrow the ~24 curated cards already in hand.
    const [industryFilter, setIndustryFilter] = useState('');
    const [levelFilter, setLevelFilter] = useState('');

    // "Tối ưu CV cho job này" — seeding pendingPromotedSlug is exactly what a
    // public /j/<slug> CTA does; PromotedResume (mounted in the app shell) picks
    // it up, fetches the snapshot, scores fit, and drops the user into step 3.
    const optimizeForJob = useAppStore((s) => s.setPendingPromotedSlug);

    useEffect(() => {
        let alive = true;
        let attempt = 0;
        const load = async () => {
            try {
                const r = await fetch('/api/store/promoted/featured?limit=24', { cache: 'no-store' });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const rows = await r.json();
                if (!Array.isArray(rows)) throw new Error('bad payload');
                if (!alive) return;
                setJobs(rows);
                setStatus('ready');
                // Default-select the first job so the desktop detail pane is
                // never blank. On mobile the overlay stays closed (mobileOpen).
                if (rows.length) setSelected((cur) => cur ?? rows[0].slug);
            } catch {
                if (!alive) return;
                if (attempt < 3) { attempt += 1; setTimeout(load, 600 * attempt); }
                else setStatus('error');
            }
        };
        load();
        return () => { alive = false; };
    }, []);

    // Fetch the selected job's snapshot (JD + industry) once, then cache it.
    useEffect(() => {
        if (!selected || details[selected]) { setDetailStatus('idle'); return; }
        let alive = true;
        setDetailStatus('loading');
        fetch(`/api/store/promoted/by-slug/${encodeURIComponent(selected)}`, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error('detail'))))
            .then((d: JobDetail) => { if (alive) { setDetails((m) => ({ ...m, [selected]: d })); setDetailStatus('idle'); } })
            .catch(() => { if (alive) setDetailStatus('error'); });
        return () => { alive = false; };
    }, [selected, details]);

    // Dropdown options = only the industries / levels actually present in the
    // loaded cards, so a filter never lands on an empty result. Industries are
    // ordered by how many jobs carry them; levels by seniority rank.
    const industryOpts = useMemo(() => {
        const m = new Map<string, number>();
        for (const j of jobs) if (j.industry) m.set(j.industry, (m.get(j.industry) || 0) + 1);
        return [...m.entries()].sort((a, b) => b[1] - a[1]);
    }, [jobs]);
    const levelOpts = useMemo(() => {
        const s = new Set<string>();
        for (const j of jobs) if (j.seniority) s.add(j.seniority);
        const rank = (v: string) => { const i = LEVEL_ORDER.indexOf(v); return i < 0 ? 99 : i; };
        return [...s].sort((a, b) => rank(a) - rank(b));
    }, [jobs]);

    const visibleJobs = useMemo(() => jobs.filter((j) =>
        (!industryFilter || j.industry === industryFilter) &&
        (!levelFilter || j.seniority === levelFilter),
    ), [jobs, industryFilter, levelFilter]);

    // Keep the selection valid as filters change: if the selected card was
    // filtered out, jump to the first still-visible one so the detail pane never
    // shows a job the list no longer contains.
    useEffect(() => {
        if (!visibleJobs.length) return;
        if (!visibleJobs.some((j) => j.slug === selected)) setSelected(visibleJobs[0].slug);
    }, [visibleJobs, selected]);

    const selectJob = (slug: string) => { setSelected(slug); setMobileOpen(true); };

    const listMeta = (j: FeaturedJob) =>
        [j.company_name, j.location].filter(Boolean).join(' · ');

    const detail = selected ? details[selected] : undefined;
    // Fallback to the card row while the snapshot loads, so the detail header
    // isn't anonymous mid-fetch.
    const selCard = jobs.find((j) => j.slug === selected);

    return (
        <div className={styles.view}>
            <section className={styles.hero}>
                <span className={styles.eyebrow}>Cơ hội nổi bật</span>
                <h1 className={styles.title}>Việc làm tuyển chọn từ công ty hàng đầu</h1>
                <p className={styles.sub}>
                    Vị trí có nguồn thật, cập nhật mỗi ngày. Chọn một tin để xem chi tiết, rồi tối ưu CV cho đúng vị trí đó.
                </p>
            </section>

            {jobs.length === 0 ? (
                <div className={styles.empty}>
                    {status === 'loading' && 'Đang tải cơ hội…'}
                    {status === 'error' && 'Không tải được cơ hội lúc này. Thử lại sau nhé.'}
                    {status === 'ready' && 'Chưa có cơ hội nào được đăng. Quay lại sau nhé.'}
                </div>
            ) : (
                <>
                    {(industryOpts.length > 1 || levelOpts.length > 1) && (
                        <div className={styles.filterBar}>
                            <select
                                className={`${styles.filterSelect} ${industryFilter ? styles.filterSelectActive : ''}`}
                                value={industryFilter}
                                onChange={(e) => setIndustryFilter(e.target.value)}
                                aria-label="Lọc theo ngành"
                            >
                                <option value="">Tất cả ngành</option>
                                {industryOpts.map(([name, n]) => (
                                    <option key={name} value={name}>{name} ({n})</option>
                                ))}
                            </select>
                            <select
                                className={`${styles.filterSelect} ${levelFilter ? styles.filterSelectActive : ''}`}
                                value={levelFilter}
                                onChange={(e) => setLevelFilter(e.target.value)}
                                aria-label="Lọc theo cấp bậc"
                            >
                                <option value="">Tất cả cấp bậc</option>
                                {levelOpts.map((s) => (
                                    <option key={s} value={s}>{levelLabel(s)}</option>
                                ))}
                            </select>
                            {(industryFilter || levelFilter) && (
                                <button type="button" className={styles.filterReset}
                                    onClick={() => { setIndustryFilter(''); setLevelFilter(''); }}>
                                    Xoá lọc
                                </button>
                            )}
                            <span className={styles.filterCount}>{visibleJobs.length} vị trí</span>
                        </div>
                    )}

                    <div className={styles.layout}>
                    {/* ── Left: job list ── */}
                    <div className={styles.list}>
                        {visibleJobs.length === 0 ? (
                            <div className={styles.listEmpty}>Không có vị trí nào khớp bộ lọc.</div>
                        ) : visibleJobs.map((j) => {
                            const active = j.slug === selected;
                            return (
                                <button
                                    key={j.slug}
                                    type="button"
                                    onClick={() => selectJob(j.slug)}
                                    className={`${styles.jobCard} ${active ? styles.jobCardActive : ''}`}
                                >
                                    {j.has_logo ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img className={styles.cardLogo} src={logoSrc(j.slug)} alt={j.company_name || ''} loading="lazy" />
                                    ) : (
                                        <span className={styles.cardLogoFallback}>{(j.company_name || '?').charAt(0)}</span>
                                    )}
                                    <span className={styles.cardMain}>
                                        <span className={styles.cardTitle}>{j.title || 'Vị trí đang tuyển'}</span>
                                        <span className={styles.cardMeta}>{listMeta(j)}</span>
                                        <span className={styles.cardBadge}>{seniorityBadge(j.seniority)}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {/* ── Right: detail pane (off-canvas overlay on mobile) ── */}
                    <div className={`${styles.detail} ${mobileOpen ? styles.detailOpen : ''}`}>
                        <button type="button" className={styles.backBtn} onClick={() => setMobileOpen(false)}>
                            <ArrowLeft size={16} weight="bold" /> Danh sách
                        </button>

                        {detailStatus === 'loading' && !detail ? (
                            <div className={styles.detailLoading}>
                                <SpinnerGap size={26} weight="bold" className={styles.spin} />
                                <span>Đang tải mô tả…</span>
                            </div>
                        ) : detailStatus === 'error' && !detail ? (
                            <div className={styles.detailLoading}>Không tải được mô tả. Thử chọn lại tin khác.</div>
                        ) : (selCard || detail) ? (
                            <>
                                <div className={styles.detailHead}>
                                    <div className={styles.detailTop}>
                                        {(detail?.has_logo ?? selCard?.has_logo) ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img className={styles.detailLogo} src={logoSrc(selected!)} alt="" />
                                        ) : (
                                            <span className={styles.detailLogoFallback}>
                                                {(detail?.job.company_name || selCard?.company_name || '?').charAt(0)}
                                            </span>
                                        )}
                                        <div className={styles.detailHeadText}>
                                            <p className={styles.detailCompany}>
                                                {detail?.job.company_name || selCard?.company_name || ''}
                                            </p>
                                            <h2 className={styles.detailTitle}>
                                                {detail?.job.title || selCard?.title || 'Vị trí đang tuyển'}
                                            </h2>
                                        </div>
                                    </div>

                                    <div className={styles.chips}>
                                        {(detail?.job.location || selCard?.location) && (
                                            <span className={styles.chip}><MapPin size={13} weight="fill" />{detail?.job.location || selCard?.location}</span>
                                        )}
                                        {detail?.job.industry && (
                                            <span className={styles.chip}><Buildings size={13} weight="fill" />{detail.job.industry}</span>
                                        )}
                                        {(detail?.job.seniority || selCard?.seniority) && (
                                            <span className={styles.chip}><ChartLineUp size={13} weight="fill" />{seniorityBadge(detail?.job.seniority || selCard?.seniority)}</span>
                                        )}
                                        {(detail?.job.role_family || selCard?.role_family) && (
                                            <span className={styles.chip}><Briefcase size={13} weight="fill" />{detail?.job.role_family || selCard?.role_family}</span>
                                        )}
                                    </div>

                                    <div className={styles.actions}>
                                        <button type="button" className={styles.primaryBtn} onClick={() => optimizeForJob(selected!)}>
                                            <Sparkle size={17} weight="fill" /> Tối ưu CV
                                        </button>
                                        <Link href={`/j/${selected}`} target="_blank" rel="noopener" className={styles.secondaryBtn}>
                                            <ArrowSquareOut size={16} weight="bold" /> Xem chi tiết
                                        </Link>
                                    </div>
                                </div>

                                <div className={styles.detailBody}>
                                    <h3 className={styles.bodyHeading}>Mô tả công việc</h3>
                                    <div className={styles.jd}>
                                        {detail?.job.description
                                            ? renderJd(detail.job.description)
                                            : detailStatus === 'loading'
                                                ? <p className={styles.jdMuted}>Đang tải mô tả…</p>
                                                : <p className={styles.jdMuted}>Chưa có mô tả cho vị trí này.</p>}
                                    </div>
                                </div>
                            </>
                        ) : null}
                    </div>
                    </div>
                </>
            )}
        </div>
    );
}
