// All API calls use Next.js API routes (relative paths)
import { getAuthHeaders } from './auth-headers';
import type { CVData } from './types';
import type { CvImprovement, CvSuggestion } from './cv-improvements';

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
    // Prospective improvements needing the candidate's real input (Vietnamese).
    suggestions?: CvSuggestion[];
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
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
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
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
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
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
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
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ cv, jd }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to score fit');
    }
    return res.json();
}

// Deep gap analysis: JD vs how the current CV demonstrates the candidate's
// ability. Returns a GapReport (see lib/gap-report). Credit-metered ('gap_report').
export async function generateGapReport(cv: unknown, jd: unknown, match?: unknown) {
    const res = await fetch('/api/ai/gap-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ cv, jd, match }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Tạo báo cáo gap thất bại');
    }
    return res.json() as Promise<import('@/lib/gap-report').GapReport>;
}

export async function optimizeCvVariants(
    cv: unknown,
    jd: unknown,
    match: unknown,
    options?: OptimizeOptions,
): Promise<OptimizeResponse> {
    const res = await fetch('/api/ai/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
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

// ── Smart Search: generate a site-specific search URL for an arbitrary job
//    site. Used only as the fallback for sites not in the buildSearchUrl
//    template table. Pass `jobTitle` (the role confirmed on the upload step)
//    so the URL respects the user's choice instead of re-inferring from the CV.
export async function smartSearch(cv: unknown, siteUrl: string, jobTitle?: string) {
    const res = await fetch('/api/ai/smart-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ cv, siteUrl, jobTitle }),
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
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ html_text: htmlText, site_url: siteUrl }),
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to extract job links');
    }
    return res.json();
}

// ── Link-health monitor: report a job URL the pipeline failed to fetch ──
// Fire-and-forget — never blocks or throws into the pipeline.
export function reportBrokenLink(input: {
    url: string; company?: string; title?: string; reason?: string;
}): void {
    if (!input.url) return;
    void fetch('/api/monitor/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'pipeline', ...input }),
    }).catch(() => { /* monitoring must never break the flow */ });
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
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ cv, jobs }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to rank jobs');
    }
    const data = await res.json();
    return Array.isArray(data?.ranked) ? data.ranked : [];
}

const RANK_CALL_MAX = 30; // hard candidate cap enforced by /api/ai/rank-jobs

// Interleave a flat (company-grouped) list so no contiguous run is dominated by
// a single employer. Jobs without a company group by hostname instead. Used to
// seed the first tournament round with fair cross-sections.
function interleaveByCompany<T extends { url: string; company?: string }>(jobs: T[]): T[] {
    const groups = new Map<string, T[]>();
    for (const j of jobs) {
        let key = j.company || '';
        if (!key) {
            try { key = new URL(j.url).hostname; } catch { key = ''; }
        }
        const g = groups.get(key);
        if (g) g.push(j); else groups.set(key, [j]);
    }
    const buckets = [...groups.values()];
    const out: T[] = [];
    for (let i = 0; out.length < jobs.length; i++) {
        for (const b of buckets) {
            if (i < b.length) out.push(b[i]);
        }
    }
    return out;
}

