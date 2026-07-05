// Verbatim containment check: is `quote` copied straight from `sourceText`?
//
// Whitespace- and accent-insensitive so trivial reformatting (a collapsed
// double space, a stripped bullet marker) still counts as verbatim, while any
// genuine wording change does not.

import { normText } from "@/lib/verify/facts";

/** True when the normalized `quote` appears as a substring of the normalized source. */
export function assertVerbatim(quote: string, sourceText: string): boolean {
    const q = normText(quote);
    if (!q) return true; // empty/whitespace quote is vacuously present
    return normText(sourceText).includes(q);
}
