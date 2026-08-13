/**
 * skill-resolve.js — turn a CV skill into a term the Mondelez catalogue commits
 * RELIABLY in a hidden tab.
 *
 * Measured live (2026-08-13, tenant mdlz): the Skills widget is a virtualised
 * checkbox list. While the tab is HIDDEN the virtualiser paints only the first
 * ~2 rows and never the tail (its own viewport collapses to ~1px because layout
 * is deferred), and a chip commits ONLY by clicking a row that is painted. An
 * exact CATALOG row lands at index 0; the free-text "create" row is always LAST
 * and, on any list longer than the render window, never paints — the whole of
 * "Skills hung at position 16".
 *
 * So the rule is: type a term skillsearch answers with an exact catalog row at
 * the TOP, or do not type it. resolveSkillToMdlz enforces exactly that.
 *
 * skillsearch is the ORACLE, never a static guess — canonical spellings differ
 * from natural phrasing in ways no map predicts ("pricing strategy" → "Pricing
 * Strategies", "lifetime value" → "Customer Lifetime Value"). Every taxonomy
 * candidate is re-verified against the live endpoint before it is used, so a
 * wrong or renamed entry self-rejects instead of committing the wrong skill.
 */

const fold = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
// fetchSkillOptions hands back {label, id, index}; a catalog row's id is the
// tenant's REMOTE_SKILL-… while the create row's id EQUALS its label.
const labelOf = (r) => (r && (r.label ?? r.descriptor ?? r.ariaLabel)) || '';
const isCatalog = (r) => !!r && String(r.id) !== String(labelOf(r));

// Only rows 0..RENDER_SAFE paint reliably in a hidden tab (measured floor: two
// rows, indices 0 and 1). A match past this is treated as unreachable.
export const RENDER_SAFE = 1;

/**
 * CV phrasing → ranked canonical Mondelez skills. A HINT only: each candidate is
 * verified against skillsearch before use. Seeded from live verification
 * (2026-08-13); grow it as real gaps surface. Keys are folded (lower-case,
 * single-spaced). Terms the CV already writes the catalogue's own way need NO
 * entry here — the direct probe (step 1) handles them.
 */
export const SKILL_TAXONOMY = {
    // Unit-economics family — "unit economics" itself is NOT an MDLZ skill; it
    // resolves to the metrics that carry the meaning, both verified at index 0.
    'unit economics': ['Customer Lifetime Value', 'Contribution Margin'],
    'economy unit': ['Customer Lifetime Value', 'Contribution Margin'],
    'economics optimization': ['Contribution Margin', 'Profitability Analysis'],
    'ltv': ['Customer Lifetime Value'],
    'lifetime value': ['Customer Lifetime Value'],   // bare "lifetime value" is not exact
    'cac': ['Customer Acquisition Cost'],
    // Spellings that differ from the natural phrasing (verified mismatches).
    'pricing strategy': ['Pricing Strategies'],
    'margin analysis': ['Profit Margin Analysis'],
};

/**
 * The catalogue's own spelling for `probe` if skillsearch puts an exact catalog
 * row inside the paintable window, else null.
 */
function exactCatalogAtTop(rows, probeFolded) {
    if (!rows || !rows.length) return null;
    const limit = Math.min(rows.length, RENDER_SAFE + 1);
    for (let i = 0; i < limit; i++) {
        if (isCatalog(rows[i]) && fold(labelOf(rows[i])) === probeFolded) return labelOf(rows[i]);
    }
    return null;
}

/**
 * Resolve one CV skill to a hidden-safe MDLZ term.
 *
 * @param {string} term  the CV's skill text
 * @param {{fetchOptions:(t:string)=>Promise<Array|null>, taxonomy?:object}} deps
 * @returns {{status:'ok', canonical:string, via:string, input:string}
 *          |{status:'flag', reason:string, input:string}
 *          |{status:'empty', input:*}}
 */
export async function resolveSkillToMdlz(term, { fetchOptions, taxonomy = SKILL_TAXONOMY } = {}) {
    const raw = String(term ?? '').trim();
    if (!raw) return { status: 'empty', input: term };
    if (typeof fetchOptions !== 'function') return { status: 'flag', input: raw, reason: 'no skillsearch fetcher' };
    const want = fold(raw);

    // 1. The CV already wrote the catalogue's own word — type it as-is.
    const rawRows = await fetchOptions(raw);
    const direct = exactCatalogAtTop(rawRows, want);
    if (direct) return { status: 'ok', canonical: direct, via: 'direct', input: raw };

    // Oracle unreachable (network blip) — do NOT guess and do NOT flag. Keep the
    // CV's term so the engine's DOM path still tries it, exactly as it did before
    // skillsearch existed. Never worse than the old behaviour on a bad network.
    if (rawRows === null) return { status: 'ok', canonical: raw, via: 'unresolved', input: raw };

    // 2. A canonical MDLZ skill the CV phrased differently — verified live, first
    //    candidate that lands at the top wins.
    for (const cand of (taxonomy[want] || [])) {
        const hit = exactCatalogAtTop(await fetchOptions(cand), fold(cand));
        if (hit) return { status: 'ok', canonical: hit, via: 'taxonomy', input: raw };
    }

    // 3. Genuinely custom, but its create row is the top result (nothing in the
    //    catalogue matched) so it paints — safe to add as free text.
    if (rawRows) {
        const createIdx = rawRows.findIndex((r) => !isCatalog(r) && fold(labelOf(r)) === want);
        if (createIdx >= 0 && createIdx <= RENDER_SAFE) {
            return { status: 'ok', canonical: raw, via: 'create-safe', input: raw };
        }
    }

    // 4. Only a tail create row (or nothing) — never mint it; it hangs while
    //    hidden. Flag so the caller can skip/defer instead of stalling the field.
    return {
        status: 'flag', input: raw,
        reason: (taxonomy[want] ? 'taxonomy candidates absent from catalogue; ' : '')
            + 'no exact catalog row in the paintable window',
    };
}

/**
 * Map a whole skills list to hidden-safe canonical terms, MERGING duplicates
 * (two CV phrasings can resolve to one catalogue skill) and reporting the ones
 * with no safe home rather than letting them hang.
 *
 * @returns {{want:string[], flagged:string[]}}
 */
export async function resolveSkillWants(wants, deps) {
    const want = [];
    const flagged = [];
    const seen = new Set();
    let oracleReached = true;   // false if any term fell back because the endpoint was down
    for (const w of (wants || [])) {
        const r = await resolveSkillToMdlz(w, deps);
        if (r.via === 'unresolved') oracleReached = false;
        if (r.status === 'ok') {
            const key = fold(r.canonical);
            if (!seen.has(key)) { seen.add(key); want.push(r.canonical); }
        } else if (r.status === 'flag') {
            flagged.push(r.input);
        }
    }
    return { want, flagged, oracleReached };
}
