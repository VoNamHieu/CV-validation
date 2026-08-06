// Canonical identity for an ATS candidate account.
//
// A Workday candidate account is scoped per TENANT, not per ATS and not per
// career site: aia.wd3.myworkdayjobs.com and bosch.wd3.myworkdayjobs.com are
// separate account namespaces, while /AIA_Careers and /AIA_Campus on the SAME
// host share one account (the session cookie is host-scoped). So `tenantKey` is
// the host, and `careerSiteKey` is metadata we record but never key on — making
// it part of the identity would fragment a per-tenant password override across
// sites and re-prompt the user for the same company.
//
// The extension keeps its own copy of this logic (extension/src/ats/tenant.js);
// the two must agree, since the tenantKey is the join key between them.

import { detectAtsLogin } from '@/lib/applyRecipes';

export interface AtsTenantRef {
    atsVendor: string;      // 'workday'
    tenantKey: string;      // canonical host — the account scope
    canonicalHost: string;
    careerSiteKey?: string; // metadata only
}

/** A tenant plus how it should be described to the user. */
export interface AtsTenantSummary extends AtsTenantRef {
    label: string;          // company name from the job list, else the tenant slug
    count: number;          // jobs in this batch on this tenant
}

const LOCALE_RE = /^[a-z]{2}([-_][A-Za-z]{2})?$/;
/** Path segments that are Workday plumbing, never a tenant or a career site. */
const STRUCTURAL = new Set(['wday', 'recruiting', 'authgwy', 'en', 'd']);
/** Where the account namespace lives for each host family. */
const HOST_SHAPE: { test: RegExp; shape: 'subdomain' | 'path' }[] = [
    { test: /\.myworkdayjobs\.com$/i, shape: 'subdomain' },
    { test: /\.myworkdaysite\.com$/i, shape: 'path' },
];

/**
 * Tenant identity for a job/apply URL, or null when the ATS needs no account.
 *
 * Workday paths come in several shapes — /en-US/{site}/job/…, /{site}/job/…,
 * and /wday/authgwy/{tenant}/… — so the career site is read as the first
 * non-locale, non-`wday` segment rather than a fixed index.
 */
export function tenantRefFor(url?: string | null): AtsTenantRef | null {
    const ats = detectAtsLogin(url);
    if (!ats?.requiresLogin || !url) return null;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    const host = parsed.host.toLowerCase();
    const shape = HOST_SHAPE.find((h) => h.test.test(host))?.shape ?? 'subdomain';

    const segs: string[] = [];
    for (const seg of parsed.pathname.split('/').filter(Boolean)) {
        if (seg === 'job' || seg === 'jobs' || seg === 'apply') break;
        if (STRUCTURAL.has(seg.toLowerCase()) || LOCALE_RE.test(seg)) continue;
        segs.push(seg);
    }

    if (shape === 'path') {
        // wd3.myworkdaysite.com/recruiting/<tenant>/<site>/job/… — the host is
        // shared by every company on the pod, so the tenant segment is what
        // scopes the account.
        const slug = segs[0];
        if (!slug) return null;
        return {
            atsVendor: ats.ats,
            tenantKey: `${host}/${slug.toLowerCase()}`,
            canonicalHost: host,
            careerSiteKey: segs[1],
        };
    }
    return { atsVendor: ats.ats, tenantKey: host, canonicalHost: host, careerSiteKey: segs[0] };
}

/** The tenant slug ("aia" from aia.wd3.myworkdayjobs.com) — a usable fallback
 *  label when we have no company name for the job. */
export function tenantSlug(tenantKey: string): string {
    // A composite key (wd3.myworkdaysite.com/mdlz) names the tenant after the
    // slash; splitting on '.' would label every company on that pod "Wd3".
    if (tenantKey.includes('/')) return tenantKey.split('/').pop() || tenantKey;
    return tenantKey.split('.')[0] || tenantKey;
}

function titleCase(slug: string): string {
    const cleaned = slug.replace(/[-_]+/g, ' ').trim();
    if (!cleaned) return slug;
    if (cleaned.length <= 4) return cleaned.toUpperCase();     // AIA, IBM, EY…
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Collapse a batch's jobs into the distinct tenants that will need an account,
 * biggest first. Drives both the modal's "will be used for" list and the
 * /resolve call at batch start.
 */
export function summarizeTenants(
    jobs: { jobUrl?: string | null; company?: string | null }[],
): AtsTenantSummary[] {
    const byTenant = new Map<string, AtsTenantSummary>();
    for (const job of jobs) {
        const ref = tenantRefFor(job.jobUrl);
        if (!ref) continue;
        const existing = byTenant.get(ref.tenantKey);
        if (existing) {
            existing.count += 1;
            // Prefer a real company name over the slug fallback.
            if (!existing.label && job.company) existing.label = job.company;
            if (!existing.careerSiteKey && ref.careerSiteKey) existing.careerSiteKey = ref.careerSiteKey;
        } else {
            byTenant.set(ref.tenantKey, {
                ...ref,
                label: job.company || titleCase(tenantSlug(ref.tenantKey)),
                count: 1,
            });
        }
    }
    return [...byTenant.values()].sort((a, b) => b.count - a.count);
}

/** Human label for a tenant we only know by key (settings panel, action rows). */
export function tenantLabel(tenantKey: string, vendorLabel = 'Workday'): string {
    return `${titleCase(tenantSlug(tenantKey))} · ${vendorLabel}`;
}
