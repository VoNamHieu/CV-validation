// All API calls use Next.js API routes (relative paths)
import type { CVData } from './types';
import type { CvImprovement } from './cv-improvements';

export type OptimizeStyle = 'formal' | 'direct' | 'impact-driven' | 'storytelling';
export type OptimizeFocus = 'balanced' | 'technical' | 'leadership' | 'metrics' | 'ats-keyword';
export type OptimizeLength = 'concise' | 'detailed';

export interface OptimizeOptions {
    style?: OptimizeStyle;
    focus?: OptimizeFocus;
    length?: OptimizeLength;
    variants?: number;
    useGaps?: boolean;
    // Free-text points the candidate wants emphasized/incorporated on re-optimize.
    // Honored without fabrication — reframes existing CV content only.
    notes?: string;
}

export interface OptimizeVariant {
    label: string;
    style: OptimizeStyle;
    focus: OptimizeFocus;
    length: OptimizeLength;
    cv: CVData;
    // Model-stated explanation of what was changed for this job (Vietnamese).
    improvements?: CvImprovement[];
}

export interface OptimizeResponse {
    variants: OptimizeVariant[];
}

export async function parsePdfWithAI(file: File, type: 'cv' | 'jd') {
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const res = await fetch('/api/parse-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: base64, type }),
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to parse PDF');
    }
    return res.json();
}

export async function extractCvStructured(rawText: string) {
    const res = await fetch('/api/ai/extract-cv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to extract CV');
    }
    return res.json();
}

export async function extractJdStructured(rawText: string) {
    const res = await fetch('/api/ai/extract-jd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_text: rawText }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to extract JD');
    }
    return res.json();
}

export async function scoreFit(cv: unknown, jd: unknown) {
    const res = await fetch('/api/ai/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv, jd }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to score fit');
    }
    return res.json();
}

export async function optimizeCvVariants(
    cv: unknown,
    jd: unknown,
    match: unknown,
    options?: OptimizeOptions,
): Promise<OptimizeResponse> {
    const res = await fetch('/api/ai/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv, jd, match, options }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to optimize CV');
    }
    return res.json();
}

export async function crawlUrl(url: string, keepLinks = false): Promise<{ text: string; textWithLinks?: string; jsonLd?: Record<string, unknown> | null; source_url?: string }> {
    const res = await fetch('/api/crawl-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, keepLinks }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to crawl URL');
    }
    return res.json();
}

// ── Smart Search: AI infers job title from CV + generates search URL ──
export async function smartSearch(cv: unknown, siteUrl: string) {
    const res = await fetch('/api/ai/smart-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv, siteUrl }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to generate search');
    }
    return res.json();
}

// ── Extract job links from search results page ──
export async function extractJobLinks(htmlText: string, siteUrl: string) {
    const res = await fetch('/api/ai/extract-job-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html_text: htmlText, site_url: siteUrl }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to extract job links');
    }
    return res.json();
}

export interface RankedJob {
    url: string;
    title: string;
    fit_score: number;
    reason: string;
}

// ── Rank candidate jobs by predicted CV fit BEFORE crawling, so we spend the
//    crawl budget on the most promising jobs instead of whatever the site
//    listed first. Falls back to original order if ranking is unavailable. ──
export async function rankJobsByFit(
    cv: unknown,
    jobs: { url: string; title?: string }[],
): Promise<RankedJob[]> {
    const res = await fetch('/api/ai/rank-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cv, jobs }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to rank jobs');
    }
    const data = await res.json();
    return Array.isArray(data?.ranked) ? data.ranked : [];
}

// ── Tournament ranking for candidate lists larger than one rank-jobs call
//    can see (the route caps candidates at 30). Jobs are dealt into pools,
//    pools are ranked in parallel, and the winners meet in a final round
//    that sees every finalist in a single context. Pool fit_scores only
//    select finalists — each LLM call grades on its own scale, so scores
//    are not comparable across pools; the final round decides the order. ──
const RANK_CALL_MAX = 30; // hard candidate cap enforced by /api/ai/rank-jobs
const RANK_POOL_SIZE = 25;

