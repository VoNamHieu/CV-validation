/**
 * calendar-date — a Workday date field. Two measured shapes: a month/year
 * picker (work From/To) and a segmented month/day/year spin-input (Date of
 * Birth, measured on Maersk Voluntary Disclosures).
 *
 * The segmented DOB was v1's ~3-minute loop. Its structure and commit path are
 * now MEASURED (Maersk R173118, 2026-08-14, read-only fiber probe); the WRITE is
 * not yet live-committed by v2, so the segmented shape stays `unverified` on the
 * execution side while its DOM is no longer a guess.
 */

/** @type {import('../../../schema.js').Capability} */
export const calendarDate = {
    id: 'calendar-date',

    fingerprint: {
        monthYearPicker: 'spinbutton-based month/year panel with prev/next arrows',
        segmentedInput: 'three role=spinbutton <input>s, data-automation-id dateSection{Month,Day,Year}-input, '
            + 'each a CONTROLLED React input (props: value, onChange, onKeyDown, onFocus; aria-valuemin/max/now, aria-required)',
        cardinality: 'one',
    },

    activate: ['month/year: open panel, step arrows to the target year, click the month cell',
        'segmented: focus each segment input (no panel to open)'],
    read: ['month/year cell: aria-valuenow, NOT .value',
        'segmented: BOTH .value AND aria-valuenow carry the number once committed (measured value="3"/aria-valuenow="3") — '
        + 'the .value==="" reading is the SYMPTOM OF A REJECTED WRITE, not the committed state'],
    decide: 'the CV date, split to the widget\'s segments; map each part by the segment\'s aria-label (Month/Day/Year), '
        + 'NEVER by position — another tenant may render DD/MM/YYYY',
    commit: ['month/year: click the target cell',
        'segmented: per segment, focus → setNativeValue(number) → dispatch a native input event so React\'s value-tracker '
        + 'fires onChange (the same primitive the text executor uses); keyboard digits / ArrowUp-Down (onKeyDown) is the fallback'],
    verify: 'aria-valuenow === the target part, per segment (bounded by aria-valuemin/max: Month 1-12, Day 1-31)',
    recovery: ['re-focus + re-write the failing segment', 'keyboard-step fallback if the native-event write is rejected'],

    invariants: [
        'the segmented DOB is a CONTROLLED input: a bare .value assignment without a dispatched input event is rejected and reads back "" — that empty read is EXACTLY what looped v1, mistaken for "not committed yet"',
        'segment order is read from aria-label, not assumed',
        'month/year picker cells DO read aria-valuenow not .value — the two shapes differ, so do not carry one shape\'s read rule to the other',
    ],
    antiPatterns: ['assigning .value without a React-visible input event (v1\'s DOB loop)',
        'assuming MM/DD/YYYY order', 'patching one date-widget variant at a time'],

    measuredOn: [
        { tenant: 'mdlz', date: '2026-08-03', traces: ['R-174102'], result: 'confirmed' },   // month/year picker
        { tenant: 'maersk', date: '2026-08-14', traces: ['R173118'], result: 'structure-measured' },  // DOB segmented: DOM + fiber read; write not yet live
    ],
    confidence: 2,
    status: 'unverified',
    todo: 'Segmented executor BUILT + harness-verified (date.commit segmented path; page-disclosures answerDateOfBirth; parseDob '
        + 'refuses ambiguous dates → gap not guess). Still unverified because the WRITE has not been live-committed on Maersk — '
        + 'the harness proves setNativeValue reflects in aria-valuenow, a real run proves Workday accepts it. Live-commit once → confirmed.',
};
