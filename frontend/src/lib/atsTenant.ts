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
    const segments = parsed.pathname.split('/').filter(Boolean);
    let careerSiteKey: string | undefined;
    for (const seg of segments) {
        if (seg === 'wday' || LOCALE_RE.test(seg)) continue;
        if (seg === 'job' || seg === 'jobs' || seg === 'apply') break;
        careerSiteKey = seg;
        break;
    }
    return { atsVendor: ats.ats, tenantKey: host, canonicalHost: host, careerSiteKey };
}

/** The tenant slug ("aia" from aia.wd3.myworkdayjobs.com) — a usable fallback
 *  label when we have no company name for the job. */
export function tenantSlug(tenantKey: string): string {
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
