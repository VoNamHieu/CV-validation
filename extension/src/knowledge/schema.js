/**
 * The shapes every knowledge entry follows, and the guard that keeps the
 * library honest: no entry without provenance.
 *
 * These are JSDoc typedefs (documentation, zero runtime cost) plus a single
 * `validate()` the test calls — the executable form of the README's law
 * "provenance is mandatory".
 */

/**
 * @typedef {Object} Provenance      Where a claim was MEASURED. Never inferred.
 * @property {string} tenant         e.g. 'mdlz'
 * @property {string} date           ISO day, e.g. '2026-08-13'
 * @property {string[]} [traces]     requisition / run ids the claim was read off
 * @property {'confirmed'|'flagged'|'dry-run'} result
 */

/**
 * @typedef {Object} Capability      A widget family's interaction contract.
 * @property {string} id
 * @property {Object} fingerprint    the runtime shape that resolves TO this capability
 * @property {string[]} activate     the open/type/submit sequence, in order
 * @property {string[]} read         option sources, PRIMARY first
 * @property {string} [decide]       how the target is chosen
 * @property {string[]} commit       how a value is written, primary first
 * @property {string} verify         the one signal that proves commit
 * @property {string[]} [recovery]   the ladder when the primary path fails
 * @property {string[]} invariants   laws measured true of this widget
 * @property {string[]} [antiPatterns] things measured to NOT work
 * @property {Provenance[]} measuredOn
 * @property {number} confidence     = count of tenants that confirmed it
 * @property {'confirmed'|'unverified'} status
 */

/**
 * @typedef {Object} Slot            WHAT a field means (never HOW it commits).
 * @property {string} id             e.g. 'skills[]'
 * @property {string} source         where the value comes from in the CV
 * @property {'one'|'many'} cardinality
 * @property {'closed-taxonomy'|'exact-or-custom'|'tenant-ladder'|'free'} vocabulary
 * @property {'exact-only'|'normalize-before-execution'|'verbatim'} taxonomyPolicy
 * @property {string} capability     which Capability.id fills it
 */

const nonEmpty = (a) => Array.isArray(a) && a.length > 0;

/** Assert every entry that must carry provenance does. Throws with the path. */
export function validate({ registry, capabilities, archetypes }) {
    const errors = [];
    for (const cap of Object.values(capabilities || {})) {
        if (!nonEmpty(cap.measuredOn)) errors.push(`capability ${cap.id}: no measuredOn`);
        if (cap.status === 'confirmed' && (cap.confidence ?? 0) < 1) errors.push(`capability ${cap.id}: confirmed but confidence < 1`);
        if (!nonEmpty(cap.invariants)) errors.push(`capability ${cap.id}: no invariants`);
    }
    for (const a of Object.values(archetypes || {})) {
        if (!nonEmpty(a.measuredOn)) errors.push(`archetype ${a.id}: no measuredOn`);
    }
    for (const t of Object.values(registry || {})) {
        if (!t.signature) errors.push(`tenant ${t.id}: no signature`);
        if (!nonEmpty(t.evidence?.measuredOn)) errors.push(`tenant ${t.id}: no evidence.measuredOn`);
    }
    if (errors.length) throw new Error('knowledge validation failed:\n  ' + errors.join('\n  '));
    return true;
}
