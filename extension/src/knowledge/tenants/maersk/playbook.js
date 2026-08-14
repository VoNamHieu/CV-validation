/**
 * Maersk playbook — largely INHERITED from the Workday archetype; only the
 * deltas are worth stating. Kept as a thin overlay to prove the point: a second
 * Workday tenant reuses the platform playbook and specialises little.
 */
export const maerskPlaybook = {
    archetype: 'workday.external-application',
    tenant: 'maersk',
    inherits: 'tenants/mdlz/playbook (platform-shared parts) — advance gate, popup policy, one-task-at-a-time, no-add-on-blank-row all apply unchanged',

    deltas: {
        steps: 6,
        pageRoles: ['my-information', 'my-experience', 'application-questions×2', 'voluntary-disclosures', 'review'],
        disclosuresNeedDateWidget: true,   // the one capability the shared playbook does not yet cover cleanly
    },

    advanceGate: 'same as platform: no open popup, no required blocker, fresh verify, block submit without user confirmation',

    status: 'dry-run only — ran end-to-end under v1 to Review; v2 not yet enabled for this tenant',
};
