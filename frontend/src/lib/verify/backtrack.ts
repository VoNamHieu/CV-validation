// Backtrack verifier: classify every optimized bullet by where it came from.
//
// Run AFTER repairOptimizedCv (which guarantees entry counts/facts align) to
// answer "did the model actually just rephrase, or did it embellish?". Each
// bullet gets a provenance + a severity tier:
//   - source     / ok    — copied verbatim from the original entry.
//   - rephrased  / flag  — reworded, no new facts. Safe, but worth surfacing
//                          (UI chip + interview "be ready to defend this").
//   - new_facts  / never — introduced a numeral/skill/tech token not in the
//                          source. Fabrication → the live path reverts it.
//
// Entries are matched by CONTENT key (title|company / name), not array index,
// so a reordered experience list is still compared correctly.

import {
    diffFacts, experienceKey, extractFacts, norm, projectKey, type FactSet,
} from "@/lib/verify/facts";
import { assertVerbatim } from "@/lib/verify/verbatim";

export type Provenance = "source" | "rephrased" | "new_facts";
export type Tier = "ok" | "flag" | "never";

export interface BulletVerdict {
    section: "experience" | "projects";
    entryKey: string;
    bulletIndex: number;
    text: string;
    provenance: Provenance;
    tier: Tier;
    // The fabricated facts (only on new_facts) — for logs, UI chips, dossier.
    added?: string[];
}

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec {
    return v && typeof v === "object" ? (v as Rec) : {};
}

function asRecArray(v: unknown): Rec[] {
    return Array.isArray(v) ? v.map(asRec) : [];
}

function bulletLines(desc: unknown): string[] {
    return String(desc ?? "").split("\n").map(l => l.trim()).filter(Boolean);
}

const SECTIONS = [
    { name: "experience" as const, keyFn: experienceKey },
    { name: "projects" as const, keyFn: projectKey },
];

/**
 * Classify each bullet of the optimized CV's experience/projects sections.
 * `original` is the source CV, `optimized` the (already repaired) output.
 */
export function verifyOptimizedCv(original: unknown, optimized: unknown): BulletVerdict[] {
    const orig = asRec(original);
    const opt = asRec(optimized);
    const skills = (Array.isArray(orig.skills) ? orig.skills : [])
        .filter((s): s is string => typeof s === "string");

    const verdicts: BulletVerdict[] = [];
    for (const { name, keyFn } of SECTIONS) {
        const origArr = asRecArray(orig[name]);
        const optArr = asRecArray(opt[name]);
        const origByKey = new Map<string, Rec>();
        origArr.forEach(e => { const k = keyFn(e); if (!origByKey.has(k)) origByKey.set(k, e); });

        optArr.forEach((oe, i) => {
            const key = keyFn(oe);
            const origEntry = origByKey.get(key) ?? origArr[i] ?? {};
            const origDesc = String(origEntry.description ?? "");
            // Source facts: numerals from the original text; tokens also include
            // every CV skill + this entry's title/company, so referencing a known
            // skill or the employer is never mistaken for a fabricated fact.
            const sourceText = [origDesc, origEntry.title, origEntry.company, origEntry.name]
                .filter(Boolean).join(" ");
            const source: FactSet = extractFacts(sourceText, { skills });
            for (const s of skills) source.tokens.add(norm(s));

            bulletLines(oe.description).forEach((bullet, bulletIndex) => {
                if (assertVerbatim(bullet, origDesc)) {
                    verdicts.push({ section: name, entryKey: key, bulletIndex, text: bullet, provenance: "source", tier: "ok" });
                    return;
                }
                const { added } = diffFacts(source, extractFacts(bullet, { skills }));
                if (added.length) {
                    verdicts.push({ section: name, entryKey: key, bulletIndex, text: bullet, provenance: "new_facts", tier: "never", added });
                } else {
                    verdicts.push({ section: name, entryKey: key, bulletIndex, text: bullet, provenance: "rephrased", tier: "flag" });
                }
            });
        });
    }
    return verdicts;
}

export interface EnforceResult {
    cv: Rec;
    // Human-readable "section[key]" labels of entries whose description was
    // reverted because a bullet fabricated a fact — callers log these.
    reverted: string[];
    // Rephrased-but-clean bullets worth surfacing (UI chip / dossier). Excludes
    // any in a reverted entry, since those bullets no longer exist in the output.
    flags: BulletVerdict[];
}

/**
 * Apply the verdicts to the optimized CV: for every entry that contains a
 * `never`-tier (fact-fabricating) bullet, restore that entry's ENTIRE original
 * description verbatim — the same entry-level restore repairOptimizedCv uses,
 * which sidesteps fragile per-bullet realignment and is always factually safe.
 */
export function enforceVerdicts(
    original: unknown, optimized: unknown, verdicts: BulletVerdict[],
): EnforceResult {
    const orig = asRec(original);
    const opt = asRec(optimized);
    const out: Rec = { ...opt };
    const neverKeys = new Set(
        verdicts.filter(v => v.tier === "never").map(v => `${v.section}::${v.entryKey}`));
    const reverted: string[] = [];

    if (neverKeys.size) {
        for (const { name, keyFn } of SECTIONS) {
            const origArr = asRecArray(orig[name]);
            const origByKey = new Map<string, Rec>();
            origArr.forEach(e => { const k = keyFn(e); if (!origByKey.has(k)) origByKey.set(k, e); });
            out[name] = asRecArray(opt[name]).map((oe, i) => {
                const key = keyFn(oe);
                if (!neverKeys.has(`${name}::${key}`)) return oe;
                const origEntry = origByKey.get(key) ?? origArr[i];
                if (origEntry && origEntry.description !== undefined) {
                    reverted.push(`${name}[${key}]`);
                    return { ...oe, description: origEntry.description };
                }
                return oe;
            });
        }
    }

    const flags = verdicts.filter(
        v => v.tier === "flag" && !neverKeys.has(`${v.section}::${v.entryKey}`));
    return { cv: out, reverted, flags };
}
