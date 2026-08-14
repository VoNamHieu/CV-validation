/**
 * calendar-date — a Workday date field. Two measured shapes: a month/year
 * picker (work From/To) and a segmented day/month/year spin-input (Date of
 * Birth, seen first on Maersk Voluntary Disclosures).
 *
 * STATUS unverified + INCOMPLETE: the engine's v1 recipe looped ~3 minutes on
 * Maersk's DOB before self-escaping. This entry is the placeholder that says
 * "measure this properly on the next date field", with what is known so far.
 */

/** @type {import('../../../schema.js').Capability} */
export const calendarDate = {
    id: 'calendar-date',

    fingerprint: {
        monthYearPicker: 'spinbutton-based month/year panel with prev/next arrows',
        segmentedInput: 'day / month / year segments, aria-valuenow per segment',
        cardinality: 'one',
    },

    activate: ['month/year: open panel, step arrows to the target year, click the month cell',
        'segmented: focus each segment, set its value'],
    read: ['aria-valuenow on the committed segment/cell — NOT .value (a committed date reads .value === "")'],
    decide: 'the CV date, split to the widget\'s segments',
    commit: ['month/year: click the target cell', 'segmented: type/step each segment'],
    verify: 'aria-valuenow equals the target (the .value trap: it stays empty while aria carries the number)',
    recovery: ['re-open', 're-step'],

    invariants: [
        'a committed date reads aria-valuenow, not .value — reading .value made every picked date look "not committed" (v1\'s first false-fail)',
    ],
    antiPatterns: ['verifying a date by .value', 'patching one date-widget variant at a time (v1\'s DOB loop)'],

    measuredOn: [
        { tenant: 'mdlz', date: '2026-08-03', traces: ['R-174102'], result: 'confirmed' },   // month/year picker
        { tenant: 'maersk', date: '2026-08-14', traces: ['R173118'], result: 'dry-run' },     // DOB segmented — NOT yet clean
    ],
    confidence: 1,
    status: 'unverified',
    todo: 'measure Maersk DOB segmented-input properly; it is the concrete gap v2-on-Maersk must close (the ~3-min loop).',
};
