/**
 * How to recognise MDLZ, and how to derive its tenant id for the CXS API.
 * Recognition is by host + path, never by a page title.
 */
export const mdlzSignature = {
    id: 'mdlz',
    platform: 'workday',
    archetype: 'workday.external-application',
    host: /(^|\.)myworkdaysite\.com$/i,
    pathIncludes: '/recruiting/mdlz/',
    site: 'External',
    // tenant id for /wday/cxs/{tenant}/… — here it IS in the path.
    tenantFrom: { source: 'path', pattern: /\/(?:recruiting|cxs)\/([^/]+)\//, value: 'mdlz' },
};
