'use client';

import { useEffect, useRef, useState } from 'react';
import {
    ArrowLeft, Globe, SpinnerGap, MagnifyingGlass, Sparkle,
    Brain, LinkSimple, Crosshair, ChartBar, MagicWand, CheckCircle,
    Briefcase, ArrowRight, Building,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useAppStore } from '@/store/useAppStore';
import {
    smartSearch, crawlUrl, extractJdStructured, scoreFit, fetchPage,
    extractJobLinks, rankJobsTournament, extensionCrawl, isExtensionAvailable,
    findCareer, getFeaturedJobs, optimizeCv, type JobListing,
} from '@/lib/api';

type Phase = 'idle' | 'analyzing_cv' | 'searching' | 'extracting_links'
    | 'ranking' | 'resolving_career' | 'crawling_job' | 'detecting_jd' | 'scoring'
    | 'optimizing';

// Phase labels are intentionally generic — the user should perceive the system
// as "AI is searching for matching jobs", regardless of which backend path is
// actually running. Never name an underlying source (TopCV, featured list...).
const PHASE_CONFIG: Record<Exclude<Phase, 'idle'>, { label: string; icon: Icon }> = {
    analyzing_cv: { label: 'AI analyzing your CV...', icon: Brain },
    searching: { label: 'Searching for matching openings...', icon: MagnifyingGlass },
    extracting_links: { label: 'Compiling job listings...', icon: LinkSimple },
    ranking: { label: 'Ranking jobs by CV fit...', icon: Sparkle },
    resolving_career: { label: 'Finding companies’ official career pages...', icon: Building },
    crawling_job: { label: 'Fetching job page...', icon: Globe },
    detecting_jd: { label: 'AI extracting job description...', icon: Crosshair },
    scoring: { label: 'Calculating match score...', icon: ChartBar },
    optimizing: { label: 'Tailoring your CV per job...', icon: Sparkle },
};

