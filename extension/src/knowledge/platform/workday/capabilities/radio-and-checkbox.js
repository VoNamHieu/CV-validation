/**
 * radio-and-checkbox — the two small boolean/choice families. Kept in one file
 * because they share a law (click the CONTROL, verify the CONTROL, decline via
 * the neutral option) and neither is big enough to earn its own; split them the
 * day one grows a real second behaviour.
 */

/** @type {import('../../../schema.js').Capability} */
export const radioLabel = {
    id: 'radio-label',
    fingerprint: { control: 'input[type=radio] within a labelled group', cardinality: 'one' },
    activate: ['click the RADIO inside the target row — not the row, not the label wrapper'],
    read: ['which radio is :checked'],
    decide: 'the option matching the CV answer; "Not Specified"/neutral = a decline, used when no answer applies',
    commit: ['click the radio in the matching row'],
    verify: 'the intended radio is checked',
    recovery: ['re-click'],
    invariants: ['click the radio control in the row; clicking the row text can miss on a virtualised group'],
    antiPatterns: ['clicking the group container'],
    measuredOn: [
        { tenant: 'mdlz', date: '2026-08-01', traces: ['R-174102'], result: 'confirmed' },
        { tenant: 'maersk', date: '2026-08-14', traces: ['R173118'], result: 'dry-run' },
    ],
    confidence: 2,
    status: 'confirmed',   // candidateIsPreviousWorker "Yes" on both
};

/** @type {import('../../../schema.js').Capability} */
export const checkboxControlled = {
    id: 'checkbox-controlled',
    fingerprint: { control: 'input[type=checkbox]', cardinality: 'one' },
    activate: ['click the checkbox'],
    read: ['.checked'],
    decide: 'boolean from the CV / the acknowledgement it gates',
    commit: ['click to reach the desired checked state (never toggle blindly)'],
    verify: '.checked equals the target',
    recovery: ['re-click'],
    invariants: ['read .checked, set to the TARGET state, do not toggle'],
    antiPatterns: ['toggling without reading current state'],
    measuredOn: [
        { tenant: 'mdlz', date: '2026-08-01', traces: ['R-174102'], result: 'confirmed' },
        { tenant: 'maersk', date: '2026-08-14', traces: ['R173118'], result: 'dry-run' },
    ],
    confidence: 2,
    status: 'confirmed',   // preferredCheck / acceptTermsAndAgreements on both
};
