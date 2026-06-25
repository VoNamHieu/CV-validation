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

// ── Seniority preference ──────────────────────────────────────────────────
// `key` is the canonical level the backend's facet engine understands (it
// demotes jobs whose level doesn't fit). The backend re-canonicalizes anything
// we send (canon_level), so `match` here is only to PRE-SELECT a chip from the
// CV's loose `current_level` — it doesn't need to be authoritative.
export interface SeniorityOption {
    key: string;
    label: string;
    match: RegExp;
}

// Order = display order of the chips on the upload step (low → high).
export const SENIORITY_OPTIONS: SeniorityOption[] = [
    { key: 'Intern/Fresher', label: 'Intern / Fresher', match: /intern|fresher|thực tập|thuc tap|sinh viên|sinh vien/i },
    { key: 'Junior', label: 'Junior', match: /junior|\bjr\b|entry|mới ra trường|moi ra truong|tập sự|tap su/i },
    { key: 'Mid', label: 'Mid', match: /\bmid\b|middle|intermediate|trung cấp|trung cap/i },
    { key: 'Senior', label: 'Senior', match: /senior|\bsr\b|cao cấp|cao cap/i },
    { key: 'Lead/Manager', label: 'Lead / Manager', match: /lead|principal|manager|\bstaff\b|quản lý|quan ly|trưởng nhóm|truong nhom/i },
    { key: 'Director/Head+', label: 'Director / Head+', match: /director|head|chief|\bc[efimot]o\b|\bvp\b|giám đốc|giam doc|trưởng phòng|truong phong/i },
];

// Best-effort map a CV's loose level string to a canonical chip key (or '').
export function canonSeniority(level: string): string {
    if (!level) return '';
    return SENIORITY_OPTIONS.find((o) => o.match.test(level))?.key || '';
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

// ── Experience-gap rule ────────────────────────────────────────────────────
// A job may require at most this many years ABOVE the candidate's experience
// and still be shown. Jobs that out-reach further are dropped.
export const MAX_EXPERIENCE_GAP_YEARS = 1;

/**
 * Minimum years of experience a JD asks for. Prefers the numeric
 * required_years_min the extractor now returns; falls back to parsing the
 * seniority_expected text ("3+ years", "ít nhất 3 năm", "Senior"). Returns null
 * when the JD gives no usable signal — callers must NOT filter in that case.
 */
export function requiredYearsFromJd(
    jd: { required_years_min?: number; seniority_expected?: string },
): number | null {
    if (typeof jd.required_years_min === 'number' && jd.required_years_min > 0) {
        return jd.required_years_min;
    }
    const s = (jd.seniority_expected || '').toLowerCase();
    // Numeric: "3+ years", "3-5 years", "ít nhất 3 năm", "3 nam"
    const m = s.match(/(\d+(?:\.\d+)?)\s*(?:years?|năm|nam|yrs?)/);
    if (m) return Math.round(parseFloat(m[1]));
    // Word-level seniority fallback
    if (/(intern|fresher|thực tập|sinh viên)/.test(s)) return 0;
    if (/(junior|entry|fresh|mới ra trường)/.test(s)) return 1;
    if (/(mid|middle|intermediate|trung cấp)/.test(s)) return 3;
    if (/(senior|sr\.?|cao cấp)/.test(s)) return 5;
    if (/(lead|principal|manager|head|trưởng|quản lý|giám đốc)/.test(s)) return 7;
    return null;
}

/**
 * Whether a job out-reaches the candidate by more than the allowed gap.
 * Unknown requirement (null) → never filtered. Over-qualified candidate → kept.
 */
export function experienceGapExceeds(
    jd: { required_years_min?: number; seniority_expected?: string },
    candidateYears: number,
    maxGap = MAX_EXPERIENCE_GAP_YEARS,
): { exceeds: boolean; required: number | null } {
    const required = requiredYearsFromJd(jd);
    if (required == null) return { exceeds: false, required: null };
    return { exceeds: required - (candidateYears || 0) > maxGap, required };
}