export async function rankJobsTournament(
    cv: unknown,
    jobs: { url: string; title?: string; company?: string }[],
): Promise<RankedJob[]> {
    const seen = new Set<string>();
    const unique = jobs.filter((j) => {
        if (!j?.url || seen.has(j.url)) return false;
        seen.add(j.url);
        return true;
    });

    if (unique.length <= RANK_CALL_MAX) {
        return rankJobsByFit(cv, unique);
    }

    // Interleave by company so no pool is dominated by a single employer
    // (the flat list arrives grouped by company). Jobs without a company
    // group by hostname instead.
    const groups = new Map<string, typeof unique>();
    for (const j of unique) {
        let key = j.company || '';
        if (!key) {
            try { key = new URL(j.url).hostname; } catch { key = ''; }
        }
        const g = groups.get(key);
        if (g) g.push(j); else groups.set(key, [j]);
    }
    const buckets = [...groups.values()];
    const interleaved: typeof unique = [];
    for (let i = 0; interleaved.length < unique.length; i++) {
        for (const b of buckets) {
            if (i < b.length) interleaved.push(b[i]);
        }
    }

    // Deal into pools round-robin so each pool is a fair cross-section.
    const poolCount = Math.ceil(unique.length / RANK_POOL_SIZE);
    const pools: (typeof unique)[] = Array.from({ length: poolCount }, () => []);
    interleaved.forEach((j, i) => pools[i % poolCount].push(j));

    // Keep the final round under the per-call cap.
    const finalistsPerPool = Math.max(1, Math.floor(RANK_CALL_MAX / poolCount));

    const settled = await Promise.allSettled(
        pools.map((p) => rankJobsByFit(cv, p.map(({ url, title }) => ({ url, title })))),
    );
    const poolPicks = settled.map((res, i) => {
        // A failed pool still sends its leading jobs through unranked rather
        // than knocking its companies out of the running entirely.
        const picks = res.status === 'fulfilled' && res.value.length ? res.value : pools[i];
        return picks.slice(0, finalistsPerPool).map((p) => ({ url: p.url, title: p.title }));
    });

    // Interleave finalists by pool rank (every pool's #1 first, then #2, ...)
    // so the no-final-round fallback below is still a fair order.
    const finalists: { url: string; title?: string }[] = [];
    for (let rank = 0; rank < finalistsPerPool; rank++) {
        for (const picks of poolPicks) {
            if (rank < picks.length) finalists.push(picks[rank]);
        }
    }

    try {
        const final = await rankJobsByFit(cv, finalists);
        if (final.length) return final;
    } catch {
        // fall through to the pool-rank order
    }
    return finalists.map((f) => ({ url: f.url, title: f.title || '', fit_score: 0, reason: '' }));
}

// ── Fetch a single page with Playwright via Railway backend ──
export async function fetchPage(url: string): Promise<{
    success: boolean;
    text: string;
    method: string;
    error?: string;
    jsonLd?: Record<string, unknown>;
    blocked?: boolean;
}> {
    const res = await fetch('/api/fetch-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to fetch page');
    }
    return res.json();
}

// ── Career Finder: discover a company's own careers page + jobs ──
//
// Backend pipeline (career_finder.py) accepts ONE of:
//   - input_url:   TopCV/VietnamWorks URL (company profile or job posting)
//   - homepage_url: the company's own homepage (skips Stage 0)
//   - company_name: cache-lookup only; misses return notes telling the caller
//                   to provide a TopCV/VNW URL once to populate
export interface CareerFinderInput {
    input_url?: string;
    homepage_url?: string;
    company_name?: string;
}

export interface CompanyResolution {
    company_name: string;
    website_url: string;
    source: string;        // "topcv_profile" | "topcv_job" | "vnw_job" | "user_input" | "cache"
    notes: string;
}

export interface CareerPage {
    url: string;
    method: string;        // "nav" | "brute_force" | "sitemap"
    title: string;
    confidence: number;    // 0..1
}

export interface JobListing {
    title: string;
    url: string;
    location: string;
}

export interface FinderResult {
    resolution: CompanyResolution;
    career_candidates: CareerPage[];
    chosen_career: CareerPage | null;
    jobs: JobListing[];
    stages_run: string[];
    errors: string[];
}

