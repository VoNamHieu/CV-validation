// Response schema + deterministic post-validation for /api/ai/optimize.
//
// The optimizer LLM only rewrites wording — every fact (entry counts, bullet
// counts, titles, companies, dates, skills, education) must survive verbatim.
// The prompt already demands this, but prompts are not guarantees: this module
// passes a constrained-decoding schema to Gemini and then REPAIRS any drift
// deterministically against the original CV instead of trusting the output.

import { experienceKey, norm, projectKey } from "@/lib/verify/facts";

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
        suggestions: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: { section: STR, suggestion: STR, placeholder: STR },
                required: ["section", "suggestion", "placeholder"],
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

    // ── Skills: exact set — the model may reorder, but must neither drop nor
    // add. Keep the model's order for the skills that are genuinely in the
    // source, STRIP any it fabricated (guardrail #2 in the optimize prompt),
    // then append back any it dropped. Both directions are logged. ──
    const origSkills = (Array.isArray(orig.skills) ? orig.skills : []).filter(
        (s): s is string => typeof s === "string" && !!s.trim());
    const optSkills = (Array.isArray(opt.skills) ? opt.skills : []).filter(
        (s): s is string => typeof s === "string" && !!s.trim());
    const origHave = new Set(origSkills.map(norm));
    const outHave = new Set(optSkills.map(norm));
    const kept = optSkills.filter(s => origHave.has(norm(s)));
    const fabricated = optSkills.filter(s => !origHave.has(norm(s)));
    const dropped = origSkills.filter(s => !outHave.has(norm(s)));
    if (fabricated.length) {
        repairs.push(`skills: ${fabricated.length} fabricated stripped (${fabricated.join(", ")})`);
    }
    if (dropped.length) {
        repairs.push(`skills: ${dropped.length} dropped (${dropped.join(", ")}), appended back`);
    }
    out.skills = [...kept, ...dropped];

    // ── Experience / projects: entry count + per-description bullet count ──
    out.experience = repairEntryArray(
        orig.experience, opt.experience, "experience", EXPERIENCE_FACT_KEYS, experienceKey, repairs);
    out.projects = repairEntryArray(
        orig.projects, opt.projects, "projects", ["name"], projectKey, repairs);

    return { cv: out, repairs };
}

function repairEntryArray(
    origRaw: unknown,
    optRaw: unknown,
    label: string,
    factKeys: readonly string[],
    keyOf: (e: Rec) => string,
    repairs: string[],
): unknown {
    const orig = asRecArray(origRaw);
    const opt = asRecArray(optRaw);

    if (!Array.isArray(origRaw)) return optRaw;
    if (opt.length !== orig.length) {
        repairs.push(`${label}: entry count ${opt.length} != ${orig.length}, restored original array`);
        return origRaw;
    }

    // Match each optimized entry to its original by CONTENT key (title|company /
    // name), not array position: the model may reorder, and restoring facts by
    // index would splice one role's title/dates onto another. Fall back to the
    // positional entry only when a key is absent or duplicated.
    const origByKey = new Map<string, Rec>();
    orig.forEach(e => { const k = keyOf(e); if (!origByKey.has(k)) origByKey.set(k, e); });
    const usedKeys = new Set<string>();

    return opt.map((optEntry, i) => {
        const key = keyOf(optEntry);
        const matched = origByKey.get(key);
        const origEntry = matched && !usedKeys.has(key) ? (usedKeys.add(key), matched) : orig[i];
        const merged: Rec = { ...optEntry };
        for (const k of factKeys) {
            if (origEntry[k] !== undefined) merged[k] = origEntry[k];
        }
        const origBullets = bulletLines(origEntry.description).length;
        const optBullets = bulletLines(optEntry.description).length;
        // detailed mode may legitimately split one bullet into two — only a
        // SHRINKING bullet count means content was merged or dropped.
        if (optBullets < origBullets) {
            merged.description = origEntry.description;
            repairs.push(`${label}[${i}]: bullets ${optBullets} < ${origBullets}, restored original description`);
        }
        return merged;
    });
}
