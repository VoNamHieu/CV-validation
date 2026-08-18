/**
 * The fields MDLZ renders per page, as measured. This is the tenant-specific
 * WHERE inventory — the engine observes the live page, but this is the ground
 * truth to diff a run against and to diff OTHER tenants against.
 *
 * 5 steps. Measured R-174102 / R-173186, 2026-08.
 */
export const mdlzFieldSets = {
    steps: 5,
    pages: {
        'my-information': {
            step: 1,
            fields: [
                { id: 'source', kind: 'portal-listbox-select', required: true },
                { id: 'candidateIsPreviousWorker', kind: 'radio-label', required: true },
                { id: 'country', kind: 'portal-listbox-select', required: true },
                { id: 'legalName--lastName', kind: 'controlled-text', required: true },
                { id: 'legalName--firstName', kind: 'controlled-text', required: true },
                { id: 'legalName--lastNameLocal', kind: 'controlled-text', required: false },
                { id: 'legalName--firstNameLocal', kind: 'controlled-text', required: false },
                { id: 'preferredCheck', kind: 'checkbox-controlled', required: false },
                { id: 'addressLine1', kind: 'controlled-text', required: true },
                { id: 'city', kind: 'controlled-text', required: true },   // "District or Town"
                { id: 'countryRegion', kind: 'portal-listbox-select', required: true },   // "Province or City"
                { id: 'postalCode', kind: 'controlled-text', required: true },
                { id: 'phoneType', kind: 'portal-listbox-select', required: true },
                { id: 'countryPhoneCode', kind: 'chip-search', required: true },   // single-token chip search
                { id: 'phoneNumber', kind: 'controlled-text', required: true },
            ],
        },
        'my-experience': {
            step: 2,
            sections: ['workExperience', 'education', 'languages', 'skills', 'resume', 'websites'],
            slots: ['education[].fieldOfStudy', 'education[].degree.level', 'languages[]', 'skills[]'],
            notes: 'batched save; skills = chip-search-multi; degree = ladder; language rows = repeatable.',
        },
        'application-questions': { step: 3, count: 1 },
        'voluntary-disclosures': {
            step: 4,
            fields: [
                { id: 'gender', kind: 'portal-listbox-select', required: true },
                { id: 'ethnicity', kind: 'portal-listbox-select', required: false },   // sometimes absent
                { id: 'acceptTerms', kind: 'checkbox-controlled', required: true },
            ],
        },
        'review': { step: 5, readOnly: true },
    },
};