export async function findCareer(input: CareerFinderInput): Promise<FinderResult> {
    const res = await fetch('/api/career/find', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to find career page');
    }
    return res.json();
}

// ── Featured companies (demo flow) ──
// Returns jobs aggregated across a curated list of VN employers' career
// pages. Backend caches the result for ~30 minutes; pass {refresh:true} to
// force a re-fetch.
export interface FeaturedCompanyJobs {
    name: string;
    homepage: string;
    career_url: string;
    jobs: JobListing[];
}

export interface FeaturedJobsResult {
    fetched_at: number;
    from_cache: boolean;
    companies: FeaturedCompanyJobs[];
}

export async function getFeaturedJobs(opts: { refresh?: boolean } = {}): Promise<FeaturedJobsResult> {
    const qs = opts.refresh ? '?refresh=true' : '';
    const res = await fetch(`/api/career/featured-jobs${qs}`, { method: 'POST' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to load featured jobs');
    }
    return res.json();
}

// ── Extension presence check ──
export function isExtensionAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return !!(window as any).__jobfitExtensionId;
}

// ── Render an optimized-CV's HTML to a PDF (base64) via the backend.
//    The backend drives a single shared Chromium, so transient overload/crash
//    500s happen under concurrent load. Retry those silently with backoff so a
//    blip never surfaces to the user; 4xx (bad/oversized html) fail fast since
//    a retry can't fix them. Used by every render call site (eager per-job
//    cache, manual download, batch apply) — keep the retry in one place. ──
export interface RenderedPdf {
    base64: string;
    filename: string;
    sizeBytes?: number;
}

export async function renderCvPdf(
    html: string,
    filename: string,
    attempts = 3,
): Promise<RenderedPdf> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        let res: Response | null = null;
        try {
            res = await fetch('/api/render-cv-pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ html, filename }),
            });
        } catch (e) {
            lastErr = e; // network error — transient, retry
        }
        if (res) {
            if (res.ok) return (await res.json()) as RenderedPdf;
            const err = await res.json().catch(() => ({}));
            const message = err.detail || `HTTP ${res.status}`;
            // 4xx (bad/oversized html) won't succeed on retry — fail fast.
            if (res.status < 500 && res.status !== 429) throw new Error(message);
            lastErr = new Error(message); // 5xx / 429 — transient
        }
        if (attempt < attempts) {
            await new Promise((r) => setTimeout(r, 700 * attempt)); // 700ms, 1400ms
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Failed to render PDF');
}

// ── Crawl a URL by opening it in a background tab via the Chrome extension.
//    Bypasses Cloudflare because the request originates from the user's own
//    browser on their residential IP, with their normal cookies/session.    ──
export async function extensionCrawl(url: string, timeoutMs = 45000): Promise<{
    success: boolean;
    text: string;
    textWithLinks?: string;
    html?: string;
    jsonLd?: Record<string, unknown> | null;
    error?: string;
}> {
    if (typeof window === 'undefined') {
        return { success: false, text: '', error: 'No window (SSR)' };
    }
    if (!isExtensionAvailable()) {
        return { success: false, text: '', error: 'Extension not installed' };
    }

    const requestId = `extcrawl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve) => {
        const onMessage = (event: MessageEvent) => {
            if (event.source !== window) return;
            const d = event.data;
            if (d?.type !== 'JOBFIT_EXT_CRAWL_RESPONSE' || d.requestId !== requestId) return;
            cleanup();
            resolve({
                success: !!d.success,
                text: d.text || '',
                textWithLinks: d.textWithLinks,
                html: d.html,
                jsonLd: d.jsonLd ?? null,
                error: d.error,
            });
        };
        const timer = setTimeout(() => {
            cleanup();
            resolve({ success: false, text: '', error: `Extension crawl timed out after ${timeoutMs}ms` });
        }, timeoutMs);
        const cleanup = () => {
            window.removeEventListener('message', onMessage);
            clearTimeout(timer);
        };

        window.addEventListener('message', onMessage);
        window.postMessage({ type: 'JOBFIT_EXT_CRAWL', requestId, url }, '*');
    });
}
