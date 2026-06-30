// Dedup helper: hide jobs the user already has (saved/applied in jobHistory, or
// currently being processed in jdEntries) from a fresh search's results.
//
// A job is matched on two independent keys so it dedupes across sources:
//   - the specific posting URL (host + path, ignoring protocol/query/slash)
//   - a company|title composite (catches the same posting found via a different
//     URL, e.g. an aggregator vs the official link)
// We deliberately key on the SPECIFIC job url (not applyUrl/careerUrl) — those
// are often one shared listing page per company and would over-exclude.

import type { CandidateJob, JobRecord, JDEntry } from '@/store/useAppStore';

function normUrl(u?: string): string {
    if (!u) return '';
    const raw = u.trim();
    if (!raw) return '';
    try {
        const x = new URL(raw);
        const host = x.host.toLowerCase().replace(/^www\./, '');
        const path = x.pathname.replace(/\/+$/, '');
        return `u:${host}${path}`;
    } catch {
        return `u:${raw.toLowerCase().replace(/\/+$/, '')}`;
    }
}

function tcKey(title?: string, company?: string): string {
    const t = (title || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const c = (company || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return t && c ? `tc:${c}|${t}` : '';
}

function keysOf(url: string | undefined, title?: string, company?: string): string[] {
    return [normUrl(url), tcKey(title, company)].filter(Boolean);
}

/**
 * Build the set of keys for jobs the user already has — saved/applied
 * (jobHistory) plus anything currently queued/processed (jdEntries).
 */
export function buildSeenKeys(history: JobRecord[], entries: JDEntry[]): Set<string> {
    const seen = new Set<string>();
    for (const r of history) keysOf(r.jobUrl, r.jobTitle, r.company).forEach((k) => seen.add(k));
    for (const e of entries) keysOf(e.source, e.jobTitle, e.company).forEach((k) => seen.add(k));
    return seen;
}

/**
 * Drop candidates the user already has. Returns the filtered list (order kept).
 * `count`/`removed` let the caller log/inform how much was hidden.
 */
export function filterUnseenCandidates(
    cands: CandidateJob[], history: JobRecord[], entries: JDEntry[],
): { kept: CandidateJob[]; removed: number } {
    const seen = buildSeenKeys(history, entries);
    if (seen.size === 0) return { kept: cands, removed: 0 };
    const kept = cands.filter((c) => !keysOf(c.url, c.title, c.company).some((k) => seen.has(k)));
    return { kept, removed: cands.length - kept.length };
}
