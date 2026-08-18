/**
 * Workday external candidate application — the form grammar shared by every
 * tenant on the CXS front-end (mdlz, maersk, and counting).
 *
 * This is STRUCTURE, not tenant data: how the workflow is shaped, what signals
 * mark a step, how the agent enters and advances. The number of steps and the
 * exact fields are per-tenant (see tenants/<id>/field-sets) — the grammar is
 * not. Recognise a form by these features, never by a title or a single label.
 */

/** @type {import('../../schema.js').Provenance[]} */
const measuredOn = [
    { tenant: 'mdlz', date: '2026-08-13', traces: ['R-174102', 'R-173186'], result: 'confirmed' },
    { tenant: 'maersk', date: '2026-08-14', traces: ['R173118'], result: 'dry-run' },
];

export const workdayExternalApplication = {
    id: 'workday.external-application',
    platform: 'workday',

    workflow: {
        // The URL does NOT change between steps — .../apply/applyManually stays
        // put; the STEP changes underneath. So step is read from the progress
        // bar / page heading, never from the path.
        navigation: 'same-url-multi-step',
        stateSignals: [
            '[data-automation-id="progressBarActiveStep"]',   // "current step N of M ..."
            '[data-automation-id="pageHeaderTitleText"]',
        ],
        // The CANONICAL page roles. A tenant renders a SUBSET/ORDER of these and
        // may repeat one (Maersk shows Application Questions twice: primary +
        // secondary questionnaire). Count of steps is per-tenant, NOT fixed.
        pageRoles: [
            'my-information',
            'my-experience',
            'application-questions',
            'voluntary-disclosures',
            'review',
        ],
        stepCountIsFixed: false,   // mdlz=5, maersk=6 — the engine must not assume
    },

    entry: {
        // Job posting → application. Same automation-ids on both tenants.
        applyButton: '[data-automation-id="adventureButton"]',
        options: {
            autofillWithResume: '[data-automation-id="autofillWithResume"]',
            applyManually: '[data-automation-id="applyManually"]',
        },
        // Some tenants gate apply behind a candidate account; see the login/
        // signup handling in the engine, not here.
        authGateway: 'per-tenant',
    },

    structuralFeatures: {
        portalListboxes: true,          // options live in a portaled activeListContainer, not inline
        controlledInputs: true,         // React-controlled; setNativeValue + input event
        phasedHydration: true,          // fields arrive in waves after navigation
        repeatableRows: true,           // work / education / languages add & delete rows
        batchedPageSave: true,          // My Experience batches on Save-and-Continue; My Info auto-saves per field
        cxsApi: '/wday/cxs/{tenant}/',  // public REST behind the UI (jobs, skillsearch, values/*)
        advanceButton: '[data-automation-id="pageFooterNextButton"]',
    },

    // The automation-id vocabulary that is stable ACROSS tenants — safe to key
    // fingerprints on. (Field-level ids like formField-skills are per-tenant.)
    stableAutomationIds: [
        'formField-*', 'progressBarActiveStep', 'pageFooterNextButton',
        'selectedItem', 'DELETE_charm', 'activeListContainer', 'promptOption',
        'menuItem', 'multiSelectContainer',
    ],

    measuredOn,
};
