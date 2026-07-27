// Canonical identity for an ATS candidate account.
//
// MUST agree with frontend/src/lib/atsTenant.ts — tenantKey is the join key
// between the extension, the backend and the web app. Kept as a separate copy
// on purpose (same arrangement as recipe.js vs applyRecipes.ts): the extension
// ships independently of a Vercel deploy.
//
// The key is the HOST, not the career site: a Workday session cookie is
// host-scoped, so /AIA_Careers and /AIA_Campus on one host share an account.
// Keying on the site too would fragment a per-tenant password override and
// re-prompt the user for the same company.

const VENDOR_RULES = [
    { test: /\.myworkdayjobs\.com$|\.myworkdaysite\.com$/i, vendor: 'workday' },
];

const LOCALE_RE = /^[a-z]{2}([-_][A-Za-z]{2})?$/;

/** Vendor for a host, or null when this ATS needs no candidate account. */
export function vendorForHost(host) {
    for (const rule of VENDOR_RULES) {
        if (rule.test.test(host)) return rule.vendor;
    }
    return null;
}

/**
 * Tenant identity for a job/apply URL.
 * → { atsVendor, tenantKey, canonicalHost, careerSiteKey, tenantSlug } or null.
 *
 * Workday paths vary (/en-US/{site}/job/…, /{site}/job/…, /wday/authgwy/{tenant}/…),
 * so the career site is the first segment that is neither a locale nor a
 * structural keyword — not a fixed index.
 */
export function tenantRefFor(url) {
    let parsed;
    try {
        parsed = new URL(String(url || '').trim());
    } catch {
        return null;
    }
    const host = parsed.host.toLowerCase();
    const vendor = vendorForHost(host);
    if (!vendor) return null;

    let careerSiteKey = null;
    for (const seg of parsed.pathname.split('/').filter(Boolean)) {
        if (seg === 'wday' || LOCALE_RE.test(seg)) continue;
        if (seg === 'job' || seg === 'jobs' || seg === 'apply') break;
        careerSiteKey = seg;
        break;
    }
    return {
        atsVendor: vendor,
        tenantKey: host,
        canonicalHost: host,
        careerSiteKey,
        tenantSlug: host.split('.')[0] || host,
    };
}

/**
 * Order a batch so jobs on the same tenant run back to back, preserving the
 * user's ordering within each tenant and keeping non-account jobs where they
 * are relative to the first tenant job.
 *
 * Why it matters: the first job of a tenant does the auth probe and every later
 * job of that tenant inherits the verdict. Adjacency means a tenant that turns
 * out to be blocked is discovered once and skipped in one contiguous run,
 * instead of the user watching the same company fail at intervals.
 */
export function sortJobsByTenant(jobs) {
    const order = [];
    const groups = new Map();
    for (const job of jobs) {
        const key = tenantRefFor(job.jobUrl)?.tenantKey || '';
        if (!groups.has(key)) { groups.set(key, []); order.push(key); }
        groups.get(key).push(job);
    }
    return order.flatMap((key) => groups.get(key));
}
