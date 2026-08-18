/**
 * Maersk recognition — the first tenant whose id is in the SUBDOMAIN, not the
 * path. This is the concrete reason the engine's tenant derivation must not be
 * a single path regex.
 */
export const maerskSignature = {
    id: 'maersk',
    platform: 'workday',
    archetype: 'workday.external-application',
    host: /^maersk\.wd3\.myworkdayjobs\.com$/i,
    pathIncludes: '/Maersk_Careers/',   // this is the SITE segment, not the tenant
    site: 'Maersk_Careers',
    // tenant id for /wday/cxs/{tenant}/… comes from the SUBDOMAIN here.
    tenantFrom: { source: 'subdomain', value: 'maersk' },
    warning: 'the current fetchSkillOptions regex /\\/(recruiting|cxs)\\/([^/]+)\\// matches the PATH and would return "Maersk_Careers" or fall back to "mdlz" — wrong for Maersk. Derive from subdomain or the cxs URL.',
};