// ── Tournament ranking for candidate lists larger than one rank-jobs call can
//    see (the route caps candidates at 30, and each call grades fit_score on
//    its own 0-100 scale, so scores are NOT comparable across separate calls).
//
//    Naively splitting into fixed pools and taking the top-K of each pool is
//    unfair: a strong job in a deep pool can be cut while a weaker job in a
//    shallow pool advances, because per-pool quotas — not whole-pool fit —
//    decide who survives. Instead we run a REDUCTION tournament: each round
//    splits the surviving field into rank-call-sized cross-sections, ranks them
//    in parallel, and carries each chunk's leaders forward. We keep enough per
//    chunk that no globally-strong job can be eliminated early — a job in the
//    overall top 10 is beaten by fewer than 10 others anywhere, so it always
//    lands in the top 10 of whatever chunk it's dealt into. The field shrinks
//    each round until it fits one call; that FINAL round grades every survivor
//    together, producing an order that reflects whole-pool fit rather than any
//    single pool's internal ranking. ──
const RANK_KEEP_PER_CHUNK = 10;

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

    // Reduce the field round by round until it fits a single rank call.
    let field: { url: string; title?: string }[] = interleaveByCompany(unique);
    while (field.length > RANK_CALL_MAX) {
        const chunkCount = Math.ceil(field.length / RANK_CALL_MAX);
        const chunks: (typeof field)[] = Array.from({ length: chunkCount }, () => []);
        // Round-robin deal so every chunk is a fair cross-section of the field.
        field.forEach((j, i) => chunks[i % chunkCount].push(j));

        const settled = await Promise.allSettled(
            chunks.map((c) => rankJobsByFit(cv, c.map(({ url, title }) => ({ url, title })))),
        );
        const survivors: typeof field = [];
        settled.forEach((res, i) => {
            // A failed chunk still advances its leading jobs unranked rather
            // than knocking them out of the running entirely.
            const ranked = res.status === 'fulfilled' && res.value.length ? res.value : chunks[i];
            for (const j of ranked.slice(0, RANK_KEEP_PER_CHUNK)) {
                survivors.push({ url: j.url, title: j.title });
            }
        });

        // Safety: if a degenerate case failed to shrink the field, cap and stop
        // so we can't loop forever.
        if (survivors.length >= field.length) {
            field = survivors.slice(0, RANK_CALL_MAX);
            break;
        }
        field = survivors;
    }

    // Final round: every survivor graded together → globally comparable order.
    try {
        const final = await rankJobsByFit(cv, field);
        if (final.length) return final;
    } catch {
        // fall through to the carried order
    }
    return field.map((f) => ({ url: f.url, title: f.title || '', fit_score: 0, reason: '' }));
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
    url: string;            // the JD page to crawl/score (may be an aggregator)
    apply_url?: string;     // official link to send the user to (never aggregator)
    location: string;
    // JD text when the source ATS API already returned it — lets the pipeline
    // score WITHOUT re-crawling the (often SPA / IP-blocked) JD page.
    description?: string;
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
    // True while the backend is still building its cache (first run / cold
    // start). companies is empty (or stale) — poll again shortly.
    warming?: boolean;
    stale?: boolean;
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

/**
 * Featured jobs with warm-up polling. The backend now warms its cache out of
 * band and returns {warming:true, companies:[]} until the first crawl finishes,
 * so we poll short requests instead of blocking on one long one (which used to
 * 500/timeout). Resolves as soon as companies are available, the backend
 * reports it's no longer warming, or maxWaitMs elapses.
 */
export async function getFeaturedJobsWarm(
    onWaiting?: (attempt: number) => void,
    opts: { maxWaitMs?: number; pollMs?: number } = {},
): Promise<FeaturedJobsResult> {
    return pollWarm(() => getFeaturedJobs(), onWaiting, opts);
}

// ── Facet search (Phase-1 engine) ──
// Ranks the featured pool by role-family adjacency × industry × location
// against a CV-derived/explicit profile (backend taxonomy.py). Replaces the
// token-overlap title filter + LLM tournament so the auto-flow only ever
// surfaces jobs inside the candidate's role space (+ adjacent families).
export interface FacetSearchJob {
    url: string;
    apply_url?: string;
    title: string;
    company?: string;
    career_url?: string;
    location?: string;
    description?: string;
    industry?: string;
    _facet?: {
        score: number;
        role_family: string;
        industry: string;
        role_w: number;
        in_domain: boolean;
    };
}

export interface FacetSearchRequest {
    cv_text?: string;
    target_roles?: string[];
    // Candidate's PROVEN role titles (CV) — the fit CONSTRAINT, distinct from
    // target_roles (the DIRECTION). Empty → fit is neutral.
    cv_roles?: string[];
    domains?: string[];
    level?: string;
    // Candidate's years of experience — lets the backend demote jobs that
    // out-reach the candidate so they rank lower instead of appearing first
    // and then being flagged "too much experience" at optimize time.
    years_of_experience?: number;
    desired_locations?: string[];
    salary_floor?: number;
    limit?: number;
    rerank?: boolean;
}

export interface FacetSearchResult {
    warming?: boolean;
    profile?: Record<string, unknown>;
    reranked?: boolean;
    total_matched?: number;
    results: FacetSearchJob[];
}

/**
 * Apply-time liveness gate: is this posting still open? Backend reuses the
 * link-health validator (fail-open: only a confirmed-dead 'broken' returns
 * alive=false). ALSO fail-open on any transport/backend error here — a gate
 * outage must never block a real application.
 */
