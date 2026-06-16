// Job targeting helpers: city options + title/city matching + search-URL builder.
//
// These replace the old /api/ai/smart-search LLM round-trip. The desired job
// title is now inferred during CV extraction (step 1), and the search URL is a
// pure-code template lookup — no extra Gemini call, so the user only waits once.

export interface CityOption {
    key: string;
    label: string;
    // Lowercased substrings we accept as a match in a job's free-text location.
    aliases: string[];
}

// Order = display order of the chips on the upload step.
export const CITY_OPTIONS: CityOption[] = [
    { key: 'hcm', label: 'TP. Hồ Chí Minh', aliases: ['hồ chí minh', 'ho chi minh', 'hcm', 'tphcm', 'tp.hcm', 'tp hcm', 'sài gòn', 'sai gon', 'saigon'] },
    { key: 'hanoi', label: 'Hà Nội', aliases: ['hà nội', 'ha noi', 'hanoi'] },
    { key: 'danang', label: 'Đà Nẵng', aliases: ['đà nẵng', 'da nang', 'danang'] },
    { key: 'remote', label: 'Remote', aliases: ['remote', 'từ xa', 'tu xa', 'làm việc từ xa', 'wfh', 'work from home'] },
];

export function cityLabel(key: string): string {
    return CITY_OPTIONS.find((c) => c.key === key)?.label || '';
}

// Does a job's free-text location belong to the chosen city? Empty cityKey
// (freestyle) always matches.
export function matchesCity(location: string, cityKey: string): boolean {
    if (!cityKey) return true;
    const opt = CITY_OPTIONS.find((c) => c.key === cityKey);
    if (!opt) return true;
    const loc = (location || '').toLowerCase();
    if (!loc) return false;
    return opt.aliases.some((a) => loc.includes(a));
}

// Ultra-generic role words that match almost any title — they don't prove a
// real title match on their own, so they're excluded from the "core" score.
const GENERIC_TITLE_TOKENS = new Set([
    'engineer', 'developer', 'dev', 'senior', 'junior', 'mid', 'lead', 'staff',
    'principal', 'manager', 'specialist', 'intern', 'fresher', 'officer',
    'executive', 'assistant', 'associate', 'consultant', 'analyst', 'and', 'the',
]);

function titleTokens(s: string): string[] {
    return (s || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter((t) => t.length >= 3);
}

// How strongly does `jobTitle` match the target role? Returns the count of
// shared tokens, weighting non-generic tokens (e.g. "frontend", "data") double
// so "Frontend Engineer" beats a bare "Engineer". 0 = no overlap.
export function titleMatchScore(target: string, jobTitle: string): number {
    const want = new Set(titleTokens(target));
    if (want.size === 0) return 1; // no target → don't filter anything out
    let score = 0;
    for (const t of titleTokens(jobTitle)) {
        if (!want.has(t)) continue;
        score += GENERIC_TITLE_TOKENS.has(t) ? 1 : 2;
    }
    return score;
}

// ── Search-URL builder (was the job of /api/ai/smart-search) ──
// Known job sites have stable query patterns; we template them directly. The
// city is appended as a keyword hint where the site has no separate location
// param, which biases results without us needing to know every site's schema.
interface BuiltSearch {
    inferred_job_title: string;
    search_keyword: string;
    search_url: string;
    // false → site not in our template table; caller should fall back to the
    // LLM smart-search so arbitrary sites still get a correct search URL.
    known: boolean;
}

function hyphenate(s: string): string {
    return s.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '-');
}

export function buildSearchUrl(siteUrl: string, jobTitle: string, cityKey = ''): BuiltSearch {
    const title = (jobTitle || '').trim();
    const cityName = cityLabel(cityKey);
    const keyword = hyphenate(title);
    const enc = (s: string) => encodeURIComponent(s);
    let host = '';
    try { host = new URL(siteUrl).hostname.replace(/^www\./, ''); } catch { host = siteUrl; }

    let search_url: string;
    let known = true;
    switch (true) {
        case host.includes('vietnamworks.com'):
            search_url = `https://www.vietnamworks.com/viec-lam?q=${enc(title)}`;
            break;
        case host.includes('indeed.com'):
            search_url = `https://www.indeed.com/jobs?q=${enc(title)}${cityName ? `&l=${enc(cityName)}` : ''}`;
            break;
        case host.includes('linkedin.com'):
            search_url = `https://www.linkedin.com/jobs/search/?keywords=${enc(title)}${cityName ? `&location=${enc(cityName)}` : ''}`;
            break;
        case host.includes('glassdoor.com'):
            search_url = `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${enc(title)}`;
            break;
        case host.includes('careerbuilder.vn'):
            search_url = `https://careerbuilder.vn/viec-lam/${keyword}-kw.html`;
            break;
        default: {
            // Unknown site: best-effort generic ?q= against the site's origin.
            // `known: false` tells the caller to prefer the LLM smart-search.
            known = false;
            const origin = (() => { try { return new URL(siteUrl).origin; } catch { return siteUrl.replace(/\/$/, ''); } })();
            search_url = `${origin}/?q=${enc(title)}`;
        }
    }

    return { inferred_job_title: title, search_keyword: keyword, search_url, known };
}
