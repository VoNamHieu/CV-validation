'use client';

import { useEffect, useRef, useState } from 'react';
import {
    ArrowLeft, Globe, SpinnerGap, MagnifyingGlass, Sparkle,
    Brain, LinkSimple, Lightning, MagicWand, CheckCircle,
    Briefcase, ArrowRight,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAppStore, type JDEntry } from '@/store/useAppStore';
import {
    smartSearch, crawlUrl, extractJdStructured, scoreFit, fetchPage,
    extractJobLinks, rankJobsTournament, extensionCrawl, isExtensionAvailable,
    findCareer, getFeaturedJobs, optimizeCvVariants, type JobListing,
} from '@/lib/api';
import { buildSearchUrl, matchesCity, titleMatchScore, cityLabel } from '@/lib/job-targeting';
import { buildCvPdfCache } from '@/lib/cv-pdf-cache';

type Phase = 'idle' | 'analyzing_cv' | 'searching' | 'extracting_links'
    | 'ranking' | 'crawling_job';

// Phase labels are intentionally generic — the user should perceive the system
// as "AI is searching for matching jobs", regardless of which backend path is
// actually running. Never name an underlying source (TopCV, featured list...).
// The per-job stages (resolve career page, crawl, extract JD, score, tailor CV)
// all run inside the parallel 'crawling_job' phase — jobs are in different
// stages at the same time, so a single chip represents them.
const PHASE_CONFIG: Record<Exclude<Phase, 'idle'>, { label: string; icon: Icon }> = {
    analyzing_cv: { label: 'AI analyzing your CV...', icon: Brain },
    searching: { label: 'Searching for matching openings...', icon: MagnifyingGlass },
    extracting_links: { label: 'Compiling job listings...', icon: LinkSimple },
    ranking: { label: 'Ranking jobs by CV fit...', icon: Sparkle },
    crawling_job: { label: 'Analyzing jobs in parallel...', icon: Lightning },
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
        targetJobTitle, targetLocation,
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
    const handleFeaturedAnalyze = async () => {
        if (!cvData) { setError('Please upload your CV first.'); return; }

        const isFullAuto = useAppStore.getState().fullyAutoMode;

        setError('');
        setOptimizedCv(null);
        setInferredTitle('');
        clearJdEntries();
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
                ? `Matching openings to "${targetTitle}"${cityName ? ` in ${cityName}` : ''}...`
                : 'Matching openings to your CV...');

            // ── Phase 2 (presented as "searching"): pull aggregated jobs. ──
            setPhase('searching');
            setPhaseDetail(targetTitle
                ? `Scanning live openings for "${targetTitle}"...`
                : 'Scanning live openings...');
            const featured = await getFeaturedJobs();
            type FeaturedJob = { url: string; title: string; company: string; careerUrl: string; location: string };
            const allJobs: FeaturedJob[] = [];
            for (const c of featured.companies) {
                for (const j of c.jobs) {
                    if (!j.url || !j.title) continue;
                    allJobs.push({
                        url: j.url, title: j.title,
                        company: c.name, careerUrl: c.career_url,
                        location: j.location || '',
                    });
                }
            }
            if (allJobs.length === 0) {
                throw new Error('No matching openings found right now. Try again in a moment.');
            }

            // ── Phase 3 (presented as "compiling listings"): HARD-pair by title,
            //    then by city. Title match is strict — only openings sharing the
            //    target role survive. If the curated list has none at all, fall
            //    back to the full list so the user isn't stranded. ──
            setPhase('extracting_links');
            const titleScored = allJobs
                .map((job) => ({ job, score: titleMatchScore(targetTitle, job.title) }))
                .filter((x) => x.score > 0);
            const titleStranded = titleScored.length === 0;
            const titlePool = titleStranded
                ? allJobs.map((job) => ({ job, score: 0 }))
                : titleScored;

            // City pairing: keep in-city matches; if none, stay strict on title
            // but surface this role in other cities (each marked "off-city").
            let pool = titlePool;
            let offCity = false;
            if (cityKey) {
                const inCity = titlePool.filter((x) => matchesCity(x.job.location, cityKey));
                if (inCity.length) pool = inCity;
                else offCity = true;
            }
            const poolJobs = pool.map((x) => x.job);
            setPhaseDetail(
                titleStranded
                    ? 'No exact title match — ranking all openings by CV fit...'
                    : offCity
                        ? `No "${targetTitle}" in ${cityName} — showing this role in other cities...`
                        : `${poolJobs.length} "${targetTitle}"${cityName ? ` in ${cityName}` : ''} openings — ranking by CV fit...`,
            );

            // ── Phase 4: rank the paired pool by CV fit ──
            setPhase('ranking');
            setPhaseDetail(`Ranking ${poolJobs.length} jobs by fit to your CV...`);
            const MAX_JOBS = 5;
            let ranked: { url: string; title?: string; fit_score?: number }[] = [];
            try {
                ranked = await rankJobsTournament(
                    cvData,
                    poolJobs.map((j) => ({ url: j.url, title: j.title, company: j.company })),
                );
            } catch (rankErr) {
                console.log('[StepInputUrl/featured] ranking failed, using original order:', rankErr);
            }
            const orderedUrls = ranked.length
                ? ranked.map((r) => r.url).filter(Boolean)
                : poolJobs.map((j) => j.url);
            const lookup = new Map(poolJobs.map((j) => [j.url, j]));
            const topJobs = orderedUrls
                .map((u) => lookup.get(u))
                .filter((j): j is FeaturedJob => !!j)
                .slice(0, MAX_JOBS);
            setPhaseDetail(`Top ${topJobs.length} by CV fit selected`);

            // Pre-populate JD entries so the user sees the queue immediately.
            // Mark any opening outside the chosen city so the editor can label it.
            for (const job of topJobs) {
                // Only flag as off-city when the listing has a known location that
                // doesn't match — an empty location is "unknown", not "elsewhere".
                const off = !!cityKey && !!job.location && !matchesCity(job.location, cityKey);
                addJdEntry({
                    id: `jd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    source: job.url,
                    label: job.title,
                    status: 'crawling',
                    jobTitle: job.title,
                    company: job.company,
                    location: job.location || undefined,
                    locationNote: off ? `Khác ${cityName}` : undefined,
                });
            }

            // ── Phase 4-6: crawl JD + extract + score + tailor CV — all jobs in
            //    PARALLEL. Outside full-auto, the first finished job opens the
            //    report immediately while the rest keep streaming in. ──
            const { navigated } = await runJobPipeline({
                queueLen: topJobs.length,
                runId,
                fallbackTitle: targetTitle,
                navigateOnFirstDone: !isFullAuto,
            });

            // ── Full-auto extension: CVs were already tailored inside the
            //    parallel pipeline — jump to the editor (step 3) where the
            //    batch-apply auto-trigger takes over. ──
            if (isFullAuto) {
                const done = useAppStore.getState().jdEntries.filter(
                    (e) => e.status === 'done' && e.jdData && e.matchResult,
                );
                if (done.length === 0) {
                    throw new Error('No scorable jobs to optimize.');
                }
                const optimizedCount = done.filter((e) => e.optimizedCv).length;
                setPhaseDetail(`Optimized ${optimizedCount}/${done.length} CVs. Handing off to extension...`);
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
            const msg = e instanceof Error ? e.message : 'Analysis failed';
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
    }): Promise<{ navigated: boolean }> => {
        const {
            queueLen, runId, fallbackTitle = '',
            resolveCareerFirst = false, autoOptimize = true, navigateOnFirstDone = true,
        } = opts;

        setPhase('crawling_job');
        setPhaseDetail(`Processing ${queueLen} jobs in parallel — opening results as soon as the first is ready...`);

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
                                error: `Duplicate company: ${company}`,
                            });
                            return;
                        }
                        seenCompanies.add(companyKey);
                    }
                    if (!finder.chosen_career) {
                        updateJdEntry(entryId, {
                            status: 'error',
                            error: company
                                ? `${company} — career page not found`
                                : 'Could not resolve company from posting',
                            company: company || undefined,
                        });
                        return;
                    }
                    if (!finder.jobs.length) {
                        updateJdEntry(entryId, {
                            status: 'error',
                            error: `${company || 'Company'} — no openings on their career page`,
                            company: company || undefined,
                        });
                        return;
                    }

                    const targetTitle = entry.jobTitle || fallbackTitle;
                    const bestMatch = pickBestTitleMatch(targetTitle, finder.jobs);
                    if (!bestMatch) {
                        updateJdEntry(entryId, {
                            status: 'error',
                            error: `${company} — no matching role on career page`,
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

                try {
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
                    updateJdEntry(entryId, { status: 'error', error: 'Could not load job page' });
                    return;
                }

                // ── Extract JD ──
                updateJdEntry(entryId, { status: 'parsing' });
                let jdData = await withRetry(() => extractJdStructured(jobPageText));
                if (Array.isArray(jdData)) jdData = jdData[0];
                if (!jdData || (!jdData.must_have?.length && !jdData.responsibilities?.length)) {
                    updateJdEntry(entryId, { status: 'error', error: 'No JD found on page' });
                    return;
                }

                // ── Score ──
                updateJdEntry(entryId, { status: 'scoring' });
                let matchResult = await withRetry(() => scoreFit(cvData!, jdData));
                if (Array.isArray(matchResult)) matchResult = matchResult[0];
                if (!matchResult?.overall_score) {
                    updateJdEntry(entryId, { status: 'error', error: 'Scoring failed' });
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

                // ── First job scored → open the report/edit page right away ──
                if (navigateOnFirstDone && !navigated && runRef.current === runId) {
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
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
            } finally {
                doneCount++;
                if (!navigated && runRef.current === runId) {
                    setPhaseDetail(`Processed ${doneCount}/${entries.length} jobs...`);
                }
            }
        };

        // Worker pool: up to JOB_CONCURRENCY entries in flight at once.
        let cursor = 0;
        await Promise.all(
            Array.from({ length: Math.min(JOB_CONCURRENCY, entries.length) }, async () => {
                while (cursor < entries.length) {
                    const next = entries[cursor++];
                    await processEntry(next);
                }
            })
        );

        return { navigated };
    };

    const handleSmartAnalyze = async (overrideUrl?: string) => {
        const trimmed = (overrideUrl ?? url).trim();
        // Auto mode = the URL is internal (user clicked "Find jobs from my CV").
        // Suppress the aggregator hostname in all user-facing copy so we never
        // leak which site we're scraping.
        const isAuto = !!overrideUrl;
        if (!trimmed) { setError('Please enter a job site URL.'); return; }
        if (!isValidUrl(trimmed)) { setError('Please enter a valid URL (http:// or https://)'); return; }
        if (!cvData) { setError('Please upload your CV first.'); return; }

        setError('');
        setOptimizedCv(null);
        setInferredTitle('');
        clearJdEntries();
        const runId = ++runRef.current;

        try {
            // ─── Phase 1: build the search URL from the confirmed target role
            //     (set on the upload step) — pure template lookup, no LLM. ───
            const targetTitle = (
                targetJobTitle || cvData.desired_job_title || cvData.employment?.current_title || ''
            ).trim();
            if (!targetTitle) throw new Error('Add a target role on the upload step first.');
            setPhase('analyzing_cv');
            // Known site → instant template URL. Unknown site → fall back to the
            // LLM, anchored to the confirmed role so it can't pick a different one.
            const built = buildSearchUrl(trimmed, targetTitle, targetLocation);
            let searchResult: { inferred_job_title: string; search_keyword: string; search_url: string } = built;
            if (!built.known) {
                setPhaseDetail('Preparing search for this site...');
                let r = await smartSearch(cvData, trimmed, targetTitle);
                if (Array.isArray(r)) r = r[0];
                if (!r?.search_url) throw new Error('AI could not generate a search URL for this site.');
                searchResult = {
                    inferred_job_title: r.inferred_job_title || targetTitle,
                    search_keyword: r.search_keyword || '',
                    search_url: r.search_url,
                };
            }
            setInferredTitle(searchResult.inferred_job_title);
            setPhaseDetail(`Looking for: "${searchResult.inferred_job_title}"`);

            // ─── Phase 2: Crawl the search results page ───
            setPhase('searching');
            const hostname = getHostname(trimmed);
            setPhaseDetail(isAuto ? 'Searching for matching companies...' : `Searching on ${hostname}...`);

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
                setPhaseDetail(`Site is anti-bot protected → opening via your browser extension...`);
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
            setPhaseDetail('AI is finding job listings...');

            // Guard: don't call AI with empty text
            if (!searchPage.text && !searchPage.textWithLinks) {
                const tail = isExtensionAvailable()
                    ? 'Even the browser-extension bypass failed — try again later or install the extension.'
                    : 'Install the JobFit AI Chrome extension to bypass anti-bot protection.';
                throw new Error(
                    isAuto
                        ? `Could not load matching jobs. ${tail}`
                        : `Could not load search results from ${hostname}. ${tail}`,
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
                        ? 'No matching jobs found. Try uploading a different CV or check back later.'
                        : `No job listings found on ${hostname}. Try a different job site.`,
                );
            }

            // ─── Phase 3.5: Rank candidates by CV fit BEFORE crawling ───
            // The site lists jobs by its own relevance; this re-orders them by
            // fit to THIS candidate's CV so we crawl the most promising first.
            setPhase('ranking');
            setPhaseDetail(`Ranking ${candidates.length} jobs by fit to your CV...`);

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
                    ? `Found ${candidates.length} jobs → crawling top ${jobUrls.length} by CV fit`
                    : `Found ${candidates.length} jobs → processing top ${jobUrls.length}`,
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
            const msg = e instanceof Error ? e.message : 'Analysis failed';
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
                Smart Job Finder
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32, fontSize: '0.95rem', lineHeight: 1.6 }}>
                AI reads your CV, finds companies hiring for your role, and scores each opening
                directly from the company&apos;s official career page.
            </p>

            {/* How it works */}
            <div className="glass-card" style={{
                padding: '16px 20px', marginBottom: 24,
                background: 'linear-gradient(135deg, rgba(139,92,246,0.05), rgba(59,130,246,0.04))',
            }}>
                <p style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    How it works
                </p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['CV → AI infers role', 'Find matching companies', 'Resolve career pages', 'Score JD vs CV'].map((step, i) => (
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

            {/* Primary CTA: Auto-find from CV (featured-companies demo flow) */}
            <button
                className="btn-primary"
                onClick={handleFeaturedAnalyze}
                disabled={isProcessing || !cvData}
                style={{
                    width: '100%',
                    height: 56,
                    fontSize: '1rem',
                    fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    marginBottom: 16,
                    borderRadius: 'var(--radius-lg)',
                }}
            >
                {isProcessing ? (
                    <>
                        <SpinnerGap size={18} style={{ animation: 'spin 1s linear infinite' }} />
                        Processing...
                    </>
                ) : (
                    <>
                        <Sparkle size={18} weight="fill" /> Find jobs from my CV
                    </>
                )}
            </button>

            {/* Divider */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                margin: '20px 0',
                color: 'var(--text-muted)', fontSize: '0.75rem',
            }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>or paste a specific URL</span>
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
                    Search this URL
                </button>
            </div>

            {/* Inferred title badge */}
            {inferredTitle && isProcessing && (
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', borderRadius: 20, marginBottom: 12,
                    background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)',
                    fontSize: '0.82rem', color: 'var(--accent-purple)', fontWeight: 500,
                }}>
                    <Brain size={13} weight="duotone" /> AI detected: {inferredTitle}
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
                <div style={{
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

            {/* Actions */}
            <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
                <button className="btn-secondary" onClick={() => setStep(1)} disabled={isProcessing}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ArrowLeft size={16} weight="bold" /> Back
                </button>
            </div>

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
                        <strong style={{ color: 'var(--text-primary)' }}>{jobHistory.length}</strong>
                        {' '}application{jobHistory.length === 1 ? '' : 's'} saved · view all in History
                    </span>
                    <ArrowRight size={14} weight="bold" />
                </button>
            )}
        </div>
    );
}
