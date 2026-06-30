'use client';

import { useEffect, useRef, useState } from 'react';
import {
    ArrowLeft, Globe, SpinnerGap, MagnifyingGlass, Sparkle,
    Brain, LinkSimple, Lightning, MagicWand, CheckCircle,
    Briefcase, ArrowRight,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAppStore, type JDEntry, type CandidateJob } from '@/store/useAppStore';
import JobResultsView from '@/components/JobResultsView';
import {
    smartSearch, crawlUrl, extractJdStructured, scoreFit, fetchPage,
    extractJobLinks, rankJobsTournament, extensionCrawl, isExtensionAvailable,
    findCareer, discoverJobsWarm, inferSearchProfile, searchFeaturedJobsWarm,
    optimizeCvVariants, reportBrokenLink, type JobListing,
} from '@/lib/api';
import { buildSearchUrl, matchesCity, titleMatchScore, cityLabel, experienceGapExceeds } from '@/lib/job-targeting';
import { buildCvPdfCache } from '@/lib/cv-pdf-cache';
import { filterUnseenCandidates } from '@/lib/job-dedup';

type Phase = 'idle' | 'analyzing_cv' | 'searching' | 'extracting_links'
    | 'ranking' | 'crawling_job';

// Phase labels are intentionally generic — the user should perceive the system
// as "AI is searching for matching jobs", regardless of which backend path is
// actually running. Never name an underlying source (TopCV, featured list...).
// The per-job stages (resolve career page, crawl, extract JD, score, tailor CV)
// all run inside the parallel 'crawling_job' phase — jobs are in different
// stages at the same time, so a single chip represents them.
const PHASE_CONFIG: Record<Exclude<Phase, 'idle'>, { label: string; icon: Icon }> = {
    analyzing_cv: { label: 'AI đang phân tích CV của bạn...', icon: Brain },
    searching: { label: 'Đang tìm tin tuyển dụng phù hợp...', icon: MagnifyingGlass },
    extracting_links: { label: 'Đang tổng hợp danh sách việc làm...', icon: LinkSimple },
    ranking: { label: 'Đang xếp hạng việc theo độ phù hợp CV...', icon: Sparkle },
    crawling_job: { label: 'Đang phân tích các việc song song...', icon: Lightning },
};

const PHASE_ORDER: Exclude<Phase, 'idle'>[] = [
    'analyzing_cv', 'searching', 'extracting_links', 'ranking', 'crawling_job',
];

// Parallel job slots — capped so concurrent Gemini calls stay under rate limits
const JOB_CONCURRENCY = 3;

// One retry with backoff: parallel processing raises the odds of transient AI 429/502s
async function withRetry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 1500): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
        try { return await fn(); } catch (e) {
            lastErr = e;
            if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        }
    }
    throw lastErr;
}

// ── Title matching helpers ───────────────────────────────────────────────────
// Pick the career-page job whose title most overlaps the title we got from the
// ranked TopCV/VNW result. Token-overlap is good enough here — career pages
// typically have a handful of distinct roles, so a strict match is fine.
function _titleTokens(s: string): Set<string> {
    const norm = (s || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return new Set(norm.split(' ').filter((t) => t.length >= 3));
}

function pickBestTitleMatch(targetTitle: string, jobs: JobListing[]): JobListing | null {
    if (!jobs.length) return null;
    const target = _titleTokens(targetTitle);
    if (target.size === 0) return jobs[0];

    let best: { job: JobListing; score: number } | null = null;
    for (const job of jobs) {
        const jt = _titleTokens(job.title);
        let overlap = 0;
        for (const t of target) if (jt.has(t)) overlap++;
        if (overlap > 0 && (!best || overlap > best.score)) {
            best = { job, score: overlap };
        }
    }
    return best?.job ?? null;
}

// Mirror of backend /api/crawl-url ?keepLinks=true cleanup so the AI extractor
// receives compact "[LINK:url] text [/LINK]" markers instead of raw HTML noise.
// Used as a fallback when the user's extension hasn't been reloaded yet and
// doesn't yet send pre-cleaned textWithLinks.
function htmlToTextWithLinks(html: string): string {
    if (!html) return '';
    try {
        return html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(
                /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
                (_, href, inner) => `[LINK:${href}] ${inner.replace(/<[^>]+>/g, '').trim()} [/LINK]`,
            )
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 25000);
    } catch {
        return '';
    }
}