export async function verifyJobAlive(url: string, title = ''): Promise<{ alive: boolean; status?: string; reason?: string }> {
    try {
        const res = await fetch('/api/store/jobs/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, title }),
            signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return { alive: true };
        const data = await res.json();
        return { alive: data?.alive !== false, status: data?.status, reason: data?.reason };
    } catch {
        return { alive: true };
    }
}

export async function searchFeaturedJobs(req: FacetSearchRequest): Promise<FacetSearchResult> {
    const res = await fetch('/api/career/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to search jobs');
    }
    return res.json();
}

// Same warm-up contract as the featured/discover pollers: the backend returns
// {warming:true, results:[]} while the pool builds, so poll short requests
// instead of blocking on one long one.
export async function searchFeaturedJobsWarm(
    req: FacetSearchRequest,
    onWaiting?: (attempt: number) => void,
    opts: { maxWaitMs?: number; pollMs?: number } = {},
): Promise<FacetSearchResult> {
    const maxWaitMs = opts.maxWaitMs ?? 180_000;
    const pollMs = opts.pollMs ?? 4_000;
    const deadline = Date.now() + maxWaitMs;
    let attempt = 0;
    for (;;) {
        const res = await searchFeaturedJobs(req);
        if ((res.results || []).length > 0) return res;  // ranked data ready
        if (!res.warming) return res;                     // genuinely empty
        if (Date.now() >= deadline) return res;           // gave up waiting
        attempt++;
        onWaiting?.(attempt);
        await new Promise((r) => setTimeout(r, pollMs));
    }
}

// ── Search profile inferred from the CV (roles + domains + strengths) ──
export interface SearchProfile {
    target_roles: string[];
    domains: string[];
    strengths: string[];
    seniority: string;
}

export async function inferSearchProfile(cv: unknown): Promise<SearchProfile> {
    const res = await fetch('/api/ai/search-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ cv }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to infer search profile');
    }
    return res.json();
}

// ── Dynamic discovery (grounded search by candidate profile) ──
// Finds openings fitting the candidate's roles/domains/strengths via grounded
// web search, then lists their jobs. Same response shape + warming contract.
export interface DiscoverProfile {
    roles: string[];
    domains?: string[];
    strengths?: string[];
}

export async function discoverJobs(
    profile: DiscoverProfile,
    location = '',
    opts: { limit?: number; refresh?: boolean } = {},
): Promise<FeaturedJobsResult> {
    const qs = new URLSearchParams({ roles: profile.roles.join(',') });
    if (profile.domains?.length) qs.set('domain', profile.domains.join(','));
    if (profile.strengths?.length) qs.set('strengths', profile.strengths.join(','));
    if (location) qs.set('location', location);
    if (opts.limit) qs.set('limit', String(opts.limit));
    if (opts.refresh) qs.set('refresh', 'true');
    const res = await fetch(`/api/career/discover?${qs.toString()}`, { method: 'POST' });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to discover jobs');
    }
    return res.json();
}

export async function discoverJobsWarm(
    profile: DiscoverProfile,
    location = '',
    onWaiting?: (attempt: number) => void,
    opts: { limit?: number; maxWaitMs?: number; pollMs?: number } = {},
): Promise<FeaturedJobsResult> {
    return pollWarm(() => discoverJobs(profile, location, { limit: opts.limit }), onWaiting, opts);
}

// Shared warm-up poller: calls `fetchOnce` until it returns companies, reports
// it's no longer warming, or maxWaitMs elapses.
async function pollWarm(
    fetchOnce: () => Promise<FeaturedJobsResult>,
    onWaiting?: (attempt: number) => void,
    opts: { maxWaitMs?: number; pollMs?: number } = {},
): Promise<FeaturedJobsResult> {
    const maxWaitMs = opts.maxWaitMs ?? 180_000;
    const pollMs = opts.pollMs ?? 4_000;
    const deadline = Date.now() + maxWaitMs;
    let attempt = 0;
    for (;;) {
        const res = await fetchOnce();
        if (res.companies.length > 0) return res;   // got data (fresh or stale)
        if (!res.warming) return res;               // genuinely empty, not warming
        if (Date.now() >= deadline) return res;     // gave up waiting
        attempt++;
        onWaiting?.(attempt);
        await new Promise((r) => setTimeout(r, pollMs));
    }
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
