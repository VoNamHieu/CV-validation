// Canonical identity for an ATS candidate account.
//
// MUST agree with frontend/src/lib/atsTenant.ts — tenantKey is the join key
// between the extension, the backend and the web app. Kept as a separate copy
// on purpose (same arrangement as recipe.js vs applyRecipes.ts): the extension
// ships independently of a Vercel deploy.
//
// The key is the ACCOUNT NAMESPACE, and Workday puts that in two different
// places depending on the host:
//
//   myworkdayjobs.com   →  3m.wd1.myworkdayjobs.com/en-US/Search/job/…
//                          tenant = the SUBDOMAIN. /AIA_Careers and /AIA_Campus
//                          on one host share an account, so the career site is
//                          metadata — keying on it would fragment a per-tenant
//                          password override and re-prompt for the same company.
//
//   myworkdaysite.com   →  wd3.myworkdaysite.com/recruiting/mdlz/External/job/…
//                          tenant = a PATH segment. The host is shared by every
//                          company on that pod.
//
// Reading the host alone collapsed Mondelez, Unilever and everyone else on
// wd3.myworkdaysite.com into ONE account: a credential pinned for one applied to
// all, a verification block at one blocked all, and the per-tenant attempt budget
// that exists to prevent lockouts was spent by the first two companies for
// everybody.

const VENDOR_RULES = [
    { test: /\.myworkdayjobs\.com$/i, vendor: 'workday', shape: 'subdomain' },
    { test: /\.myworkdaysite\.com$/i, vendor: 'workday', shape: 'path' },
    // SAP SuccessFactors career portal (EY measured 2026-08-05). The pod host
    // (career5.successfactors.eu) is shared by every company on that DC — the
    // account namespace is the `company` query param (?company=EYHRISPRD1),
    // present on every portal page from the sign-in wall onwards. The RMK
    // marketing site in front (careers.ey.com) needs no account and stays
    // out of these rules on purpose.
    { test: /(^|\.)career\d*\.successfactors\.(eu|com)$/i, vendor: 'successfactors', shape: 'query-company' },
];

const LOCALE_RE = /^[a-z]{2}([-_][A-Za-z]{2})?$/;
/** Path segments that are Workday plumbing, never a tenant or a career site. */
const STRUCTURAL = new Set(['wday', 'recruiting', 'authgwy', 'en', 'd']);

/** Vendor for a host, or null when this ATS needs no candidate account. */
export function vendorForHost(host) {
    return _ruleFor(host)?.vendor || null;
}

function _ruleFor(host) {
    return VENDOR_RULES.find(r => r.test.test(host)) || null;
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
    const rule = _ruleFor(host);
    if (!rule) return null;

    if (rule.shape === 'query-company') {
        // careerN.successfactors.eu/careers?company=<TENANT> — the param IS the
        // account namespace. A portal URL without it (mid-flow POST targets) is
        // not a scope we can name; decline rather than invent a shared one.
        const company = (parsed.searchParams.get('company') || '').trim().toLowerCase();
        if (!company) return null;
        return {
            atsVendor: rule.vendor,
            tenantKey: `${host}/${company}`,
            canonicalHost: host,
            careerSiteKey: null,
            tenantSlug: company,
        };
    }

    // Meaningful path segments, in order, with plumbing and locales removed and
    // everything from /job onwards dropped.
    const segs = [];
    for (const seg of parsed.pathname.split('/').filter(Boolean)) {
        if (seg === 'job' || seg === 'jobs' || seg === 'apply') break;
        if (STRUCTURAL.has(seg.toLowerCase()) || LOCALE_RE.test(seg)) continue;
        segs.push(seg);
    }

    let tenantKey, tenantSlug, careerSiteKey;
    if (rule.shape === 'path') {
        // wd3.myworkdaysite.com/recruiting/<tenant>/<site>/job/…
        const slug = segs[0] || '';
        careerSiteKey = segs[1] || null;
        // No tenant segment (a bare pod URL) is not an account scope we can
        // name, so we decline rather than inventing a shared one.
        if (!slug) return null;
        tenantSlug = slug.toLowerCase();
        tenantKey = `${host}/${tenantSlug}`;
    } else {
        // <tenant>.wdN.myworkdayjobs.com/<locale>/<site>/job/…
        tenantKey = host;
        tenantSlug = host.split('.')[0] || host;
        careerSiteKey = segs[0] || null;
    }

    return { atsVendor: rule.vendor, tenantKey, canonicalHost: host, careerSiteKey, tenantSlug };
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
