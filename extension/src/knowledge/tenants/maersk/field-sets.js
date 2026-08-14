/**
 * Maersk field inventory, measured on a dry-run 2026-08-14 (R173118, Customer
 * Experience Agent, Ho Chi Minh). 6 STEPS — Application Questions appears TWICE
 * (primary + secondary questionnaire). Diff against tenants/mdlz to see exactly
 * what is tenant-specific vs platform.
 */
export const maerskFieldSets = {
    steps: 6,
    pages: {
        'my-information': {
            step: 1,
            // vs MDLZ: + legalName--title (Prefix), + middle names, + LOCAL address lines.
            fields: [
                { id: 'source', kind: 'portal-listbox-select', required: true },
                { id: 'candidateIsPreviousWorker', kind: 'radio-label', required: true },
                { id: 'country', kind: 'portal-listbox-select', required: true },
                { id: 'legalName--title', kind: 'portal-listbox-select', required: false },   // "Prefix" — NEW vs MDLZ
                { id: 'legalName--lastName', kind: 'controlled-text', required: true },
                { id: 'legalName--firstName', kind: 'controlled-text', required: false },
                { id: 'legalName--middleName', kind: 'controlled-text', required: false },     // NEW
                { id: 'legalName--lastNameLocal', kind: 'controlled-text', required: false },
                { id: 'legalName--firstNameLocal', kind: 'controlled-text', required: false },
                { id: 'legalName--middleNameLocal', kind: 'controlled-text', required: false }, // NEW
                { id: 'preferredCheck', kind: 'checkbox-controlled', required: false },
                { id: 'addressLine1Local', kind: 'controlled-text', required: false },          // NEW (local address)
                { id: 'cityLocal', kind: 'controlled-text', required: false },                  // NEW
                { id: 'addressLine1', kind: 'controlled-text', required: true },
                { id: 'city', kind: 'controlled-text', required: true },
                { id: 'countryRegion', kind: 'portal-listbox-select', required: true },
                { id: 'postalCode', kind: 'controlled-text', required: false },                 // NOT required (MDLZ: required)
                { id: 'phoneType', kind: 'portal-listbox-select', required: true },
                { id: 'countryPhoneCode', kind: 'chip-search', required: true },
                { id: 'phoneNumber', kind: 'controlled-text', required: true },
            ],
        },
        'my-experience': {
            step: 2,
            sections: ['workExperience', 'education', 'languages', 'skills', 'resume'],
            slots: ['education[].degree.level', 'languages[]', 'skills[]'],
            notes: 'filled=25 on the dry-run. Skills: skillsearch has NO catalog here (create-only), so every skill is free text at index 0 — simpler than MDLZ.',
        },
        'application-questions-primary': { step: 3, count: 'primary questionnaire' },
        'application-questions-secondary': { step: 4, count: 'secondary questionnaire — the extra step vs MDLZ' },
        'voluntary-disclosures': {
            step: 5,
            // vs MDLZ: much richer.
            fields: [
                { id: 'gender', kind: 'portal-listbox-select', required: true },
                { id: 'dateOfBirth', kind: 'calendar-date', required: true, note: 'segmented day/month/year — the widget v1 looped ~3min on; v2 gap to close' },
                { id: 'nationality', kind: 'portal-listbox-select', required: true },           // NEW
                { id: 'additionalNationalities', kind: 'chip-search', required: false },         // NEW
                { id: 'disabilities', kind: 'portal-listbox-select', required: false },          // NEW
                { id: 'acceptTermsAndAgreements', kind: 'checkbox-controlled', required: true },
            ],
        },
        'review': { step: 6, readOnly: true },
    },
};
