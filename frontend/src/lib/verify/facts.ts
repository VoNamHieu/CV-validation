// Shared fact-extraction primitive for the CV verification passes.
//
// The optimizer LLM is only allowed to REPHRASE — it must never invent a
// number, a metric, a skill, or a tech/proper-noun the candidate never wrote.
// This module turns a piece of text into a normalized `FactSet` (numerals +
// tech/proper tokens) so two texts can be diffed for *added* facts, which is
// the fabrication signal used by both the live optimize guard (backtrack.ts)
// and interview-dossier generation.
//
// It is deliberately a lightweight heuristic, not a proof system: a false
// "added" only ever causes a bullet to revert to the candidate's own original
// text (always truthful), so the module errs on the side of catching drift.

export interface FactSet {
    // Canonical numeric tokens: "40%", "10000", "3y" (3 years), "500m" (triệu).
    numerals: Set<string>;
    // Tech / proper-noun tokens: skills, all-caps acronyms, dotted tech names.
    tokens: Set<string>;
}

// Fold Vietnamese diacritics to ASCII and lowercase so "Kỹ năng" == "ky nang".
// (Mirrors foldAccents in job-targeting.ts, kept local so verify/ is standalone.)
export function foldAccents(s: string): string {
    return (s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // strip combining diacritics
        .replace(/đ/g, "d");
}

/** Collapse runs of whitespace to a single space and trim. */
export function collapseWs(s: string): string {
    return (s || "").replace(/\s+/g, " ").trim();
}

/** Accent-folded, whitespace-collapsed form used for all comparisons. */
export function normText(s: string): string {
    return collapseWs(foldAccents(s));
}

/** Normalize any value to its comparison key form. */
export function norm(s: unknown): string {
    return normText(String(s ?? ""));
}

// Identity keys for matching an optimized entry back to its original by content
// instead of array position — an experience entry is (title, company); a
// project is its name. Used by both the optimize repair pass and the verifier.
export function experienceKey(e: Record<string, unknown>): string {
    return `${norm(e.title)}|${norm(e.company)}`;
}

export function projectKey(e: Record<string, unknown>): string {
    return norm(e.name);
}

// ─────────────────────────────── numerals ───────────────────────────────

// Strip thousands separators / normalize a decimal comma so the SAME written
// number compares equal across VN ("1.000.000", "3,5") and EN ("1,000,000",
// "3.5") conventions. Locale ambiguity is resolved pragmatically: a run of
// `,`/`.`-separated 3-digit groups is thousands; anything else is a decimal.
function canonNumber(raw: string): string {
    const s = raw.replace(/\s+/g, "").replace(/[.,]+$/, "");
    if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return s.replace(/[.,]/g, "");
    return s.replace(/,/g, ".");
}

function unitClass(u: string | undefined): string {
    if (!u) return "";
    const x = u.toLowerCase();
    if (x === "%") return "%";
    if (x === "k") return "k";
    if (x === "trieu" || x === "tr") return "m";
    if (x === "ty") return "b";
    if (x === "usd" || x === "vnd") return "$";
    if (["nam", "years", "year", "yrs", "yr"].includes(x)) return "y";
    if (["thang", "months", "month", "mo"].includes(x)) return "mo";
    return "";
}

// A number, optionally followed by a unit. Longer unit alternatives come first
// (JS alternation is ordered, not longest-match): trieu before tr, etc.
const NUM_RE =
    /(\d[\d.,]*)\s*(%|trieu|tr|ty|k|usd|vnd|nam|thang|years|year|yrs|yr|months|month|mo)?/gi;

/**
 * Extract the numeric facts from text. Ranges like "22%→54%" or "22% to 54%"
 * both decompose into the two atomic tokens {22%, 54%}, so rephrasing a range
 * is not seen as a new fact.
 */
export function extractNumerals(text: string): Set<string> {
    // Currency symbols → word units BEFORE folding (foldAccents drops "₫"→ and
    // lowercases), and arrows → space so ranges split into atomic numbers.
    const pre = (text || "")
        .replace(/\$/g, " usd ")
        .replace(/[₫đĐ]/g, " vnd ")
        .replace(/[→➔➜⇒]|->|=>/g, " ");
    const folded = foldAccents(pre);
    const out = new Set<string>();
    for (const m of folded.matchAll(NUM_RE)) {
        const num = canonNumber(m[1]);
        if (!num || num === ".") continue;
        out.add(num + unitClass(m[2]));
    }
    return out;
}

// ─────────────────────────────── tokens ───────────────────────────────

// All-caps acronyms (AWS, SQL, GCP) and dotted/plus tech names (Node.js, C++).
const ACRONYM_RE = /\b[A-Z][A-Z0-9]{1,5}\b/g;
const TECH_RE = /\b[A-Za-z][A-Za-z0-9]*(?:[.+#][A-Za-z0-9+#]+)+/g;

/**
 * Extract tech / proper-noun tokens. `skills` (the CV's own skill list) are
 * always recognized so referencing a known skill is never flagged as new.
 */
export function extractTokens(text: string, skills: readonly string[] = []): Set<string> {
    const out = new Set<string>();
    const raw = text || "";
    for (const m of raw.matchAll(ACRONYM_RE)) out.add(foldAccents(m[0]));
    for (const m of raw.matchAll(TECH_RE)) out.add(foldAccents(m[0]));
    const folded = normText(raw);
    for (const skill of skills) {
        const s = normText(skill);
        // Word-ish containment: the skill phrase appears in the text.
        if (s && folded.includes(s)) out.add(s);
    }
    return out;
}

export function extractFacts(text: string, opts?: { skills?: readonly string[] }): FactSet {
    return {
        numerals: extractNumerals(text),
        tokens: extractTokens(text, opts?.skills ?? []),
    };
}

function added(source: Set<string>, output: Set<string>): string[] {
    return [...output].filter(x => !source.has(x));
}

/**
 * Facts present in `output` but not in `source` (`added` = the fabrication
 * signal) and vice-versa (`missing` = dropped). Numerals and tokens are pooled.
 */
export function diffFacts(source: FactSet, output: FactSet): { added: string[]; missing: string[] } {
    return {
        added: [...added(source.numerals, output.numerals), ...added(source.tokens, output.tokens)],
        missing: [...added(output.numerals, source.numerals), ...added(output.tokens, source.tokens)],
    };
}
