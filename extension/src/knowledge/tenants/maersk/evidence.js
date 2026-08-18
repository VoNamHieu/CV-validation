/**
 * Maersk provenance — one dry-run, observe-and-measure, no data written to a
 * real submission beyond an unsubmitted draft. The second data point in the
 * library, and the first flywheel turn.
 */
export const maerskEvidence = {
    measuredOn: [
        { tenant: 'maersk', date: '2026-08-14', traces: ['R173118'], result: 'dry-run' },
    ],
    run: {
        requisition: 'R173118 — Customer Experience Agent, Vietnam/Ho Chi Minh',
        engine: 'v1 recipe (workday v18) — v2 stands down on non-mdlz by design',
        outcome: 'filled → Review (6/6), Policy stopped the step advance — awaiting user submit',
        wallClock: '~5 min',
        weakestPoint: 'dateOfBirth segmented widget — ~3 min of loop (iters ~8-25) before self-escaping to advance',
        caveats: 'the uploaded CV was HSE_Specialist.pdf (a stale test CV) against a CX Agent role — the draft is a measurement artefact, not for submission',
    },
    cxs: {
        jobsEndpoint: '/wday/cxs/maersk/Maersk_Careers/jobs (public, POST) — 1229 postings',
        skillsearch: '/wday/cxs/maersk/skillsearch → create-only, {id, descriptor}, create row last',
    },
    // The diff-vs-MDLZ that this whole harvest exists to capture.
    diffVsMdlz: {
        confirmedGeneric: ['portal-listbox-select', 'controlled-text', 'radio-label', 'checkbox-controlled', 'hidden-file-upload', 'repeatable-rows', 'the archetype grammar', 'entry buttons', 'advance gate'],
        tenantSpecific: ['6 steps (double questions)', 'richer field-sets (title, middle names, local address, DOB, nationality, disabilities)', 'skillsearch create-only', 'subdomain tenant'],
        newCapabilityNeeded: ['calendar-date segmented (DOB)'],
    },
};
