/**
 * skill-resolve.js — turn a CV skill into the term the Mondelez catalogue
 * actually holds, so the Skills widget commits STRUCTURED data wherever the
 * catalogue has an answer, and the candidate's own words only where it does not.
 *
 * Measured live (2026-08-13, tenant mdlz): skillsearch pads every query to ~16
 * results and the create/free-text row is always LAST — so "does the catalogue
 * have this skill, and how does it spell it" can only be answered by asking the
 * endpoint, never by guessing. Canonical spellings differ from natural phrasing
 * in ways no static map predicts ("pricing strategy" → "Pricing Strategies",
 * "lifetime value" → "Customer Lifetime Value"), so skillsearch is the ORACLE:
 * every taxonomy candidate is re-verified against it before it is used, and a
 * wrong or renamed entry self-rejects instead of committing the wrong skill.
 *
 * Position in the results no longer gates anything: a row that will not render
 * in a hidden tab is committed by DATA (fiber onSelect — see readSkillsOnSelect
 * in executors.js, measured 4/4), so the resolver's job is purely QUALITY —
 * prefer the catalogue's structured row over minting free text of the same
 * meaning, and keep the taxonomy mapping ("unit economics" is not an MDLZ
 * skill; Customer Lifetime Value is).
 */

const fold = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
// fetchSkillOptions hands back {label, id, index}; a catalog row's id is the
// tenant's REMOTE_SKILL-… while the create row's id EQUALS its label.
const labelOf = (r) => (r && (r.label ?? r.descriptor ?? r.ariaLabel)) || '';
const isCatalog = (r) => !!r && String(r.id) !== String(labelOf(r));

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
    // Verified live: "agentic system(s)" is not exact; "Agentic AI" is, at 0.
    'agentic system': ['Agentic AI'],
    'agentic systems': ['Agentic AI'],
};

/** The catalogue's own row for `probe`, wherever skillsearch ranked it. */
const exactCatalog = (rows, probeFolded) => {
    const hit = (rows || []).find((r) => isCatalog(r) && fold(labelOf(r)) === probeFolded);
    return hit ? labelOf(hit) : null;
};

/**
 * Resolve one CV skill to the term the widget should commit.
 *
 * @param {string} term  the CV's skill text
 * @param {{fetchOptions:(t:string)=>Promise<Array|null>, taxonomy?:object}} deps
 * @returns {{status:'ok', canonical:string, via:'direct'|'taxonomy'|'create'|'unresolved', input:string}
 *          |{status:'flag', reason:string, input:string}
 *          |{status:'empty', input:*}}
 */
export async function resolveSkillToMdlz(term, { fetchOptions, taxonomy = SKILL_TAXONOMY } = {}) {
    const raw = String(term ?? '').trim();
    if (!raw) return { status: 'empty', input: term };
    if (typeof fetchOptions !== 'function') return { status: 'flag', input: raw, reason: 'no skillsearch fetcher' };
    const want = fold(raw);

    // 1. The CV already wrote the catalogue's own word — commit THAT row.
    const rawRows = await fetchOptions(raw);
    const direct = exactCatalog(rawRows, want);
    if (direct) return { status: 'ok', canonical: direct, via: 'direct', input: raw };

    // Oracle unreachable (network blip) — do NOT guess and do NOT flag. Keep the
    // CV's term so the engine's own paths still try it, exactly as they did
    // before skillsearch existed. Never worse than the old behaviour.
    if (rawRows === null) return { status: 'ok', canonical: raw, via: 'unresolved', input: raw };

    // 2. A canonical MDLZ skill the CV phrased differently — verified live, first
    //    candidate the catalogue confirms wins. Structured data beats free text.
    for (const cand of (taxonomy[want] || [])) {
        const hit = exactCatalog(await fetchOptions(cand), fold(cand));
        if (hit) return { status: 'ok', canonical: hit, via: 'taxonomy', input: raw };
    }

    // 3. Genuinely custom — the create row (id === label) is the answer, in the
    //    candidate's own words. Its tail position is no obstacle: the engine
    //    commits an unrenderable row by data (fiber onSelect fallback).
    const create = (rawRows || []).find((r) => !isCatalog(r) && fold(labelOf(r)) === want);
    if (create) return { status: 'ok', canonical: raw, via: 'create', input: raw };

    // 4. The catalogue offered neither an exact row nor a create row for this
    //    text — nothing here is safe to commit unreviewed.
    return { status: 'flag', input: raw, reason: 'no exact catalog row and no create row for this term' };
}

/**
 * Map a whole skills list to committable terms, MERGING duplicates (two CV
 * phrasings can resolve to one catalogue skill) and reporting the ones with no
 * safe answer rather than letting them hang.
 *
 * @returns {{want:string[], flagged:string[], oracleReached:boolean}}
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
