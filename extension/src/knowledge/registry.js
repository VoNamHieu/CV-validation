/**
 * The tenant registry — the ONE place that says which tenants exist and whether
 * the v2 engine is turned on for them. Adding a tenant is a row here + a
 * tenants/<id>/ folder; it is NEVER a new engine or an executor branch.
 *
 * Thin by design: it references tenant overlays, it does not inline them.
 * `enabled` gates the v2 engine; a tenant can be fully harvested (data present)
 * while still served by v1 (enabled: false) until v2 is generalised for it.
 */
import { mdlz } from './tenants/mdlz/index.js';
import { maersk } from './tenants/maersk/index.js';

export const registry = {
    mdlz: {
        ...mdlz,
        enabled: true,    // v2 owns MDLZ (behind its own flag); the proven baseline
    },
    maersk: {
        ...maersk,
        enabled: false,   // harvested + dry-run measured; still served by v1 until v2 is generalised (subdomain tenant, 6 steps, DOB widget)
    },
};

/** The tenant whose signature matches a location, or null. Host + path, never title. */
export function tenantFor(loc = (typeof location !== 'undefined' ? location : null)) {
    if (!loc) return null;
    for (const t of Object.values(registry)) {
        const s = t.signature;
        try {
            if (s.host.test(loc.hostname) && (!s.pathIncludes || loc.pathname.includes(s.pathIncludes))) return t;
        } catch { /* a malformed signature is not a match */ }
    }
    return null;
}