export default function StepInputUrl() {
    const {
        setStep, cvData, setJdData, setMatchResult,
        clearJdEntries, addJdEntry, updateJdEntry, setOptimizedCv, addJobRecord,
        setView, jobHistory, fullyAutoMode, setFullyAutoMode, setSelectedJdId,
        targetJobTitle, targetLocation, targetLevel, setSearchPivotNote,
        setDiscovery, candidates, candidatePool, removeCandidate,
        revealMoreCandidates, clearCandidates, wizardStage, setWizardStage,
    } = useAppStore();

    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const [phase, setPhase] = useState<Phase>('idle');
    const [phaseDetail, setPhaseDetail] = useState('');
    const [inferredTitle, setInferredTitle] = useState('');
    // Guard the auto-trigger useEffect against React Strict-Mode double-fires.
    const autoStartedRef = useRef(false);
    // Guards a stale background run (user restarted analysis) from touching
    // the new run's UI or navigating the user away mid-flow.
    const runRef = useRef(0);

    const isValidUrl = (u: string) => {
        try {
            const parsed = new URL(u.trim());
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch { return false; }
    };

    const getHostname = (u: string) => {
        try { return new URL(u).hostname; } catch { return u; }
    };

    // ─── Auto-find flow ("Find jobs from my CV"): backend serves jobs from a
    //     curated list of VN employers, but UI presents this as a general AI
    //     search. No phase label or detail string may name the source list. ───
    const handleFeaturedAnalyze = async (mode: 'featured' | 'ground' = 'featured') => {
        if (!cvData) { setError('Vui lòng tải CV lên trước.'); return; }

        const isFullAuto = useAppStore.getState().fullyAutoMode;

        setError('');
        setOptimizedCv(null);
        setInferredTitle('');
        setSearchPivotNote('');   // cleared; the featured path re-sets it post-search
        clearJdEntries();
        clearCandidates();
        const runId = ++runRef.current;

        try {
            // ── Phase 1: confirmed target role (from step 1 — no LLM round-trip). ──
            const targetTitle = (
                targetJobTitle
                || cvData.desired_job_title
                || cvData.employment?.current_title
                || ''
            ).trim();
            const cityKey = targetLocation;
            const cityName = cityLabel(cityKey);
            setPhase('analyzing_cv');
            setInferredTitle(targetTitle);
            setPhaseDetail(targetTitle
                ? `Đang tìm tin tuyển dụng phù hợp với "${targetTitle}"${cityName ? ` tại ${cityName}` : ''}...`
                : 'Đang tìm tin tuyển dụng phù hợp với CV của bạn...');

            // ── Phase 2 (presented as "searching"): pull aggregated jobs. ──
            setPhase('searching');
            setPhaseDetail(targetTitle
                ? `Đang quét tin tuyển dụng cho "${targetTitle}"...`
                : 'Đang quét tin tuyển dụng...');
            // Poll while the backend warms its cache (first run / cold start)
            // instead of blocking on one long request that times out.
            const onWaiting = (attempt: number) => {
                if (runRef.current !== runId) return;
                setPhaseDetail(
                    targetTitle
                        ? `Đang chuẩn bị tin tuyển dụng cho "${targetTitle}"… (${attempt})`
                        : `Đang chuẩn bị tin tuyển dụng… (${attempt})`,
                );
            };
            // A ranked opening, carrying the taxonomy role family so the
            // dead-job backfill can stay inside the candidate's role space.
            type FeaturedJob = {
                url: string; applyUrl: string; title: string; company: string;
                careerUrl: string; location: string; description: string;
                roleFamily?: string;
            };

            // City pairing: keep in-city matches; if none, keep the (still
            // relevance-ranked) list but flag it off-city so the editor labels it.
            const pairCity = (jobs: FeaturedJob[]): { pool: FeaturedJob[]; offCity: boolean } => {
                if (!cityKey) return { pool: jobs, offCity: false };
                const inCity = jobs.filter((j) => matchesCity(j.location, cityKey));
                if (inCity.length) return { pool: inCity, offCity: false };
                return { pool: jobs, offCity: true };
            };

            let orderedJobs: FeaturedJob[] = [];
            let offCity = false;

            if (mode === 'ground') {
                // 'ground' = grounded web search across the candidate's whole fit
                // (roles + adjacent + domains + strengths), inferred from the CV.
                // No curated pool to facet-rank, so we keep the strict title pair
                // + LLM tournament here.
                setPhase('analyzing_cv');
                setPhaseDetail('Đang đọc CV của bạn để hiểu mức độ phù hợp…');
                let roles = targetTitle ? [targetTitle] : [];
                let domains: string[] = [];
                let strengths: string[] = [];
                try {
                    const profile = await inferSearchProfile(cvData);
                    // Lead with the user's confirmed title, then adjacent roles.
                    roles = Array.from(new Set([...roles, ...(profile.target_roles || [])]
                        .map((s) => s.trim()).filter(Boolean)));
                    domains = profile.domains || [];
                    strengths = profile.strengths || [];
                } catch (e) {
                    console.warn('[ground-search] profile inference failed, using title only:', e);
                }
                if (roles.length === 0) {
                    throw new Error('Tìm trên web cần một vai trò mục tiêu — hãy thiết lập ở bước tải CV.');
                }
                setInferredTitle(roles[0]);
                setPhase('searching');
                setPhaseDetail(`Đang tìm: ${roles.slice(0, 3).join(', ')}${domains.length ? ` · ${domains.slice(0, 2).join(', ')}` : ''}`);
                console.log('[ground-search] profile:', { roles, domains, strengths, city: cityName || '(any)' });
                const discovered = await discoverJobsWarm({ roles, domains, strengths }, cityName, onWaiting);

                const allJobs: FeaturedJob[] = [];
                for (const c of discovered.companies) {
                    for (const j of c.jobs) {
                        if (!j.url || !j.title) continue;
                        allJobs.push({
                            url: j.url, applyUrl: j.apply_url || j.url, title: j.title,
                            company: c.name, careerUrl: c.career_url,
                            location: j.location || '', description: j.description || '',
                        });
                    }
                }
                if (allJobs.length === 0) {
                    const why = discovered.warming
                        ? 'vẫn đang chuẩn bị (hết thời gian chờ) — hãy thử lại sau giây lát'
                        : discovered.companies.length === 0
                            ? `tìm trên web không thấy công ty nào cho "${targetTitle}"`
                            : `tìm thấy ${discovered.companies.length} công ty nhưng hiện chưa có tin tuyển dụng nào`;
                    throw new Error(`Không có tin tuyển dụng phù hợp: ${why}.`);
                }

                // Strict title pairing → city → LLM tournament.
                const titleScored = allJobs
                    .map((job) => ({ job, score: titleMatchScore(targetTitle, job.title) }))
                    .filter((x) => x.score > 0)
                    .map((x) => x.job);
                const paired = pairCity(titleScored.length ? titleScored : allJobs);
                offCity = paired.offCity;

                setPhase('ranking');
                setPhaseDetail(`Đang xếp hạng ${paired.pool.length} việc theo độ phù hợp với CV của bạn...`);
                let ranked: { url: string; title?: string; fit_score?: number }[] = [];
                try {
                    ranked = await rankJobsTournament(
                        cvData,
                        paired.pool.map((j) => ({ url: j.url, title: j.title, company: j.company })),
                    );
                } catch (rankErr) {
                    console.log('[ground-search] ranking failed, using original order:', rankErr);
                }
                const lookup = new Map(paired.pool.map((j) => [j.url, j]));
                orderedJobs = ranked.length
                    ? ranked.map((r) => lookup.get(r.url)).filter((j): j is FeaturedJob => !!j)
                    : paired.pool;
            } else {
                // ── 'featured' = curated pool ranked by the FACET ENGINE
                //    (role-family adjacency × industry × location, taxonomy.py).
                //    This replaces the old token-overlap title filter + LLM
                //    tournament, so only jobs inside the candidate's role space
                //    (Product + adjacent families) ever surface — no stray
                //    marketing/intern roles, and the pool stays relevance-ordered. ──
                setPhase('searching');
                setPhaseDetail(targetTitle
                    ? `Đang tìm tin tuyển dụng phù hợp với "${targetTitle}"${cityName ? ` tại ${cityName}` : ''}...`
                    : 'Đang tìm tin tuyển dụng phù hợp với CV của bạn...');
                const search = await searchFeaturedJobsWarm(
                    {
                        target_roles: targetTitle ? [targetTitle] : [],
                        // Proven role (CV) as the fit CONSTRAINT — distinct from
                        // target_roles (direction). Lets the engine shade jobs by
                        // transferability when the target differs from the CV.
                        cv_roles: [cvData.employment?.current_title].filter(Boolean) as string[],
                        // User's seniority pick overrides the CV-inferred level;
                        // empty → backend infers from the CV level.
                        level: targetLevel || cvData.employment?.current_level || '',
                        // Pull a deep ranked pool so the role-adjacent backfill has
                        // plenty of same-family spares when postings turn out dead.
                        limit: 200,
                        rerank: true,
                    },
                    onWaiting,
                );
                const results = search.results || [];

                // ── Debug: what the facet engine ranked ──
                console.groupCollapsed(`[facet-search] role=${targetTitle || '(none)'} → ${results.length}/${search.total_matched ?? results.length} ranked${search.warming ? ' (WARMING/timed-out)' : ''}`);
                console.log('profile:', search.profile, 'reranked:', search.reranked);
                console.table(results.slice(0, 20).map((j) => ({
                    score: j._facet?.score, family: j._facet?.role_family,
                    company: j.company, title: j.title,
                })));
                console.groupEnd();

                // ── Honest pivot hint ──
                // The backend returns both the target role family (direction) and
                // the CV's proven family (constraint). Disjoint → a career pivot:
                // tell the user the jobs are stretch, ranked by CV fit. Generic
                // (family comparison), no per-role-pair logic.
                const prof = search.profile as
                    { role_families?: string[]; cv_families?: string[] } | undefined;
                const tFam = prof?.role_families?.[0];
                const cvFams = prof?.cv_families ?? [];
                const pivot = !!tFam && cvFams.length > 0 && !cvFams.includes(tFam);
                setSearchPivotNote(pivot
                    ? `Đây là vai trò khác hồ sơ của bạn — chúng tôi tìm theo vai trò bạn muốn, rồi xếp hạng theo độ phù hợp với CV. Một số job có thể là cơ hội "với tới".`
                    : '');

                if (results.length === 0) {
                    const why = search.warming
                        ? 'vẫn đang chuẩn bị (hết thời gian chờ) — hãy thử lại sau giây lát'
                        : 'hiện chưa có tin tuyển dụng nào khớp với vai trò của bạn';
                    throw new Error(`Không có tin tuyển dụng phù hợp: ${why}.`);
                }

                const ranked: FeaturedJob[] = results.map((j) => ({
                    url: j.url,
                    applyUrl: j.apply_url || j.url,
                    title: j.title,
                    company: j.company || '',
                    careerUrl: j.career_url || '',
                    location: j.location || '',
                    // JD text the ATS API already returned (scores without re-crawl).
                    description: j.description || '',
                    roleFamily: j._facet?.role_family,
                }));
                // Already relevance-ranked by the facet engine — just pair the city.
                const paired = pairCity(ranked);
                offCity = paired.offCity;
                orderedJobs = paired.pool;
            }

            // ── Non-auto: hand the ranked jobs to the results page for curation
            //    (remove / find more) BEFORE we spend credits scoring + tailoring.
            //    Full-auto skips this and runs the pipeline straight through. ──
            if (!isFullAuto) {
                const toCandidate = (job: FeaturedJob): CandidateJob => {
                    const off = !!cityKey && !!job.location && !matchesCity(job.location, cityKey);
                    return {
                        id: `cand-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        url: job.url,
                        applyUrl: job.applyUrl,
                        title: job.title,
                        company: job.company,
                        careerUrl: job.careerUrl,
                        location: job.location || '',
                        description: job.description || '',
                        roleFamily: job.roleFamily,
                        locationNote: off ? `Khác ${cityName}` : undefined,
                    };
                };
                const allCands = orderedJobs.map(toCandidate);
                // Hide jobs the user already has — saved/applied (jobHistory) or
                // currently queued (jdEntries) — so a repeat search surfaces new
                // postings instead of the same ones.
                const { jobHistory, jdEntries } = useAppStore.getState();
                const { kept: cands, removed } = filterUnseenCandidates(allCands, jobHistory, jdEntries);
                if (removed > 0) {
                    console.info(`[discovery] ẩn ${removed} job đã có khỏi kết quả tìm`);
                }
                const INITIAL_SHOWN = 6;
                if (runRef.current === runId) {
                    setPhase('idle');
                    setPhaseDetail('');
                    setDiscovery(cands.slice(0, INITIAL_SHOWN), cands.slice(INITIAL_SHOWN));
                }
                return;
            }

            // ── Select the jobs to process; keep the rest as a role-adjacent
            //    backfill (see below). ──
            const MAX_JOBS = 5;
            const topJobs = orderedJobs.slice(0, MAX_JOBS);
            const backfillJobs = orderedJobs.slice(MAX_JOBS);
            setPhaseDetail(offCity
                ? `Không có "${targetTitle}" tại ${cityName} — đang hiển thị vai trò này ở các thành phố khác...`
                : `Đã chọn ${topJobs.length} việc phù hợp nhất với CV`);

            // Build a JD entry from a featured job. Off-city listings get a label
            // so the editor can flag them — an empty location is "unknown", not
            // "elsewhere", so only a known, non-matching location is flagged.
            const makeEntry = (job: FeaturedJob): JDEntry => {
                const off = !!cityKey && !!job.location && !matchesCity(job.location, cityKey);
                return {
                    id: `jd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    source: job.url,
                    applyUrl: job.applyUrl,
                    label: job.title,
                    status: 'crawling',
                    jobTitle: job.title,
                    company: job.company,
                    location: job.location || undefined,
                    locationNote: off ? `Khác ${cityName}` : undefined,
                    prefetchedJd: job.description || undefined,
                    roleFamily: job.roleFamily,
                };
            };

            // Pre-populate the top JD entries so the user sees the queue immediately.
            const seenUrls = new Set<string>();
            for (const job of topJobs) {
                seenUrls.add(job.url);
                addJdEntry(makeEntry(job));
            }

            // ── Role-adjacent backfill (#2) ──
            // Bucket the spare pool by role family, preserving rank order within
            // each. When a posting turns out dead (404 / SPA shell / no JD), refill
            // from the SAME family first, then walk the other families in the
            // pool's own relevance order — so a dead Product role is replaced by
            // another Product role, never by whatever happened to rank next.
            // (Ground-mode jobs have no roleFamily → one shared bucket = the old
            // position order, so that path is unaffected.)
            const UNKNOWN_FAMILY = '_';
            const familyBuckets = new Map<string, FeaturedJob[]>();
            const familyOrder: string[] = [];
            for (const job of backfillJobs) {
                const fam = job.roleFamily || UNKNOWN_FAMILY;
                if (!familyBuckets.has(fam)) { familyBuckets.set(fam, []); familyOrder.push(fam); }
                familyBuckets.get(fam)!.push(job);
            }
            const pullFromFamily = (fam: string): JDEntry | null => {
                const bucket = familyBuckets.get(fam);
                while (bucket && bucket.length) {
                    const job = bucket.shift()!;
                    if (seenUrls.has(job.url)) continue;
                    seenUrls.add(job.url);
                    const entry = makeEntry(job);
                    addJdEntry(entry);
                    return entry;
                }
                return null;
            };
            const nextBackfill = (deadFamily?: string): JDEntry | null => {
                // Same family as the job that just died, first.
                if (deadFamily) {
                    const hit = pullFromFamily(deadFamily);
                    if (hit) return hit;
                }
                // Otherwise walk families in the pool's relevance order.
                for (const fam of familyOrder) {
                    const hit = pullFromFamily(fam);
                    if (hit) return hit;
                }
                return null;
            };

            // ── Phase 4-6: crawl JD + extract + score + tailor CV — all jobs in
            //    PARALLEL. Outside full-auto, the first finished job opens the
            //    report immediately while the rest keep streaming in. ──
            const { navigated } = await runJobPipeline({
                queueLen: topJobs.length,
                runId,
                fallbackTitle: targetTitle,
                navigateOnFirstDone: !isFullAuto,
                targetScored: topJobs.length,
                nextBackfill,
            });

            // ── Full-auto extension: CVs were already tailored inside the
            //    parallel pipeline — jump to the editor (step 3) where the
            //    batch-apply auto-trigger takes over. ──
            if (isFullAuto) {
                const done = useAppStore.getState().jdEntries.filter(
                    (e) => e.status === 'done' && e.jdData && e.matchResult,
                );
                if (done.length === 0) {
                    throw new Error('Không có việc nào để chấm điểm và tối ưu.');
                }
                const optimizedCount = done.filter((e) => e.optimizedCv).length;
                setPhaseDetail(`Đã tối ưu ${optimizedCount}/${done.length} CV. Đang chuyển sang extension...`);
                if (runRef.current === runId) {
                    setPhase('idle');
                    setStep(3);
                }
                return;
            }

            if (runRef.current === runId) {
                setPhase('idle');
                // Even if no job succeeded, advance to the editor — its empty
                // state explains there were no optimized CVs and offers a way back.
                if (!navigated) setStep(3);
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Phân tích thất bại';
            setError(msg);
            setPhase('idle');
            setPhaseDetail('');
            // Exit auto mode on failure so the user isn't stuck looping.
            if (useAppStore.getState().fullyAutoMode) setFullyAutoMode(false);
        }
    };

    // Shared per-entry pipeline: (resolve career page →) crawl → extract JD →
    // score → tailor CV. Entries run in PARALLEL through a small worker pool;
    // when `navigateOnFirstDone` is set, the first entry that finishes scoring
    // opens the report page immediately so the user can start editing while
    // the remaining jobs keep processing in the background.
    const runJobPipeline = async (opts: {
        queueLen: number;
        runId: number;
        // Title to fall back to when neither the page nor the entry has one.
        fallbackTitle?: string;
        // URL flow: resolve aggregator posting → company career page first.
        resolveCareerFirst?: boolean;
        // Tailor the CV per scored job right inside the pipeline (default on).
        autoOptimize?: boolean;
        // Jump to the report as soon as one job is scored (default on).
        navigateOnFirstDone?: boolean;
        // Stop pulling backfill once this many jobs have been SCORED.
        // Defaults to the number of pre-populated entries.
        targetScored?: number;
        // Pull a spare when a job dies; the dead job's role family is passed so
        // the backfill can prefer a same-family replacement. Returns null when
        // the backfill pool is exhausted. Omit to disable backfill (URL flow).
        nextBackfill?: (deadFamily?: string) => JDEntry | null;
    }): Promise<{ navigated: boolean }> => {
        const {
            queueLen, runId, fallbackTitle = '',
            resolveCareerFirst = false, autoOptimize = true, navigateOnFirstDone = true,
            nextBackfill,
        } = opts;

        setPhase('crawling_job');
        setPhaseDetail(`Đang xử lý ${queueLen} việc song song — sẽ mở kết quả ngay khi việc đầu tiên sẵn sàng...`);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const buildJdFromLd = (ld: any): string => [
            ld.title && `Job Title: ${ld.title}`,
            ld.hiringOrganization?.name && `Company: ${ld.hiringOrganization.name}`,
            ld.jobLocation?.address?.addressLocality && `Location: ${ld.jobLocation.address.addressLocality}`,
            ld.description && `\nJob Description:\n${ld.description}`,
            ld.qualifications && `\nQualifications:\n${ld.qualifications}`,
            ld.jobBenefits && `\nBenefits:\n${ld.jobBenefits}`,
        ].filter(Boolean).join('\n');

        const entries = useAppStore.getState().jdEntries;
        // Company dedup across concurrent workers — first resolved wins.
        const seenCompanies = new Set<string>();
        let doneCount = 0;
        let scoredCount = 0;
        // How many SCORED jobs we aim for; backfill tops up toward this when
        // jobs die. Defaults to the count of pre-populated entries.
        const targetScored = opts.targetScored ?? useAppStore.getState().jdEntries.length;
        let navigated = false;
        let legacySaved = false;

        const processEntry = async (entry: JDEntry) => {
            const entryId = entry.id;
            if (entry.status === 'error') return;
            let jobUrl = entry.source;
            let entryTitle = entry.jobTitle || '';
            let entryCompany = entry.company || '';

            try {
                // ── Optional: resolve posting → company → career-page job URL.
                //    We use the aggregator posting only as a lead so we never
                //    crawl/score against the aggregator itself. ──
                if (resolveCareerFirst) {
                    const finder = await findCareer({ input_url: jobUrl });
                    const company = (finder.resolution.company_name || '').trim();
                    const companyKey = company.toLowerCase();

                    if (companyKey) {
                        if (seenCompanies.has(companyKey)) {
                            updateJdEntry(entryId, {
                                status: 'error',
                                error: `Công ty trùng lặp: ${company}`,
                            });
                            return;
                        }
                        seenCompanies.add(companyKey);
                    }
                    if (!finder.chosen_career) {
                        updateJdEntry(entryId, {
                            status: 'error',
                            error: company
                                ? `${company} — không tìm thấy trang tuyển dụng`
                                : 'Không xác định được công ty từ tin tuyển dụng',
                            company: company || undefined,
                        });
                        return;
                    }
                    if (!finder.jobs.length) {
                        updateJdEntry(entryId, {
                            status: 'error',
                            error: `${company || 'Công ty'} — không có tin tuyển dụng trên trang tuyển dụng`,
                            company: company || undefined,
                        });
                        return;
                    }

                    const targetTitle = entry.jobTitle || fallbackTitle;
                    const bestMatch = pickBestTitleMatch(targetTitle, finder.jobs);
                    if (!bestMatch) {
                        updateJdEntry(entryId, {
                            status: 'error',
                            error: `${company} — không có vai trò phù hợp trên trang tuyển dụng`,
                            company: company || undefined,
                        });
                        return;
                    }

                    // Rewrite the entry to point at the canonical career-page job.
                    jobUrl = bestMatch.url;
                    entryTitle = bestMatch.title || entryTitle;
                    entryCompany = company || entryCompany;
                    updateJdEntry(entryId, {
                        source: bestMatch.url,
                        label: bestMatch.title || entry.label,
                        jobTitle: entryTitle || undefined,
                        company: entryCompany || undefined,
                        status: 'crawling',
                    });
                }

                // ── Crawl: HTTP → Playwright → extension fallback ──
                updateJdEntry(entryId, { status: 'crawling' });
                let jobPageText = '';
                let jobTitle = '';
                let company = '';

                // Skip the crawl entirely when the search layer already fetched
                // the JD from an ATS API — the fix for SPA / IP-blocked boards
                // whose page never renders but whose API returned the full text.
                if ((entry.prefetchedJd?.length ?? 0) >= 200) {
                    jobPageText = entry.prefetchedJd as string;
                }

                if (jobPageText.length < 200) try {
                    const jobPage = await crawlUrl(jobUrl);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const ld = jobPage.jsonLd as any;
                    if (ld?.description) {
                        jobPageText = buildJdFromLd(ld);
                        jobTitle = ld.title || '';
                        company = ld.hiringOrganization?.name || '';
                    } else if ((jobPage.text?.length ?? 0) >= 500) {
                        jobPageText = jobPage.text;
                    }
                } catch (httpErr) {
                    console.log('[runJobPipeline] HTTP failed:', httpErr);
                }

                if (jobPageText.length < 200) {
                    try {
                        const pw = await fetchPage(jobUrl);
                        if (pw.success) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const ld = pw.jsonLd as any;
                            if (ld?.description) {
                                jobPageText = buildJdFromLd(ld);
                                jobTitle = ld.title || '';
                                company = ld.hiringOrganization?.name || '';
                            } else if (pw.text.length >= 200) {
                                jobPageText = pw.text;
                            }
                        }
                    } catch (pwErr) {
                        console.log('[runJobPipeline] Playwright failed:', pwErr);
                    }

                    if (jobPageText.length < 200 && isExtensionAvailable()) {
                        try {
                            const ext = await extensionCrawl(jobUrl);
                            if (ext.success) {
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                const ld = ext.jsonLd as any;
                                if (ld?.description) {
                                    jobPageText = buildJdFromLd(ld);
                                    jobTitle = ld.title || '';
                                    company = ld.hiringOrganization?.name || '';
                                } else if (ext.text.length >= 200) {
                                    jobPageText = ext.text;
                                }
                            }
                        } catch (extErr) {
                            console.log('[runJobPipeline] Extension failed:', extErr);
                        }
                    }
                }

                if (jobPageText.length < 100) {
                    updateJdEntry(entryId, { status: 'error', error: 'Không tải được trang tuyển dụng' });
                    reportBrokenLink({ url: jobUrl, company: entryCompany, title: entryTitle, reason: 'could_not_load' });
                    return;
                }

                // ── Extract JD ──
                updateJdEntry(entryId, { status: 'parsing' });
                let jdData = await withRetry(() => extractJdStructured(jobPageText));
                if (Array.isArray(jdData)) jdData = jdData[0];
                if (!jdData || (!jdData.must_have?.length && !jdData.responsibilities?.length)) {
                    updateJdEntry(entryId, { status: 'error', error: 'Không tìm thấy mô tả công việc trên trang' });
                    reportBrokenLink({ url: jobUrl, company: entryCompany, title: entryTitle, reason: 'no_jd_on_page' });
                    return;
                }

                // ── Experience-gap rule ──
                // Drop jobs that out-reach the candidate by more than 1 year
                // (e.g. JD wants 5y, candidate has 2y). Done before scoring so we
                // don't spend Gemini calls on jobs the user can't realistically land.
                const candidateYears = cvData!.employment?.years_of_experience ?? 0;
                const gap = experienceGapExceeds(jdData, candidateYears);
                if (gap.exceeds) {
                    updateJdEntry(entryId, {
                        status: 'error',
                        jdData,
                        error: `Cần ~${gap.required} năm kinh nghiệm, bạn có ${candidateYears} — chênh quá 1 năm`,
                    });
                    return;
                }

                // ── Score ──
                updateJdEntry(entryId, { status: 'scoring' });
                let matchResult = await withRetry(() => scoreFit(cvData!, jdData));
                if (Array.isArray(matchResult)) matchResult = matchResult[0];
                if (!matchResult?.overall_score) {
                    updateJdEntry(entryId, { status: 'error', error: 'Chấm điểm thất bại' });
                    return;
                }

                const resolvedTitle = jobTitle || entryTitle || fallbackTitle;
                const resolvedCompany = company || entryCompany || '';

                updateJdEntry(entryId, {
                    status: 'done',
                    jdData,
                    matchResult,
                    jobTitle: resolvedTitle,
                    company: resolvedCompany,
                });
                scoredCount++;

                // Also save first successful to legacy fields for backward compat
                if (!legacySaved || !useAppStore.getState().matchResult) {
                    legacySaved = true;
                    setJdData(jdData);
                    setMatchResult(matchResult);
                }

                addJobRecord({
                    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    jobTitle: resolvedTitle,
                    company: resolvedCompany,
                    jobUrl,
                    siteName: getHostname(jobUrl),
                    overallScore: matchResult.overall_score,
                    timestamp: Date.now(),
                    jdData,
                    matchResult,
                    status: 'saved',
                });

                // ── Open the editor on first SCORED job only when we're NOT
                //    auto-optimizing. With auto-optimize on, we wait until the
                //    first CV is actually optimized (below) so the user lands on
                //    a ready editor instead of an empty "optimizing…" screen. ──
                if (navigateOnFirstDone && !navigated && !autoOptimize && runRef.current === runId) {
                    navigated = true;
                    setSelectedJdId(entryId);
                    setPhase('idle');
                    setStep(3);
                }

                // ── Tailor the CV in the background so the editor is ready
                //    without a manual "Optimize" click ──
                if (autoOptimize) {
                    updateJdEntry(entryId, { optimizing: true });
                    try {
                        const data = await withRetry(() => optimizeCvVariants(cvData!, jdData, matchResult));
                        const variant = data.variants[0];
                        if (variant?.cv) {
                            // Eager PDF render + extension sync, same as a manual
                            // Optimize click — batch apply gets the file for free.
                            const state = useAppStore.getState();
                            const pdfCache = await buildCvPdfCache(variant.cv, {
                                jobTitle: resolvedTitle,
                                templateId: state.jdEntries.find((e) => e.id === entryId)?.selectedTemplateId,
                                avatarBase64: state.userAvatarBase64,
                            });
                            updateJdEntry(entryId, {
                                optimizing: false,
                                optimizedCv: variant.cv,
                                optimizedCvImprovements: variant.improvements,
                                ...pdfCache,
                            });
                            // First CV optimized → NOW open the editor on it.
                            if (navigateOnFirstDone && !navigated && runRef.current === runId) {
                                navigated = true;
                                setSelectedJdId(entryId);
                                setPhase('idle');
                                setStep(3);
                            }
                        } else {
                            updateJdEntry(entryId, { optimizing: false });
                        }
                    } catch (optErr) {
                        console.log('[runJobPipeline] Auto-optimize failed (manual optimize still possible):', optErr);
                        updateJdEntry(entryId, { optimizing: false });
                    }
                }
            } catch (err) {
                updateJdEntry(entryId, {
                    status: 'error',
                    error: err instanceof Error ? err.message : 'Lỗi không xác định',
                });
            } finally {
                doneCount++;
                if (!navigated && runRef.current === runId) {
                    setPhaseDetail(`Đã chấm ${scoredCount}/${targetScored} — đã xử lý ${doneCount} việc...`);
                }
            }
        };

        // Worker pool: up to JOB_CONCURRENCY entries in flight at once. The queue
        // seeds with the pre-populated top entries; when one dies and we're still
        // short of `targetScored`, the next ranked spare is pulled in to replace
        // it — so a few dead/expired postings no longer strand the whole run.
        const queue: JDEntry[] = [...entries];
        const takeNext = (deadFamily?: string): JDEntry | null => {
            if (queue.length) return queue.shift()!;
            if (scoredCount >= targetScored) return null;
            return nextBackfill ? nextBackfill(deadFamily) : null;
        };
        await Promise.all(
            Array.from({ length: Math.min(JOB_CONCURRENCY, entries.length) }, async () => {
                let next = takeNext();
                while (next) {
                    const processed = next;
                    await processEntry(processed);
                    // If this job died, ask the backfill for a same-family spare
                    // so the replacement stays inside the candidate's role space.
                    const died = useAppStore.getState().jdEntries
                        .find((e) => e.id === processed.id)?.status === 'error';
                    next = takeNext(died ? processed.roleFamily : undefined);
                }
            })
        );

        return { navigated };
    };

    // Build a JD entry from a curated candidate so the pipeline can process it.
    const candidateToEntry = (c: CandidateJob): JDEntry => ({
        id: `jd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        source: c.url,
        applyUrl: c.applyUrl,
        label: c.title,
        status: 'crawling',
        jobTitle: c.title,
        company: c.company,
        location: c.location || undefined,
        locationNote: c.locationNote,
        prefetchedJd: c.description || undefined,
        roleFamily: c.roleFamily,
    });

    // Results-page "Optimize" action: crawl + score + tailor exactly the jobs the
    // user kept (no backfill — they curated this list), then open the editor.
    const handleOptimizeSelected = async () => {
        if (!cvData) { setError('Vui lòng tải CV lên trước.'); return; }
        const picked = useAppStore.getState().candidates;
        if (!picked.length) { setError('Hãy giữ lại ít nhất một việc để tối ưu.'); return; }

        setError('');
        setOptimizedCv(null);
        clearJdEntries();
        const runId = ++runRef.current;
        try {
            for (const c of picked) addJdEntry(candidateToEntry(c));
            const { navigated } = await runJobPipeline({
                queueLen: picked.length,
                runId,
                fallbackTitle: (targetJobTitle || cvData.desired_job_title || '').trim(),
                navigateOnFirstDone: true,
                targetScored: picked.length,
                // No nextBackfill: process only the user's curated selection.
            });
            if (runRef.current === runId) {
                setPhase('idle');
                if (!navigated) setStep(3);
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Tối ưu thất bại';
            setError(msg);
            setPhase('idle');
            setPhaseDetail('');
        }
    };

    const handleSmartAnalyze = async (overrideUrl?: string) => {
        const trimmed = (overrideUrl ?? url).trim();
        // Auto mode = the URL is internal (user clicked "Find jobs from my CV").
        // Suppress the aggregator hostname in all user-facing copy so we never
        // leak which site we're scraping.
        const isAuto = !!overrideUrl;
        if (!trimmed) { setError('Vui lòng nhập URL trang tuyển dụng.'); return; }
        if (!isValidUrl(trimmed)) { setError('Vui lòng nhập URL hợp lệ (http:// hoặc https://)'); return; }
        if (!cvData) { setError('Vui lòng tải CV lên trước.'); return; }

        setError('');
        setOptimizedCv(null);
        setInferredTitle('');
        setSearchPivotNote('');   // cleared; the featured path re-sets it post-search
        clearJdEntries();
        const runId = ++runRef.current;

        try {
            // ─── Phase 1: build the search URL from the confirmed target role
            //     (set on the upload step) — pure template lookup, no LLM. ───
            const targetTitle = (
                targetJobTitle || cvData.desired_job_title || cvData.employment?.current_title || ''
            ).trim();
            if (!targetTitle) throw new Error('Hãy thêm vai trò mục tiêu ở bước tải CV trước.');
            setPhase('analyzing_cv');
            // Known site → instant template URL. Unknown site → fall back to the
            // LLM, anchored to the confirmed role so it can't pick a different one.
            const built = buildSearchUrl(trimmed, targetTitle, targetLocation);
            let searchResult: { inferred_job_title: string; search_keyword: string; search_url: string } = built;
            if (!built.known) {
                setPhaseDetail('Đang chuẩn bị tìm kiếm cho trang này...');
                let r = await smartSearch(cvData, trimmed, targetTitle);
                if (Array.isArray(r)) r = r[0];
                if (!r?.search_url) throw new Error('AI không tạo được URL tìm kiếm cho trang này.');
                searchResult = {
                    inferred_job_title: r.inferred_job_title || targetTitle,
                    search_keyword: r.search_keyword || '',
                    search_url: r.search_url,
                };
            }
            setInferredTitle(searchResult.inferred_job_title);
            setPhaseDetail(`Đang tìm: "${searchResult.inferred_job_title}"`);

            // ─── Phase 2: Crawl the search results page ───
            setPhase('searching');
            const hostname = getHostname(trimmed);
            setPhaseDetail(isAuto ? 'Đang tìm các công ty phù hợp...' : `Đang tìm trên ${hostname}...`);

            let searchPage: { text: string; textWithLinks?: string } = { text: '', textWithLinks: '' };
            let searchBlocked = false;
            try {
                searchPage = await crawlUrl(searchResult.search_url, true);
            } catch (crawlErr) {
                console.log('[StepInputUrl] HTTP crawl failed, trying Playwright...', crawlErr);
                // Playwright fallback for search pages (sites like VietnamWorks block direct HTTP)
                try {
                    const pw = await fetchPage(searchResult.search_url);
                    if (pw.success && pw.text.length >= 200) {
                        searchPage = { text: pw.text, textWithLinks: pw.text };
                    } else if (pw.blocked) {
                        searchBlocked = true;
                    }
                } catch (pwErr) {
                    console.log('[StepInputUrl] Playwright fallback also failed:', pwErr);
                }
            }

            // ── Extension fallback: open in user's browser (Cloudflare bypass) ──
            const noContent = !searchPage.text && !searchPage.textWithLinks;
            if ((searchBlocked || noContent) && isExtensionAvailable()) {
                setPhaseDetail(`Trang có bảo vệ chống bot → đang mở qua extension trình duyệt của bạn...`);
                console.log('[StepInputUrl] Trying extension crawl for search page');
                const ext = await extensionCrawl(searchResult.search_url);
                if (ext.success && ext.text.length >= 200) {
                    // Prefer the extension's pre-cleaned textWithLinks. If the user
                    // hasn't reloaded the extension yet, fall back to converting
                    // ext.html ourselves so the AI doesn't get raw HTML noise.
                    const fallbackBuilt = !ext.textWithLinks && !!ext.html;
                    const linkText = ext.textWithLinks || htmlToTextWithLinks(ext.html || '') || ext.text;
                    searchPage = { text: ext.text, textWithLinks: linkText };
                    // Detailed payload stats — we ship `linkText` to the AI
                    // extractor next, so we want to see exactly what it looks
                    // like before blaming the AI for missing job URLs.
                    const linkMarkerCount = (linkText.match(/\[LINK:/g) || []).length;
                    console.log('[StepInputUrl] Extension crawl OK', {
                        searchUrl: searchResult.search_url,
                        textLen: ext.text.length,
                        extTextWithLinksLen: ext.textWithLinks?.length || 0,
                        htmlLen: ext.html?.length || 0,
                        finalLinkTextLen: linkText.length,
                        linkMarkerCount,
                        usedFallbackBuilder: fallbackBuilt,
                        linkTextSample: linkText.slice(0, 500),
                    });
                } else {
                    console.log('[StepInputUrl] Extension crawl failed:', ext.error);
                }
            }

            // ─── Phase 3: Extract job links ───
            setPhase('extracting_links');
            setPhaseDetail('AI đang tìm các tin tuyển dụng...');

            // Guard: don't call AI with empty text
            if (!searchPage.text && !searchPage.textWithLinks) {
                const tail = isExtensionAvailable()
                    ? 'Ngay cả cách vượt qua bằng extension cũng thất bại — hãy thử lại sau hoặc cài extension.'
                    : 'Hãy cài extension Latosa cho Chrome để vượt qua bảo vệ chống bot.';
                throw new Error(
                    isAuto
                        ? `Không tải được các việc phù hợp. ${tail}`
                        : `Không tải được kết quả tìm kiếm từ ${hostname}. ${tail}`,
                );
            }

            const aiInput = searchPage.textWithLinks || searchPage.text;
            const aiInputMarkers = (aiInput.match(/\[LINK:/g) || []).length;
            console.log('[StepInputUrl] Calling extractJobLinks', {
                inputLen: aiInput.length,
                linkMarkerCount: aiInputMarkers,
                hasLinkMarkers: aiInputMarkers > 0,
            });
            const linksResult = await extractJobLinks(aiInput, trimmed);
            console.log('[StepInputUrl] extractJobLinks response', {
                found: linksResult.found,
                totalFound: linksResult.total_found,
                jobsCount: Array.isArray(linksResult.jobs) ? linksResult.jobs.length : 0,
                firstJob: Array.isArray(linksResult.jobs) ? linksResult.jobs[0] : null,
            });
            const candidates: { url: string; title?: string }[] =
                Array.isArray(linksResult.jobs) && linksResult.jobs.length
                    ? linksResult.jobs
                    : (linksResult.job_urls || []).map((u: string) => ({ url: u, title: '' }));
            if (!linksResult.found || candidates.length === 0) {
                throw new Error(
                    isAuto
                        ? 'Không tìm thấy việc phù hợp. Hãy thử tải CV khác hoặc quay lại sau.'
                        : `Không tìm thấy tin tuyển dụng trên ${hostname}. Hãy thử trang khác.`,
                );
            }

            // ─── Phase 3.5: Rank candidates by CV fit BEFORE crawling ───
            // The site lists jobs by its own relevance; this re-orders them by
            // fit to THIS candidate's CV so we crawl the most promising first.
            setPhase('ranking');
            setPhaseDetail(`Đang xếp hạng ${candidates.length} việc theo độ phù hợp với CV của bạn...`);

            const MAX_JOBS = 5;
            let ranked: { url: string; title?: string; fit_score?: number; reason?: string }[] = [];
            try {
                ranked = await rankJobsTournament(cvData, candidates);
            } catch (rankErr) {
                console.log('[StepInputUrl] Job ranking failed, using site order:', rankErr);
            }
            // Fall back to the page's original order if ranking returned nothing.
            const ordered = ranked.length ? ranked : candidates;
            const topJobs = ordered.slice(0, MAX_JOBS);
            const jobUrls: string[] = topJobs.map((j) => j.url);
            setPhaseDetail(
                ranked.length
                    ? `Tìm thấy ${candidates.length} việc → đang xử lý ${jobUrls.length} việc phù hợp nhất với CV`
                    : `Tìm thấy ${candidates.length} việc → đang xử lý ${jobUrls.length} việc đầu`,
            );

            // Create placeholder entries — pre-filled with the ranked title so
            // the user sees real job names (and fit order) before crawling resolves.
            // `source` starts as the TopCV/VNW URL; the resolving phase below
            // rewrites it to the matching job URL on the company's own career
            // page so we never crawl/score against the aggregator.
            for (const job of topJobs) {
                addJdEntry({
                    id: `jd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    source: job.url,
                    label: job.title || getHostname(job.url),
                    status: 'crawling',
                    jobTitle: job.title || undefined,
                });
            }

            // ─── Phase 3.6 + 4-6: resolve career page + crawl + extract + score
            //     + tailor CV — all PARALLEL inside the shared pipeline. The
            //     first scored job opens the report immediately while the rest
            //     keep streaming in. ───
            const { navigated } = await runJobPipeline({
                queueLen: jobUrls.length,
                runId,
                fallbackTitle: searchResult.inferred_job_title,
                resolveCareerFirst: true,
            });

            if (runRef.current === runId) {
                setPhase('idle');
                // Even if no job succeeded, advance to the editor — its empty
                // state explains there were no optimized CVs and offers a way back.
                if (!navigated) setStep(3);
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Phân tích thất bại';
            setError(msg);
            setPhase('idle');
            setPhaseDetail('');
        }
    };

    const isProcessing = phase !== 'idle';
    const currentPhaseIdx = PHASE_ORDER.indexOf(phase as Exclude<Phase, 'idle'>);

    // Fully-auto flow: kick off the featured pipeline as soon as we land
    // on this step with a CV in hand. The pipeline itself jumps to step 4
    // on success (or clears fullyAutoMode on failure), so this effect only
    // ever fires once per session.
    useEffect(() => {
        if (!fullyAutoMode || !cvData || phase !== 'idle' || autoStartedRef.current) return;
        autoStartedRef.current = true;
        handleFeaturedAnalyze();
        // handleFeaturedAnalyze depends on store getters / setters that are stable;
        // we explicitly do not want this re-running on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fullyAutoMode, cvData]);

    return (
        <div className="animate-fade-in" style={{ maxWidth: 660, margin: '0 auto', padding: '40px 20px' }}>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 700, marginBottom: 8 }}>
                <MagicWand size={22} weight="duotone" style={{ display: 'inline', marginRight: 8, color: 'var(--accent-purple)' }} />
                {wizardStage === 'results' ? 'Việc phù hợp với bạn' : 'Tìm việc thông minh'}
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32, fontSize: '0.95rem', lineHeight: 1.6 }}>
                {wizardStage === 'results'
                    ? 'Đây là các việc AI tìm được cho bạn. Bỏ những việc không phù hợp, tìm thêm nếu muốn, rồi tối ưu CV cho các việc còn lại.'
                    : 'AI đọc CV của bạn, tìm các công ty đang tuyển vai trò của bạn, và chấm điểm từng tin tuyển dụng trực tiếp từ trang tuyển dụng chính thức của công ty.'}
            </p>

            {wizardStage === 'results' && (
                <JobResultsView
                    candidates={candidates}
                    poolRemaining={candidatePool.length}
                    busy={isProcessing}
                    onRemove={removeCandidate}
                    onFindMore={() => revealMoreCandidates(3)}
                    onOptimize={handleOptimizeSelected}
                    onBack={() => { clearCandidates(); setWizardStage('search'); }}
                />
            )}

            {wizardStage === 'search' && <>
            {/* How it works */}
            <div className="glass-card" style={{
                padding: '16px 20px', marginBottom: 24,
                background: 'linear-gradient(135deg, rgba(139,92,246,0.05), rgba(59,130,246,0.04))',
            }}>
                <p style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Cách hoạt động
                </p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['CV → AI suy ra vai trò', 'Tìm công ty phù hợp', 'Tìm trang tuyển dụng', 'Chấm điểm so với CV'].map((step, i) => (
                        <span key={i} style={{
                            fontSize: '0.75rem', padding: '3px 10px', borderRadius: 20,
                            background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                            display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                            {i > 0 && <span style={{ color: 'var(--accent-blue)' }}>→</span>}
                            {step}
                        </span>
                    ))}
                </div>
            </div>

            {/* Primary CTA: single entry point — AI discovers matching companies
                from the curated pool and ranks their openings against the CV. */}
            <div style={{ marginBottom: 16 }}>
                <button
                    className="btn-primary"
                    onClick={() => handleFeaturedAnalyze('featured')}
                    disabled={isProcessing || !cvData}
                    style={{
                        width: '100%',
                        height: 56,
                        fontSize: '0.98rem',
                        fontWeight: 600,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        borderRadius: 'var(--radius-lg)',
                    }}
                >
                    {isProcessing ? (
                        <>
                            <SpinnerGap size={18} style={{ animation: 'spin 1s linear infinite' }} />
                            Đang xử lý...
                        </>
                    ) : (
                        <>
                            <MagnifyingGlass size={18} weight="bold" /> Bắt đầu tìm kiếm
                        </>
                    )}
                </button>
            </div>

            {/* Microcopy */}
            <div style={{
                marginBottom: 4, textAlign: 'center',
                fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4,
            }}>
                AI tìm công ty phù hợp với CV và chấm điểm tin tuyển dụng của họ
            </div>

            {/* Divider */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                margin: '20px 0',
                color: 'var(--text-muted)', fontSize: '0.75rem',
            }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>hoặc dán một URL cụ thể</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
            </div>

            {/* URL Input (advanced / manual mode) */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                    <div style={{
                        position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                        color: 'var(--text-muted)', pointerEvents: 'none',
                    }}>
                        <Globe size={18} weight="duotone" />
                    </div>
                    <input
                        className="input-field"
                        type="url"
                        value={url}
                        onChange={(e) => { setUrl(e.target.value); setError(''); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !isProcessing) handleSmartAnalyze(); }}
                        disabled={isProcessing}
                        placeholder="Dán link trang tuyển dụng (vd: company.com/careers)"
                        aria-label="Link trang tuyển dụng cần tìm"
                        style={{
                            paddingLeft: 42,
                            height: 48,
                            fontSize: '0.9rem',
                            borderRadius: 'var(--radius-lg)',
                            width: '100%',
                        }}
                    />
                </div>
                <button
                    className="btn-secondary"
                    onClick={() => handleSmartAnalyze()}
                    disabled={isProcessing || !url.trim()}
                    style={{
                        height: 48, padding: '0 18px',
                        display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem',
                    }}
                >
                    Tìm trên URL này
                </button>
            </div>
            </>}

            {/* Inferred title badge */}
            {inferredTitle && isProcessing && (
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', borderRadius: 20, marginBottom: 12,
                    background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)',
                    fontSize: '0.82rem', color: 'var(--accent-purple)', fontWeight: 500,
                }}>
                    <Brain size={13} weight="duotone" /> AI nhận diện: {inferredTitle}
                </div>
            )}

            {/* Processing Pipeline */}
            {isProcessing && (
                <div className="glass-card" style={{
                    padding: '20px 24px', marginBottom: 16,
                    display: 'flex', flexDirection: 'column', gap: 14,
                }}>
                    {PHASE_ORDER.map((p, i) => {
                        const config = PHASE_CONFIG[p];
                        const isDone = i < currentPhaseIdx;
                        const isActive = i === currentPhaseIdx;
                        const Icon = config.icon;

                        return (
                            <div key={p} style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                opacity: i > currentPhaseIdx ? 0.3 : 1,
                                transition: 'opacity 0.3s',
                            }}>
                                {isDone ? (
                                    <div style={{
                                        width: 30, height: 30, borderRadius: '50%',
                                        background: 'var(--accent-green)', display: 'flex',
                                        alignItems: 'center', justifyContent: 'center',
                                        transition: 'all 0.3s',
                                    }}>
                                        <CheckCircle size={16} weight="fill" color="white" />
                                    </div>
                                ) : isActive ? (
                                    <div style={{
                                        width: 30, height: 30, borderRadius: '50%',
                                        background: 'var(--accent-blue)', display: 'flex',
                                        alignItems: 'center', justifyContent: 'center',
                                        boxShadow: '0 0 12px var(--accent-blue-glow)',
                                    }}>
                                        <SpinnerGap size={14} style={{ color: 'white', animation: 'spin 1s linear infinite' }} />
                                    </div>
                                ) : (
                                    <div style={{
                                        width: 30, height: 30, borderRadius: '50%',
                                        background: 'var(--bg-secondary)', border: '2px solid var(--border-subtle)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <Icon size={13} weight="duotone" style={{ color: 'var(--text-muted)' }} />
                                    </div>
                                )}
                                <div style={{ flex: 1 }}>
                                    <span style={{
                                        fontSize: '0.85rem',
                                        fontWeight: isActive ? 600 : 400,
                                        color: isActive ? 'var(--text-primary)' : isDone ? 'var(--accent-green)' : 'var(--text-muted)',
                                    }}>
                                        {config.label}
                                    </span>
                                    {isActive && phaseDetail && (
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                            {phaseDetail}
                                        </p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
                </div>
            )}

            {/* Error */}
            {error && (
                <div role="alert" style={{
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 16px',
                    marginBottom: 16,
                    fontSize: '0.85rem',
                    color: 'var(--accent-red)',
                    lineHeight: 1.5,
                }}>
                    {error}
                </div>
            )}

            {/* Actions — results stage has its own "Tìm kiếm lại" back button */}
            {wizardStage === 'search' && (
                <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
                    <button className="btn-secondary" onClick={() => setStep(1)} disabled={isProcessing}
                        style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ArrowLeft size={16} weight="bold" /> Quay lại
                    </button>
                </div>
            )}

            {/* Link to History view */}
            {jobHistory.length > 0 && (
                <button
                    onClick={() => setView('history')}
                    style={{
                        marginTop: 28,
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '12px 16px', width: '100%',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-card)',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        transition: 'all 0.18s ease',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--bg-card-hover)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--bg-card)';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                    }}
                >
                    <Briefcase size={15} weight="duotone" style={{ color: 'var(--accent-blue)' }} />
                    <span style={{ flex: 1, textAlign: 'left' }}>
                        Đã lưu{' '}
                        <strong style={{ color: 'var(--text-primary)' }}>{jobHistory.length}</strong>
                        {' '}hồ sơ ứng tuyển · xem tất cả trong Lịch sử
                    </span>
                    <ArrowRight size={14} weight="bold" />
                </button>
            )}
        </div>
    );
}