// Two pipelines, same UX. Auto-find ("Find jobs from my CV") uses the demo
// backend path but presents itself as a general AI search. URL-paste keeps
// the resolve-career step because it still goes through Stage 0.
const PHASE_ORDER_FEATURED: Exclude<Phase, 'idle'>[] = [
    'analyzing_cv', 'searching', 'extracting_links', 'ranking',
    'crawling_job', 'detecting_jd', 'scoring',
];
const PHASE_ORDER_URL: Exclude<Phase, 'idle'>[] = [
    'analyzing_cv', 'searching', 'extracting_links', 'ranking',
    'resolving_career', 'crawling_job', 'detecting_jd', 'scoring',
];
// Fully-auto extends the featured pipeline with a CV-tailoring step
// before handoff to the extension's batch apply.
const PHASE_ORDER_FULL_AUTO: Exclude<Phase, 'idle'>[] = [
    'analyzing_cv', 'searching', 'extracting_links', 'ranking',
    'crawling_job', 'detecting_jd', 'scoring', 'optimizing',
];

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
        setView, jobHistory, fullyAutoMode, setFullyAutoMode,
    } = useAppStore();

    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const [phase, setPhase] = useState<Phase>('idle');
    const [phaseDetail, setPhaseDetail] = useState('');
    const [inferredTitle, setInferredTitle] = useState('');
    // Which pipeline is currently running — controls which phase chip-row to
    // render. 'featured' = curated VN employers (demo flow); 'url' = paste-a-
    // URL flow that goes through VNW. 'full_auto' = featured + auto-optimize +
    // jump to step 4 for the extension batch.
    const [flowMode, setFlowMode] = useState<'featured' | 'url' | 'full_auto'>('featured');
    // Guard the auto-trigger useEffect against React Strict-Mode double-fires.
    const autoStartedRef = useRef(false);

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
        setFlowMode(isFullAuto ? 'full_auto' : 'featured');

        try {
            // ── Phase 1: read CV → inferred role (display only; ranker uses the full CV) ──
            setPhase('analyzing_cv');
            setPhaseDetail('Reading your CV to understand what job you want...');
            let cvSearch = await smartSearch(cvData, 'https://example.com/');
            if (Array.isArray(cvSearch)) cvSearch = cvSearch[0];
            const inferred = cvSearch?.inferred_job_title || '';
            setInferredTitle(inferred);

            // ── Phase 2 (presented as "searching"): pull aggregated jobs. ──
            setPhase('searching');
            setPhaseDetail(inferred
                ? `Scanning live openings for "${inferred}"...`
                : 'Scanning live openings...');
            const featured = await getFeaturedJobs();
            const allJobs: { url: string; title: string; company: string; careerUrl: string }[] = [];
            for (const c of featured.companies) {
                for (const j of c.jobs) {
                    if (!j.url || !j.title) continue;
                    allJobs.push({
                        url: j.url, title: j.title,
                        company: c.name, careerUrl: c.career_url,
                    });
                }
            }
            if (allJobs.length === 0) {
                throw new Error('No matching openings found right now. Try again in a moment.');
            }

            // ── Phase 3 (presented as "compiling listings"): handoff to ranker. ──
            setPhase('extracting_links');
            setPhaseDetail(`Found ${allJobs.length} openings — preparing them for AI ranking...`);

            // ── Phase 4: rank by CV fit ──
            setPhase('ranking');
            setPhaseDetail(`Ranking ${allJobs.length} jobs by fit to your CV...`);
            const MAX_JOBS = 5;
            let ranked: { url: string; title?: string; fit_score?: number }[] = [];
            try {
                ranked = await rankJobsTournament(
                    cvData,
                    allJobs.map((j) => ({ url: j.url, title: j.title, company: j.company })),
                );
            } catch (rankErr) {
                console.log('[StepInputUrl/featured] ranking failed, using original order:', rankErr);
            }
            const orderedUrls = ranked.length
                ? ranked.map((r) => r.url).filter(Boolean)
                : allJobs.map((j) => j.url);
            const lookup = new Map(allJobs.map((j) => [j.url, j]));
            const topJobs = orderedUrls
                .map((u) => lookup.get(u))
                .filter((j): j is typeof allJobs[number] => !!j)
                .slice(0, MAX_JOBS);
            setPhaseDetail(`Top ${topJobs.length} by CV fit selected`);

            // Pre-populate JD entries so the user sees the queue immediately.
            for (const job of topJobs) {
                addJdEntry({
                    id: `jd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    source: job.url,
                    label: job.title,
                    status: 'crawling',
                    jobTitle: job.title,
                    company: job.company,
                });
            }

            // ── Phase 4-6: crawl JD + extract + score for each job ──
            await crawlExtractScoreLoop(topJobs.length);

            // ── Full-auto extension: optimize CV per scored job, then jump
            //    to step 4 where the batch-apply auto-trigger takes over. ──
            if (isFullAuto) {
                const done = useAppStore.getState().jdEntries.filter(
                    (e) => e.status === 'done' && e.jdData && e.matchResult,
                );
                if (done.length === 0) {
                    throw new Error('No scorable jobs to optimize.');
                }
                setPhase('optimizing');
                let optimizedCount = 0;
                for (const entry of done) {
                    setPhaseDetail(`Tailoring CV for "${entry.jobTitle || entry.label}" (${optimizedCount + 1}/${done.length})...`);
                    try {
                        const opt = await optimizeCv(cvData, entry.jdData!, entry.matchResult!);
                        updateJdEntry(entry.id, { optimizedCv: opt });
                        optimizedCount++;
                    } catch (optErr) {
                        console.log('[StepInputUrl/full_auto] optimize failed for', entry.id, optErr);
                    }
                }
                setPhaseDetail(`Optimized ${optimizedCount}/${done.length} CVs. Handing off to extension...`);
                setPhase('idle');
                setStep(4);
                return;
            }

            setPhase('idle');
            setStep(3);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Analysis failed';
            setError(msg);
            setPhase('idle');
            setPhaseDetail('');
            // Exit auto mode on failure so the user isn't stuck looping.
            if (useAppStore.getState().fullyAutoMode) setFullyAutoMode(false);
        }
    };

    // Shared per-entry crawl → extract → score loop. Reads the latest jdEntries
    // from the store (so it picks up any pre-population done by the caller) and
    // walks each entry sequentially. Used by both the featured-mode and (later)
    // the company-first refactor of the URL-paste flow.
    const crawlExtractScoreLoop = async (queueLen: number) => {
        setPhase('crawling_job');

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
        let completedCount = 0;

        for (const entry of entries) {
            const entryId = entry.id;
            if (entry.status === 'error') { completedCount++; continue; }
            const jobUrl = entry.source;
            setPhaseDetail(`Processing job ${completedCount + 1}/${queueLen}: ${jobUrl.slice(0, 60)}...`);

            try {
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
                    console.log('[crawlExtractScoreLoop] HTTP failed:', httpErr);
                }

                let pwBlocked = false;
                if (jobPageText.length < 200) {
                    try {
                        const pw = await fetchPage(jobUrl);
                        pwBlocked = !!pw.blocked;
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
                        console.log('[crawlExtractScoreLoop] Playwright failed:', pwErr);
                    }

                    if (jobPageText.length < 200 && isExtensionAvailable()) {
                        setPhaseDetail(`Job ${completedCount + 1}/${queueLen}: ${pwBlocked ? 'site blocks bots → ' : ''}opening via extension...`);
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
                            console.log('[crawlExtractScoreLoop] Extension failed:', extErr);
                        }
                    }
                }

                if (jobPageText.length < 100) {
                    updateJdEntry(entryId, { status: 'error', error: 'Could not load job page' });
                    completedCount++;
                    continue;
                }

                updateJdEntry(entryId, { status: 'parsing' });
                let jdData = await extractJdStructured(jobPageText);
                if (Array.isArray(jdData)) jdData = jdData[0];
                if (!jdData || (!jdData.must_have?.length && !jdData.responsibilities?.length)) {
                    updateJdEntry(entryId, { status: 'error', error: 'No JD found on page' });
                    completedCount++;
                    continue;
                }

                updateJdEntry(entryId, { status: 'scoring' });
                let matchResult = await scoreFit(cvData!, jdData);
                if (Array.isArray(matchResult)) matchResult = matchResult[0];
                if (!matchResult?.overall_score) {
                    updateJdEntry(entryId, { status: 'error', error: 'Scoring failed' });
                    completedCount++;
                    continue;
                }

                const resolvedTitle = jobTitle || entry.jobTitle || '';
                const resolvedCompany = company || entry.company || '';

                updateJdEntry(entryId, {
                    status: 'done',
                    jdData,
                    matchResult,
                    jobTitle: resolvedTitle,
                    company: resolvedCompany,
                });

                if (completedCount === 0 || !useAppStore.getState().matchResult) {
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
            } catch (err) {
                updateJdEntry(entryId, {
                    status: 'error',
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
            }
            completedCount++;
        }
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
        setFlowMode('url');

        try {
            // ─── Phase 1: AI Analyze CV → infer job title + search URL ───
            setPhase('analyzing_cv');
            setPhaseDetail('Reading your CV to understand what job you want...');
            let searchResult = await smartSearch(cvData, trimmed);
            if (Array.isArray(searchResult)) searchResult = searchResult[0];
            if (!searchResult?.search_url) throw new Error('AI could not generate a search URL.');
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

            // ─── Phase 3.6: Resolve each ranked job → company → career page ───
            // We use the TopCV/VNW posting only as a lead — once we know the
            // company we look up its own career page, find the role there, and
            // crawl that for the JD. This is what hides the aggregator from the
            // end user and lines up with the apply-on-company-site model.
            setPhase('resolving_career');

            const initialEntries = useAppStore.getState().jdEntries;
            const seenCompanies = new Set<string>();
            for (let i = 0; i < initialEntries.length; i++) {
                const entry = initialEntries[i];
                setPhaseDetail(`Resolving company ${i + 1}/${initialEntries.length}...`);

                try {
                    const finder = await findCareer({ input_url: entry.source });
                    const company = (finder.resolution.company_name || '').trim();
                    const companyKey = company.toLowerCase();

                    if (companyKey && seenCompanies.has(companyKey)) {
                        updateJdEntry(entry.id, {
                            status: 'error',
                            error: `Duplicate company: ${company}`,
                        });
                        continue;
                    }
                    if (companyKey) seenCompanies.add(companyKey);

                    if (!finder.chosen_career) {
                        updateJdEntry(entry.id, {
                            status: 'error',
                            error: company
                                ? `${company} — career page not found`
                                : 'Could not resolve company from posting',
                            company: company || undefined,
                        });
                        continue;
                    }

                    if (!finder.jobs.length) {
                        updateJdEntry(entry.id, {
                            status: 'error',
                            error: `${company || 'Company'} — no openings on their career page`,
                            company: company || undefined,
                        });
                        continue;
                    }

                    const targetTitle = entry.jobTitle || searchResult.inferred_job_title;
                    const bestMatch = pickBestTitleMatch(targetTitle, finder.jobs);
                    if (!bestMatch) {
                        updateJdEntry(entry.id, {
                            status: 'error',
                            error: `${company} — no matching role on career page`,
                            company: company || undefined,
                        });
                        continue;
                    }

                    // Rewrite the entry to point at the canonical career-page job.
                    updateJdEntry(entry.id, {
                        source: bestMatch.url,
                        label: bestMatch.title || entry.label,
                        jobTitle: bestMatch.title || entry.jobTitle,
                        company: company || undefined,
                        status: 'crawling',
                    });
                } catch (err) {
                    updateJdEntry(entry.id, {
                        status: 'error',
                        error: err instanceof Error
                            ? err.message
                            : 'Failed to resolve career page',
                    });
                }
            }

            // ─── Phase 4-6: Crawl + Extract JD + Score for each resolved job ───
            setPhase('crawling_job');

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const buildJdFromLd = (ld: any): string => [
                ld.title && `Job Title: ${ld.title}`,
                ld.hiringOrganization?.name && `Company: ${ld.hiringOrganization.name}`,
                ld.jobLocation?.address?.addressLocality && `Location: ${ld.jobLocation.address.addressLocality}`,
                ld.description && `\nJob Description:\n${ld.description}`,
                ld.qualifications && `\nQualifications:\n${ld.qualifications}`,
                ld.jobBenefits && `\nBenefits:\n${ld.jobBenefits}`,
            ].filter(Boolean).join('\n');

            // Process all jobs (sequential to avoid rate limits). Re-read from
            // the store after the resolving phase rewrote each entry's source
            // to point at the company's own career-page job URL.
            const entries = useAppStore.getState().jdEntries;
            let completedCount = 0;

            for (const entry of entries) {
                const entryId = entry.id;
                // Skip entries the resolving phase already gave up on
                // (no career page, no matching role, duplicate company).
                if (entry.status === 'error') {
                    completedCount++;
                    continue;
                }
                const jobUrl = entry.source;
                setPhaseDetail(`Processing job ${completedCount + 1}/${jobUrls.length}: ${jobUrl.slice(0, 50)}...`);

                try {
                    // Crawl
                    updateJdEntry(entryId, { status: 'crawling' });
                    let jobPageText = '';
                    let jobTitle = '';
                    let company = '';

                    // Try HTTP first
                    try {
                        console.log(`[DEBUG] HTTP crawl: ${jobUrl}`);
                        const jobPage = await crawlUrl(jobUrl);
                        console.log(`[DEBUG] HTTP result: text=${jobPage.text?.length ?? 0} chars, jsonLd=${!!jobPage.jsonLd}`);
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const ld = jobPage.jsonLd as any;
                        if (ld?.description) {
                            jobPageText = buildJdFromLd(ld);
                            jobTitle = ld.title || '';
                            company = ld.hiringOrganization?.name || '';
                            console.log(`[DEBUG] HTTP JSON-LD found: title=${jobTitle}`);
                        } else if ((jobPage.text?.length ?? 0) >= 500) {
                            jobPageText = jobPage.text;
                            console.log(`[DEBUG] HTTP text fallback: ${jobPageText.length} chars`);
                        } else {
                            console.log(`[DEBUG] HTTP text too short: ${jobPage.text?.length ?? 0} chars`);
                        }
                    } catch (httpErr) {
                        console.log(`[DEBUG] HTTP crawl FAILED:`, httpErr);
                    }

                    // Playwright fallback
                    let pwBlocked = false;
                    if (jobPageText.length < 200) {
                        try {
                            console.log(`[DEBUG] Playwright fallback: ${jobUrl}`);
                            const pw = await fetchPage(jobUrl);
                            console.log(`[DEBUG] Playwright result: success=${pw.success}, text=${pw.text?.length ?? 0} chars, jsonLd=${!!pw.jsonLd}, blocked=${!!pw.blocked}`);
                            pwBlocked = !!pw.blocked;
                            if (pw.success) {
                                if (pw.jsonLd?.description) {
                                    jobPageText = buildJdFromLd(pw.jsonLd);
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    jobTitle = (pw.jsonLd as any).title || '';
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    company = (pw.jsonLd as any).hiringOrganization?.name || '';
                                    console.log(`[DEBUG] Playwright JSON-LD found: title=${jobTitle}`);
                                } else if (pw.text.length >= 200) {
                                    jobPageText = pw.text;
                                    console.log(`[DEBUG] Playwright text fallback: ${jobPageText.length} chars`);
                                } else {
                                    console.log(`[DEBUG] Playwright text too short: ${pw.text.length} chars`);
                                }
                            } else {
                                console.log(`[DEBUG] Playwright returned success=false`);
                            }
                        } catch (pwErr) {
                            console.log(`[DEBUG] Playwright FAILED:`, pwErr);
                        }

                        // ── Extension fallback (Cloudflare bypass via user's browser) ──
                        if (jobPageText.length < 200 && isExtensionAvailable()) {
                            setPhaseDetail(`Job ${completedCount + 1}/${jobUrls.length}: ${pwBlocked ? 'site blocks bots → ' : ''}opening via extension...`);
                            try {
                                console.log(`[DEBUG] Extension crawl: ${jobUrl}`);
                                const ext = await extensionCrawl(jobUrl);
                                console.log(`[DEBUG] Extension result: success=${ext.success}, text=${ext.text?.length ?? 0} chars, jsonLd=${!!ext.jsonLd}`);
                                if (ext.success) {
                                    const ld = ext.jsonLd;
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    if (ld && (ld as any).description) {
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        jobPageText = buildJdFromLd(ld as any);
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        jobTitle = (ld as any).title || '';
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        company = (ld as any).hiringOrganization?.name || '';
                                    } else if (ext.text.length >= 200) {
                                        jobPageText = ext.text;
                                    }
                                }
                            } catch (extErr) {
                                console.log(`[DEBUG] Extension crawl FAILED:`, extErr);
                            }
                        }
                    }

                    console.log(`[DEBUG] Final jobPageText: ${jobPageText.length} chars`);

                    if (jobPageText.length < 100) {
                        updateJdEntry(entryId, { status: 'error', error: 'Could not load job page' });
                        completedCount++;
                        continue;
                    }

                    // Extract JD
                    updateJdEntry(entryId, { status: 'parsing' });
                    let jdData = await extractJdStructured(jobPageText);
                    if (Array.isArray(jdData)) jdData = jdData[0];
                    if (!jdData || (!jdData.must_have?.length && !jdData.responsibilities?.length)) {
                        updateJdEntry(entryId, { status: 'error', error: 'No JD found on page' });
                        completedCount++;
                        continue;
                    }

                    // Score
                    updateJdEntry(entryId, { status: 'scoring' });
                    let matchResult = await scoreFit(cvData, jdData);
                    if (Array.isArray(matchResult)) matchResult = matchResult[0];
                    if (!matchResult?.overall_score) {
                        updateJdEntry(entryId, { status: 'error', error: 'Scoring failed' });
                        completedCount++;
                        continue;
                    }

                    // Prefer a title from the crawled page, then the ranked title
                    // from the search page (entry.jobTitle), then the inferred role.
                    const resolvedTitle = jobTitle || entry.jobTitle || searchResult.inferred_job_title;
                    // Same priority for company: JSON-LD on the career page wins,
                    // but fall back to the name we resolved in the prior phase
                    // so we never display an empty company.
                    const resolvedCompany = company || entry.company || '';

                    updateJdEntry(entryId, {
                        status: 'done',
                        jdData,
                        matchResult,
                        jobTitle: resolvedTitle,
                        company: resolvedCompany,
                    });

                    // Also save first successful to legacy fields for backward compat
                    if (completedCount === 0 || !useAppStore.getState().matchResult) {
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

                } catch (err) {
                    updateJdEntry(entryId, {
                        status: 'error',
                        error: err instanceof Error ? err.message : 'Unknown error',
                    });
                }
                completedCount++;
            }

            setPhase('idle');
            setStep(3);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Analysis failed';
            setError(msg);
            setPhase('idle');
            setPhaseDetail('');
        }
    };

    const isProcessing = phase !== 'idle';
    const phaseOrder =
        flowMode === 'full_auto' ? PHASE_ORDER_FULL_AUTO
            : flowMode === 'featured' ? PHASE_ORDER_FEATURED
                : PHASE_ORDER_URL;
    const currentPhaseIdx = phaseOrder.indexOf(phase as Exclude<Phase, 'idle'>);

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
                    {phaseOrder.map((p, i) => {
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
