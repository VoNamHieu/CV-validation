/**
 * ONE text normalizer for every match on this engine.
 *
 * `fold` was copy-pasted into four files with THREE different rules — executors
 * and planner collapsed whitespace, disclosures trimmed but did not collapse,
 * review only lower-cased — so "École  Polytechnique" folded to three different
 * strings depending on which file compared it, and page-questions called `fold`
 * without defining OR importing it at all (a latent ReferenceError on the
 * checkbox-group path). One definition, imported everywhere, ends all of that.
 *
 * The canonical rule is the strictest of the three (executors/planner), because
 * it is the one every matcher was already trusting for the fields that matter:
 * trim the ends, lower the case, and collapse any run of whitespace to one
 * space. Nothing here is lossy in a way a human reading the label would notice —
 * it only erases the differences a keyboard makes by accident.
 */
export const fold = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The WORD-BAG key of a label — its words, punctuation-blind and order-blind.
 *
 * Measured on the live PwC field-of-study catalogue (2026-08-15): it carries BOTH
 * "Management and Marketing" and "Marketing and Management" — the same field, two
 * orderings — and a candidate's "Marketing & Management" would fold-differ from
 * either. `foldTokens` erases exactly those accidents: it folds, reads "&" as the
 * word "and", drops every non-alphanumeric character, and SORTS the words. Same
 * words in any order → same key.
 *
 * It is a MULTISET, not a set — the sort keeps duplicates — so a label is never
 * silently equated with a shorter one that merely reuses its words. And it is a
 * key, never a fuzzy score: two labels share it or they do not.
 */
export const foldTokens = (s) => fold(s)
    .replace(/&/g, ' and ')
    // DELETED, not spaced: a dotted abbreviation must collapse ("b.b.a." → "bba",
    // so it meets "BBA"), while a comma or slash already carries its own adjacent
    // space and so keeps the word boundary either way.
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');

/**
 * Are these two labels the SAME concept — an exact match, widened only by the
 * accidents `foldTokens` erases (case, spacing, punctuation, word order)?
 *
 * This is the ceiling of what may be trusted WITHOUT a human: it never reaches a
 * near-match. "Marketing" and "Digital Marketing" are a different number of words
 * → different bag → NOT the same, and must stay a gap the candidate answers, not
 * a specialization put on their record. The name says "same concept" on purpose:
 * a caller must not read it as "close enough".
 */
export const sameConcept = (a, b) => {
    const fa = fold(a);
    const fb = fold(b);
    if (!fa || !fb) return false;
    return fa === fb || foldTokens(a) === foldTokens(b);
};
