// Response schema + deterministic post-validation for /api/ai/optimize.
//
// The optimizer LLM only rewrites wording — every fact (entry counts, bullet
// counts, titles, companies, dates, skills, education) must survive verbatim.
// The prompt already demands this, but prompts are not guarantees: this module
// passes a constrained-decoding schema to Gemini and then REPAIRS any drift
// deterministically against the original CV instead of trusting the output.

// Gemini responseSchema (OpenAPI subset) for the six rewriteable fields.
// Intentionally excludes contact/personal/employment/preferences and the
// factual sections (certifications/languages/awards/activities) — those are
// merged back from the original CV and the model never sees a slot for them.
const STR = { type: "STRING" } as const;

export const OPTIMIZE_RESPONSE_SCHEMA: Record<string, unknown> = {
    type: "OBJECT",
    properties: {
        name: STR,
        summary: STR,
        skills: { type: "ARRAY", items: STR },
        experience: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: { title: STR, company: STR, duration_months: { type: "NUMBER" }, description: STR },
                required: ["title", "company", "duration_months", "description"],
            },
        },
        education: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: { degree: STR, institution: STR, year: STR },
                required: ["degree", "institution", "year"],
            },
        },
        projects: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: { name: STR, description: STR },
                required: ["name", "description"],
            },
        },
        improvements: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: { section: STR, change: STR, reason: STR },
                required: ["section", "change", "reason"],
            },
        },
    },
    required: ["name", "summary", "skills", "experience", "education", "projects", "improvements"],
};

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec {
    return v && typeof v === "object" ? (v as Rec) : {};
}

function asRecArray(v: unknown): Rec[] {
    if (!Array.isArray(v)) return [];
    return v.map(asRec);
}

function bulletLines(desc: unknown): string[] {
    return String(desc ?? "").split("\n").map(l => l.trim()).filter(Boolean);
}

export interface RepairResult {
    cv: Rec;
    // Human-readable notes on every drift that was repaired — callers log
    // these so silent model regressions stay visible in server logs.
    repairs: string[];
}

// Top-level sections the optimizer must never touch — always taken verbatim
// from the original CV.
const PRESERVED_KEYS = [
    "contact", "personal", "employment", "preferences",
    "certifications", "languages", "awards", "activities",
] as const;

// Facts inside each experience entry that must survive verbatim. description
// is handled separately (bullet-count check).
const EXPERIENCE_FACT_KEYS = ["title", "company", "duration_months", "start_date", "end_date"] as const;

/**
 * Validate the optimizer output against the original CV and repair any
 * content loss in place of retrying:
 * - experience/projects: entry count must match, else the original array is
 *   restored wholesale; per entry, facts are restored and a description whose
 *   bullet count shrank is reverted to the original.
 * - skills: any skill missing from the output is appended back (reordering is
 *   allowed, removal is not).
 * - education and the PRESERVED_KEYS sections are always taken from the original.
 */
export function repairOptimizedCv(original: unknown, optimized: unknown): RepairResult {
    const orig = asRec(original);
    const opt = asRec(optimized);
    const repairs: string[] = [];
    const out: Rec = { ...opt };

    // ── Immutable facts: name, education, preserved sections ──
    if (orig.name !== undefined) out.name = orig.name;
    if (orig.education !== undefined) out.education = orig.education;
    for (const key of PRESERVED_KEYS) {
        if (orig[key] !== undefined) out[key] = orig[key];
    }

    if (!String(out.summary ?? "").trim() && orig.summary !== undefined) {
        out.summary = orig.summary;
        repairs.push("summary: empty in output, restored original");
    }

    // ── Skills: superset check — keep the model's ordering, append dropped ones ──
    const origSkills = (Array.isArray(orig.skills) ? orig.skills : []).filter(
        (s): s is string => typeof s === "string" && !!s.trim());
    const optSkills = (Array.isArray(opt.skills) ? opt.skills : []).filter(
        (s): s is string => typeof s === "string" && !!s.trim());
    const have = new Set(optSkills.map(s => s.trim().toLowerCase()));
    const dropped = origSkills.filter(s => !have.has(s.trim().toLowerCase()));
    if (dropped.length) {
        repairs.push(`skills: ${dropped.length} dropped (${dropped.join(", ")}), appended back`);
    }
    out.skills = [...optSkills, ...dropped];

    // ── Experience / projects: entry count + per-description bullet count ──
    out.experience = repairEntryArray(
        orig.experience, opt.experience, "experience", EXPERIENCE_FACT_KEYS, repairs);
    out.projects = repairEntryArray(
        orig.projects, opt.projects, "projects", ["name"], repairs);

    return { cv: out, repairs };
}

function repairEntryArray(
    origRaw: unknown,
    optRaw: unknown,
    label: string,
    factKeys: readonly string[],
    repairs: string[],
): unknown {
    const orig = asRecArray(origRaw);
    const opt = asRecArray(optRaw);

    if (!Array.isArray(origRaw)) return optRaw;
    if (opt.length !== orig.length) {
        repairs.push(`${label}: entry count ${opt.length} != ${orig.length}, restored original array`);
        return origRaw;
    }

    return orig.map((origEntry, i) => {
        const merged: Rec = { ...opt[i] };
        for (const key of factKeys) {
            if (origEntry[key] !== undefined) merged[key] = origEntry[key];
        }
        const origBullets = bulletLines(origEntry.description).length;
        const optBullets = bulletLines(opt[i].description).length;
        // detailed mode may legitimately split one bullet into two — only a
        // SHRINKING bullet count means content was merged or dropped.
        if (optBullets < origBullets) {
            merged.description = origEntry.description;
            repairs.push(`${label}[${i}]: bullets ${optBullets} < ${origBullets}, restored original description`);
        }
        return merged;
    });
}
