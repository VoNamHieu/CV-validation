/**
 * chip-search-multi — the Skills-family widget: type a term, a virtualised
 * listbox appears, a chip is added; many chips accumulate. The hardest widget
 * on the platform and the one three weeks bought outright. Everything measured
 * about it lives here; the engine's searchMulti implements it.
 */

/** @type {import('../../../schema.js').Capability} */
export const chipSearchMulti = {
    id: 'chip-search-multi',

    fingerprint: {
        container: '[data-automation-id="multiSelectContainer"], [data-uxi-widget-type="multiselect"]',
        input: 'combobox',
        cardinality: 'many',
        // Chosen by the PLAN's contract (capability+cardinality), not by the
        // fingerprint alone: a single-select chip-search (Field of Study) is
        // byte-identical in the DOM. See slots/ for who routes to which.
        routedByContract: true,
    },

    activate: [
        'input.focus() + input.click()   // a real click OPENS the list; focus+value alone opens nothing',
        'type the term char-by-char (setNativeValue + input event)',
        'pressEnter   // SUBMITS the skillsearch query — not a commit',
    ],

    // PRIMARY first. The API is the only complete, visibility-independent read.
    read: [
        'skillsearch API  — GET /wday/cxs/{tenant}/skillsearch?search=TERM (network, not throttled hidden)',
        'React fiber props.items  — RECOVERY only; isolated-world content script sees null, needs the MAIN-world bridge',
        'DOM / ARIA rows  — FALLBACK; virtualised, reaches only what painted (~2-11 of 16 hidden)',
    ],

    decide: 'exact catalog row → pick it (structured id wins); else the candidate\'s VERBATIM create row. '
        + 'Never a near/substring/semantic match — "Agile" must not become "Agile Framework" or "Agile/Scrum".',

    // PRIMARY first; both judged by the same verifier.
    commit: [
        'label-identity click  — the checkbox of the ONE live row whose label is unique in the NEWEST list',
        'fiber onSelect data-write  — onSelect([...values, {label, id}]) via the MAIN-world bridge, when the row will not render (hidden tail, pos 16) or same-text twins make no DOM node trustworthy',
    ],

    verify: 'exactly ONE fresh chip that reads (fold-equal) as the picked label. '
        + 'Several → AMBIGUOUS (a group row), reported, chips kept. One DIFFERENT chip → our misfire, rolled back via the DELETE_charm (mousedown-led); a rollback that does not stick → ROLLBACK_FAILED (safety-fatal, never advance over it).',

    recovery: ['api-read', 'label-identity-click', 'fiber-write'],

    invariants: [
        'the CREATE row is always LAST; on a padded tenant every exact term also has a create-twin of the same text',
        'API order ≠ UI order → index is scroll-only, never identity',
        'a chip commits by discrete event (click / React state commit) even while hidden — only PAINT is throttled',
        'nothing removes a PRE-EXISTING chip: it may be the candidate\'s own from another application',
    ],

    antiPatterns: [
        'clicking the row at the API index (wrong skill when the UI reordered)',
        'semantic mapping a CV term to a different catalog skill (rewrites the candidate\'s claim)',
        'row.click() to commit (no-op — the checkbox inside commits) / bare .click() on DELETE_charm (no-op)',
        'trusting a substring match ("contains the term")',
    ],

    measuredOn: [
        { tenant: 'mdlz', date: '2026-08-13', traces: ['R-174102', 'R-173186'], result: 'confirmed' },
    ],
    confidence: 1,               // MDLZ only — Maersk has no catalog, has not re-exercised the twin/tail path
    status: 'unverified',        // promote to confirmed when a 2nd catalog tenant reuses it unchanged
};
