/**
 * MDLZ provenance — the receipts. Every claim in the other MDLZ files traces
 * back to something here. This is the first proven case in the library.
 */
export const mdlzEvidence = {
    measuredOn: [
        { tenant: 'mdlz', date: '2026-08-07', traces: ['smsik0vk4pw1h46'], result: 'confirmed' },   // hidden-tab throttle first measured
        { tenant: 'mdlz', date: '2026-08-09', traces: ['R-174102'], result: 'confirmed' },           // chip-search mechanics
        { tenant: 'mdlz', date: '2026-08-13', traces: ['R-174102', 'R-173186'], result: 'confirmed' }, // fiber-write, skillsearch, twins
        { tenant: 'mdlz', date: '2026-08-14', traces: ['R-169319', 'R-173186'], result: 'confirmed' }, // end-to-end hidden → Review
    ],
    engineBaseline: {
        sha: '8f1e1fb',
        note: 'live-pass visible + hidden to Review; 737 tests. Any shared change must keep this green.',
    },
    catalogSamples: {
        skillsearch: {
            'unit economics': 'not a catalog skill → 16 economics rows + create; maps to nothing exact',
            'Customer Lifetime Value': 'exact catalog, index 0',
            'Agentic AI': 'exact catalog, index 0 (whereas "Agentic Systems" is not exact)',
        },
    },
    knownRequisitions: ['R-172396 (Procurement)', 'R-169319 (Sales Supervisor)', 'R-173186 (SEA Supply Chain)', 'R-174102 (measurement rig)'],
};
