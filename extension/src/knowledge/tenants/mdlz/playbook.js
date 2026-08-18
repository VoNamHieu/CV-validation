/**
 * MDLZ playbook — the specialised "how to solve THIS form" orchestration. This
 * is where tenant-specific ORDER and POLICY are allowed to live (unlike
 * capabilities, which must stay tenant-agnostic). Most of it is already encoded
 * in the engine's page controllers + scheduler; this is the declarative mirror
 * so a second Workday tenant can start from it and diff.
 */
export const mdlzPlaybook = {
    archetype: 'workday.external-application',
    tenant: 'mdlz',

    pages: {
        'my-information': {
            sectionOrder: ['source', 'previousEmployment', 'country', 'legalName', 'address', 'phone'],
        },
        'my-experience': {
            sectionOrder: ['workExperience', 'education', 'languages', 'skills', 'resume', 'websites'],
            policies: {
                oneTaskAtATime: true,
                closePopupBetweenTasks: true,        // popups leak into the next task otherwise
                doNotAddWhenBlankRowExists: true,
                replanAfterRowMutation: true,
            },
        },
    },

    advanceGate: {
        requireNoOpenPopup: true,
        requireNoRequiredBlocker: true,
        requireFreshVerification: true,
        blockSubmitWithoutUserConfirmation: true,   // the agent stops at Review, awaiting user submit — always
    },
};
