// Per-job "what was improved" explanation for an optimized CV.
//
// Two sources, combined in the UI:
// 1. LLM-stated improvements — the optimizer explains each change it made
//    (returned alongside the CV by /api/ai/optimize, stored on the JDEntry).
// 2. Deterministic diff (this module) — ground truth computed by comparing
//    the original CV with the optimized one. Catches the "optimizer returned
//    the CV unchanged" case that prompts alone can't, and covers entries
//    optimized before improvements existed.

import type { CVData } from "@/lib/types";

export interface CvImprovement {
    section: string; // e.g. "Mục tiêu nghề nghiệp", "Kinh nghiệm: ACME"
    change: string;  // what was rewritten/reordered
    reason: string;  // why — tied to the JD
}

function bullets(desc: string | undefined): string[] {
    return (desc ?? "").split("\n").map(l => l.trim()).filter(Boolean);
}

function norm(s: string | undefined): string {
    return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Compare original vs optimized CV and describe every real content change in
 * user-facing Vietnamese. Empty result = the optimized CV is textually
 * identical to the original (nothing was tailored).
 */
export function diffCvChanges(original: CVData, optimized: CVData): string[] {
    const changes: string[] = [];

    if (norm(original.summary) !== norm(optimized.summary)) {
        changes.push("Mục tiêu nghề nghiệp được viết lại theo yêu cầu của job.");
    }

    const origExp = original.experience ?? [];
    const optExp = optimized.experience ?? [];
    let rewordedEntries = 0;
    let rewordedBullets = 0;
    let reorderedEntries = 0;
    for (let i = 0; i < Math.min(origExp.length, optExp.length); i++) {
        const a = bullets(origExp[i].description);
        const b = bullets(optExp[i].description);
        const aSet = new Set(a.map(norm));
        const changed = b.filter(l => !aSet.has(norm(l))).length;
        if (changed > 0) {
            rewordedEntries++;
            rewordedBullets += changed;
        } else if (a.length === b.length && a.map(norm).join("|") !== b.map(norm).join("|")) {
            reorderedEntries++;
        }
    }
    if (rewordedEntries > 0) {
        changes.push(`${rewordedBullets} bullet trong ${rewordedEntries} mục kinh nghiệm được viết lại nhấn vào keyword của JD.`);
    }
    if (reorderedEntries > 0) {
        changes.push(`Bullet trong ${reorderedEntries} mục kinh nghiệm được sắp xếp lại — thành tích liên quan nhất lên đầu.`);
    }

    const origProj = original.projects ?? [];
    const optProj = optimized.projects ?? [];
    let projChanged = 0;
    for (let i = 0; i < Math.min(origProj.length, optProj.length); i++) {
        if (norm(origProj[i].description) !== norm(optProj[i].description)) projChanged++;
    }
    if (projChanged > 0) {
        changes.push(`Mô tả của ${projChanged} dự án được viết lại.`);
    }

    const origSkills = (original.skills ?? []).map(norm).join("|");
    const optSkills = (optimized.skills ?? []).map(norm).join("|");
    if (origSkills !== optSkills) {
        const origSet = new Set((original.skills ?? []).map(norm));
        const sameSet = (optimized.skills ?? []).every(s => origSet.has(norm(s)))
            && (optimized.skills ?? []).length === (original.skills ?? []).length;
        changes.push(sameSet
            ? "Kỹ năng được sắp xếp lại — kỹ năng JD yêu cầu lên đầu."
            : "Danh sách kỹ năng được điều chỉnh.");
    }

    return changes;
}
