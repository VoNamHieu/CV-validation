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

// A PROSPECTIVE improvement the optimizer did NOT apply because it needs the
// candidate's real input (a number, a detail) it must not invent. Surfaced in
// the editor as a "could consider" item with an input; the candidate's answer
// is fed back into re-optimize. Distinct from CvImprovement (already applied).
export interface CvSuggestion {
    section: string;      // where it applies — "Kinh nghiệm: CLB ABC"
    suggestion: string;   // what could be stronger, pointed out for the candidate
    placeholder: string;  // hint for the input — the quantification question to answer
}

function bullets(desc: string | undefined): string[] {
    return (desc ?? "").split("\n").map(l => l.trim()).filter(Boolean);
}

function norm(s: string | undefined): string {
    return (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function snippet(s: string | undefined, n = 120): string {
    const t = (s ?? "").replace(/\s+/g, " ").trim();
    return t.length > n ? `${t.slice(0, n).trimEnd()}…` : t;
}

function listVi(items: string[], max = 4): string {
    const shown = items.slice(0, max);
    const extra = items.length - shown.length;
    return shown.join(", ") + (extra > 0 ? ` +${extra} nữa` : "");
}

/**
 * Compare original vs optimized CV and describe every real content change in
 * user-facing Vietnamese. Empty result = the optimized CV is textually
 * identical to the original (nothing was tailored).
 */
export function diffCvChanges(original: CVData, optimized: CVData): string[] {
    const changes: string[] = [];

    if (norm(original.summary) !== norm(optimized.summary) && optimized.summary?.trim()) {
        changes.push(`Viết lại mục tiêu nghề nghiệp: “${snippet(optimized.summary, 130)}”`);
    }

    const origExp = original.experience ?? [];
    const optExp = optimized.experience ?? [];
    const rewordedCompanies: string[] = [];
    let rewordedBullets = 0;
    let exampleBullet = "";
    const reorderedCompanies: string[] = [];
    for (let i = 0; i < Math.min(origExp.length, optExp.length); i++) {
        const label = (optExp[i].company || optExp[i].title || `mục ${i + 1}`).trim();
        const a = bullets(origExp[i].description);
        const b = bullets(optExp[i].description);
        const aSet = new Set(a.map(norm));
        const newBullets = b.filter(l => !aSet.has(norm(l)));
        if (newBullets.length > 0) {
            rewordedCompanies.push(label);
            rewordedBullets += newBullets.length;
            if (!exampleBullet) exampleBullet = newBullets[0];
        } else if (a.length === b.length && a.map(norm).join("|") !== b.map(norm).join("|")) {
            reorderedCompanies.push(label);
        }
    }
    if (rewordedCompanies.length > 0) {
        changes.push(`Viết lại ${rewordedBullets} gạch đầu dòng ở ${listVi(rewordedCompanies)} — bổ sung từ khoá & định lượng theo JD.`);
        if (exampleBullet) changes.push(`Ví dụ: “${snippet(exampleBullet, 140)}”`);
    }
    if (reorderedCompanies.length > 0) {
        changes.push(`Sắp xếp lại bullet ở ${listVi(reorderedCompanies)}: thành tích liên quan nhất lên đầu.`);
    }

    const origProj = original.projects ?? [];
    const optProj = optimized.projects ?? [];
    const projChanged: string[] = [];
    for (let i = 0; i < Math.min(origProj.length, optProj.length); i++) {
        if (norm(origProj[i].description) !== norm(optProj[i].description)) {
            projChanged.push((optProj[i].name || `dự án ${i + 1}`).trim());
        }
    }
    if (projChanged.length > 0) {
        changes.push(`Viết lại mô tả dự án: ${listVi(projChanged)}.`);
    }

    const origList = original.skills ?? [];
    const optList = optimized.skills ?? [];
    if (origList.map(norm).join("|") !== optList.map(norm).join("|")) {
        const origSet = new Set(origList.map(norm));
        const added = optList.filter(s => !origSet.has(norm(s)));
        if (added.length > 0) {
            changes.push(`Bổ sung kỹ năng khớp JD: ${listVi(added)}.`);
        } else if (optList.length > 0) {
            // Same set, reordered → name the ones pulled to the front.
            changes.push(`Đưa lên đầu danh sách kỹ năng: ${listVi(optList, 5)} (theo yêu cầu JD).`);
        } else {
            changes.push("Điều chỉnh danh sách kỹ năng theo JD.");
        }
    }

    return changes;
}
