// Public job landing page ("trang truyền thông"). Self-hosted: renders a
// SNAPSHOT of the job from the backend — no outbound link to the source. Server
// component so it's SEO/OG-friendly for social sharing; the CTA (login vs
// optimize) is a client island.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MapPin, Buildings, ChartLineUp } from '@phosphor-icons/react/dist/ssr';
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
type RelatedItem = {
    slug: string;
    title: string;
    company_name: string;
    location: string;
    has_logo: boolean;
};
type Related = { same_company: RelatedItem[]; similar_role: RelatedItem[] };

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

// Cross-links to OTHER published promoted pages (never job-store rows without a
// page). Best-effort → empty on any failure so the section just doesn't render.
async function fetchRelated(slug: string): Promise<Related> {
    const empty: Related = { same_company: [], similar_role: [] };
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) return empty;
    try {
        const res = await fetch(
            `${backendUrl}/store/promoted/related/${encodeURIComponent(slug)}`,
            { next: { revalidate: 300 } },  // related list is stable; cache 5 min
        );
        if (!res.ok) return empty;
        return (await res.json()) as Related;
    } catch {
        return empty;
    }
}

// One related card → links to another /j/ page. Logo only when the page has one
// (avoids a 404 flash), else a letter avatar.
function RelatedCard({ item }: { item: RelatedItem }) {
    const initial = (item.company_name || item.title || '?').trim().charAt(0).toUpperCase();
    const meta = [item.company_name, item.location].filter(Boolean).join(' · ');
    return (
        <a href={`/j/${item.slug}`} className={styles.relCard}>
            {item.has_logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.relLogo} src={logoUrl(item.slug)} alt={item.company_name || item.title}
                    style={{ objectFit: 'cover', background: '#fff' }} loading="lazy" />
            ) : (
                <div className={styles.relLogo}>{initial}</div>
            )}
            <div className={styles.relText}>
                <p className={styles.relTitle}>{item.title}</p>
                {meta && <p className={styles.relMeta}>{meta}</p>}
            </div>
        </a>
    );
}

function RelatedSection({ heading, items }: { heading: string; items: RelatedItem[] }) {
    if (!items.length) return null;
    return (
        <section className={styles.related}>
            <h2 className={styles.sectionHeading}>{heading}</h2>
            <div className={styles.relRow}>
                {items.map((it) => <RelatedCard key={it.slug} item={it} />)}
            </div>
        </section>
    );
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
    const [page, related] = await Promise.all([fetchPage(slug, preview), fetchRelated(slug)]);
    if (!page) notFound();
    const { title, company_name, location, description, industry, seniority } = page.job;

    // Cross-links, page budget = 10 total. Similar-role fills a compact list in
    // the sidebar (≤5); same-company fills the full-width slider below.
    const roleShow = (related.similar_role || []).slice(0, 5);
    const companyShow = (related.same_company || []).slice(0, Math.max(0, 10 - roleShow.length));

    const initial = (company_name || title || '?').trim().charAt(0).toUpperCase();
    const chips = [
        location && { icon: <MapPin size={14} weight="fill" />, text: location },
        industry && { icon: <Buildings size={14} weight="fill" />, text: industry },
        seniority && { icon: <ChartLineUp size={14} weight="fill" />, text: seniority },
    ].filter(Boolean) as { icon: React.ReactNode; text: string }[];

    return (
        <main className={styles.page}>
            {/* Top bar */}
            <div className={styles.topbar}>
                <a href="/" className={styles.brand}>
                    <span className={styles.brandMark}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/copo-mark-white.png" alt="Copo" width={17} height={17} style={{ display: 'block' }} />
                    </span>
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
                    {roleShow.length > 0 && (
                        <div className={styles.factsCard}>
                            <p className={styles.factsTitle}>Vị trí tương tự</p>
                            {roleShow.map((it) => (
                                <a key={it.slug} href={`/j/${it.slug}`} className={styles.simRow}>
                                    {it.has_logo ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img className={styles.simLogo} src={logoUrl(it.slug)}
                                            alt={it.company_name || it.title}
                                            style={{ objectFit: 'cover', background: '#fff' }} loading="lazy" />
                                    ) : (
                                        <div className={styles.simLogo}>
                                            {(it.company_name || it.title || '?').trim().charAt(0).toUpperCase()}
                                        </div>
                                    )}
                                    <div className={styles.simText}>
                                        <p className={styles.simTitle}>{it.title}</p>
                                        {it.company_name && <p className={styles.simMeta}>{it.company_name}</p>}
                                    </div>
                                </a>
                            ))}
                        </div>
                    )}
                </aside>
            </div>

            {companyShow.length > 0 && (
                <div className={styles.relatedWrap}>
                    <RelatedSection
                        heading={company_name ? `Vị trí khác tại ${company_name}` : 'Vị trí khác cùng công ty'}
                        items={companyShow} />
                </div>
            )}

            <div className={styles.footerNote}>Trang được cung cấp bởi Copo · Tối ưu CV &amp; ứng tuyển thông minh</div>
        </main>
    );
}
