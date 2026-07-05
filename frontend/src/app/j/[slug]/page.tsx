// Public job landing page ("trang truyền thông"). Self-hosted: renders a
// SNAPSHOT of the job from the backend — no outbound link to the source. Server
// component so it's SEO/OG-friendly for social sharing; the CTA (login vs
// optimize) is a client island.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MapPin, Buildings, Briefcase, ChartLineUp, Sparkle } from '@phosphor-icons/react/dist/ssr';
import PromotedJobCta from '@/components/PromotedJobCta';
import { renderJd } from '@/lib/renderJd';
import styles from './promoted.module.css';

type PublicJob = {
    title: string;
    company_name: string;
    location: string;
    description: string;
    industry: string;
    role_family: string;
    seniority: string;
};
type PromotedPage = {
    slug: string;
    template: string;
    og_image_url: string | null;
    has_logo?: boolean;
    job: PublicJob;
};

// Public URL of the uploaded company logo (real HTTP URL → works as <img> + og:image).
function logoUrl(slug: string, preview?: string): string {
    const base = process.env.BACKEND_URL || '';
    return `${base}/store/promoted/logo-by-slug/${encodeURIComponent(slug)}${preview ? `?preview=${encodeURIComponent(preview)}` : ''}`;
}

async function fetchPage(slug: string, preview?: string): Promise<PromotedPage | null> {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) return null;
    // Forward ?preview=<id> so admins can view a DRAFT via the real /j/ page —
    // the backend only bypasses the published gate when it matches the row id.
    const qs = preview ? `?preview=${encodeURIComponent(preview)}` : '';
    try {
        const res = await fetch(
            `${backendUrl}/store/promoted/by-slug/${encodeURIComponent(slug)}${qs}`,
            { cache: 'no-store' }, // count each view; snapshot is tiny
        );
        if (!res.ok) return null;
        return (await res.json()) as PromotedPage;
    } catch {
        return null;
    }
}

export async function generateMetadata(
    { params, searchParams }: {
        params: Promise<{ slug: string }>;
        searchParams: Promise<{ preview?: string }>;
    },
): Promise<Metadata> {
    const { slug } = await params;
    const { preview } = await searchParams;
    const page = await fetchPage(slug, preview);
    if (!page) return { title: 'Không tìm thấy tin tuyển dụng - Copo' };
    const { title, company_name, description } = page.job;
    const heading = company_name ? `${title} - ${company_name}` : title;
    const summary = (description || '').replace(/\s+/g, ' ').slice(0, 160);
    return {
        title: `${heading} | Copo`,
        description: summary,
        openGraph: {
            title: heading,
            description: summary,
            type: 'website',
            // Prefer an explicit og_image_url; else the uploaded company logo
            // (real URL from the logo endpoint) so social cards show the brand.
            ...(page.og_image_url
                ? { images: [{ url: page.og_image_url }] }
                : page.has_logo ? { images: [{ url: logoUrl(slug) }] } : {}),
        },
    };
}

export default async function PromotedJobPage(
    { params, searchParams }: {
        params: Promise<{ slug: string }>;
        searchParams: Promise<{ preview?: string }>;
    },
) {
    const { slug } = await params;
    const { preview } = await searchParams;
    const page = await fetchPage(slug, preview);
    if (!page) notFound();
    const { title, company_name, location, description, industry, role_family, seniority } = page.job;

    const initial = (company_name || title || '?').trim().charAt(0).toUpperCase();
    const chips = [
        location && { icon: <MapPin size={14} weight="fill" />, text: location },
        industry && { icon: <Buildings size={14} weight="fill" />, text: industry },
        seniority && { icon: <ChartLineUp size={14} weight="fill" />, text: seniority },
    ].filter(Boolean) as { icon: React.ReactNode; text: string }[];

    const facts = [
        company_name && { icon: <Buildings size={17} weight="fill" />, label: 'Công ty', value: company_name },
        location && { icon: <MapPin size={17} weight="fill" />, label: 'Địa điểm', value: location },
        (role_family || industry) && { icon: <Briefcase size={17} weight="fill" />, label: 'Lĩnh vực', value: role_family || industry },
        seniority && { icon: <ChartLineUp size={17} weight="fill" />, label: 'Cấp bậc', value: seniority },
    ].filter(Boolean) as { icon: React.ReactNode; label: string; value: string }[];

    return (
        <main className={styles.page}>
            {/* Top bar */}
            <div className={styles.topbar}>
                <a href="/" className={styles.brand}>
                    <span className={styles.brandMark}><Sparkle size={17} weight="fill" /></span>
                    Copo
                </a>
                <span className={styles.topbarHint}>Việc làm được tuyển chọn</span>
            </div>

            {/* Hero */}
            <div className={styles.hero}>
                <div className={styles.heroInner}>
                    {page.has_logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className={styles.avatar} src={logoUrl(slug, preview)} alt={company_name || title}
                            style={{ objectFit: 'cover' }} />
                    ) : (
                        <div className={styles.avatar}>{initial}</div>
                    )}
                    <div className={styles.heroText}>
                        {company_name && <p className={styles.company}>{company_name}</p>}
                        <h1 className={styles.title}>{title}</h1>
                        {chips.length > 0 && (
                            <div className={styles.chips}>
                                {chips.map((c) => (
                                    <span key={c.text} className={styles.chip}>{c.icon}{c.text}</span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className={styles.layout}>
                <div className={styles.main}>
                    <h2 className={styles.sectionHeading}>Mô tả công việc</h2>
                    <div className={styles.jd}>
                        {description ? renderJd(description) : <p>Chưa có mô tả cho vị trí này.</p>}
                    </div>
                </div>

                <aside className={styles.sidebar}>
                    <PromotedJobCta slug={slug} title={title} />
                    {facts.length > 0 && (
                        <div className={styles.factsCard}>
                            <p className={styles.factsTitle}>Thông tin</p>
                            {facts.map((f) => (
                                <div key={f.label} className={styles.factRow}>
                                    <span className={styles.factIcon}>{f.icon}</span>
                                    <div>
                                        <p className={styles.factLabel}>{f.label}</p>
                                        <p className={styles.factValue}>{f.value}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </aside>
            </div>

            <div className={styles.footerNote}>Trang được cung cấp bởi Copo · Tối ưu CV &amp; ứng tuyển thông minh</div>
        </main>
    );
}
