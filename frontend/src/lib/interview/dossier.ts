// Interview-prep dossier generation (server-side, free — no credit metering).
//
// Grounds the dossier in three real signals rather than free-associating:
//   1. the JD (what they'll probe),
//   2. the fit gaps (requirements the CV covers weakly → prep answers),
//   3. the backtrack verifier's `flag` bullets — claims the optimizer REPHRASED,
//      which are exactly the lines a candidate must be ready to defend.
// The flagged claims are computed deterministically and passed into the prompt,
// so the model expands them into questions but can't invent the claims.

import { callAI } from "@/lib/gemini";
import { safeJsonParse } from "@/lib/safe-json";
import { verifyOptimizedCv } from "@/lib/verify/backtrack";

export interface DossierQuestion {
    id: string;
    question: string;
    category: string;
    why: string;
    difficulty: "easy" | "medium" | "hard";
}
export interface FlaggedClaim {
    claim: string;
    section: string;
    note: string;
}
export interface DossierGap {
    gap: string;
    how_to_prepare: string;
}
export interface Dossier {
    version: number;
    likely_questions: DossierQuestion[];
    talking_points: string[];
    flagged_claims: FlaggedClaim[];
    gaps: DossierGap[];
}

const STR = { type: "STRING" } as const;

const DOSSIER_SCHEMA: Record<string, unknown> = {
    type: "OBJECT",
    properties: {
        likely_questions: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: { question: STR, category: STR, why: STR, difficulty: STR },
                required: ["question", "category", "why", "difficulty"],
            },
        },
        talking_points: { type: "ARRAY", items: STR },
        gaps: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: { gap: STR, how_to_prepare: STR },
                required: ["gap", "how_to_prepare"],
            },
        },
    },
    required: ["likely_questions", "talking_points", "gaps"],
};

const DOSSIER_SYSTEM_PROMPT = `Bạn là chuyên gia coach phỏng vấn. Dựa trên Mô tả công việc (JD), CV đã tối ưu cho vị trí đó, các điểm còn thiếu (gaps) so với JD, và danh sách "câu cần sẵn sàng bảo vệ" (những gạch đầu dòng đã được viết lại), hãy soạn bộ chuẩn bị phỏng vấn.

Trả về JSON:
- likely_questions: 6-10 câu hỏi khả năng cao nhà tuyển dụng sẽ hỏi. Bám sát must_have + trách nhiệm trong JD, các gap, và những câu đã viết lại (nhà tuyển dụng có thể đào sâu). Mỗi câu có: "question" (câu hỏi), "category" (ví dụ: Kỹ thuật, Hành vi, Kinh nghiệm, Điểm yếu), "why" (vì sao câu này dễ được hỏi — bám vào JD/gap/CV), "difficulty" ("easy"|"medium"|"hard").
- talking_points: 3-6 luận điểm mạnh ứng viên nên chủ động nêu, rút ra từ CV, khớp với điều JD coi trọng.
- gaps: với mỗi điểm còn thiếu, đưa "gap" và "how_to_prepare" (cách chuẩn bị/định khung câu trả lời cho phần còn yếu này).

QUY TẮC: Viết toàn bộ bằng TIẾNG VIỆT (giữ nguyên tên công nghệ/thuật ngữ như React, SQL, AWS). TUYỆT ĐỐI không bịa số liệu, thành tích, công ty hay kỹ năng không có trong CV. Chỉ dựa trên dữ liệu được cung cấp.`;

/** Requirements the CV covers weakly + each category's stated gaps. */
function gapsFromMatch(match: unknown): string[] {
    const m = (match && typeof match === "object" ? match : {}) as Record<string, unknown>;
    const out: string[] = [];
    const mh = m.must_have_match as Record<string, unknown> | undefined;
    const reqs = mh?.requirements;
    if (Array.isArray(reqs)) {
        for (const r of reqs) {
            const rr = r as Record<string, unknown>;
            if (rr.status && rr.status !== "met" && typeof rr.requirement === "string") {
                out.push(rr.requirement);
            }
        }
    }
    for (const key of ["must_have_match", "experience_match", "domain_match", "seniority_match", "nice_to_have_match"]) {
        const cat = m[key] as Record<string, unknown> | undefined;
        if (Array.isArray(cat?.gaps)) out.push(...(cat!.gaps as unknown[]).filter((g): g is string => typeof g === "string"));
    }
    return [...new Set(out)].slice(0, 12);
}

/**
 * Build the interview-prep dossier. `baseCv` is the candidate's source CV and
 * `tailoredCv` the version optimized for this JD; the diff between them seeds
 * the "claims to defend" list.
 */
export async function generateDossier(
    baseCv: unknown, jd: unknown, match: unknown, tailoredCv: unknown,
): Promise<Dossier> {
    if (!baseCv || !jd) throw new Error("cv and jd are required");

    // Deterministic: bullets the optimizer rephrased → be ready to defend them.
    const flagged: FlaggedClaim[] = verifyOptimizedCv(baseCv, tailoredCv ?? baseCv)
        .filter(v => v.tier === "flag")
        .slice(0, 12)
        .map(v => ({
            claim: v.text,
            section: v.section,
            note: "Câu này đã được viết lại khi tối ưu CV — hãy chuẩn bị dẫn chứng cụ thể nếu bị hỏi sâu.",
        }));

    const gaps = gapsFromMatch(match);

    const userPrompt = JSON.stringify({
        jd,
        tailored_cv: tailoredCv ?? baseCv,
        gaps,
        claims_to_defend: flagged.map(f => f.claim),
    });

    const raw = await callAI(DOSSIER_SYSTEM_PROMPT, userPrompt, DOSSIER_SCHEMA);
    const parsed = safeJsonParse(raw) as Record<string, unknown> | null;
    if (!parsed) throw new Error("AI trả về JSON không hợp lệ. Vui lòng thử lại.");

    const rawQuestions = Array.isArray(parsed.likely_questions) ? parsed.likely_questions : [];
    const likely_questions: DossierQuestion[] = rawQuestions.map((q, i) => {
        const qq = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
        const difficulty = qq.difficulty === "easy" || qq.difficulty === "hard" ? qq.difficulty : "medium";
        return {
            id: `q${i + 1}`,
            question: String(qq.question ?? ""),
            category: String(qq.category ?? "Chung"),
            why: String(qq.why ?? ""),
            difficulty: difficulty as DossierQuestion["difficulty"],
        };
    }).filter(q => q.question);

    const talking_points = Array.isArray(parsed.talking_points)
        ? (parsed.talking_points as unknown[]).filter((t): t is string => typeof t === "string")
        : [];
    const modelGaps = Array.isArray(parsed.gaps)
        ? (parsed.gaps as unknown[]).map(g => {
            const gg = (g && typeof g === "object" ? g : {}) as Record<string, unknown>;
            return { gap: String(gg.gap ?? ""), how_to_prepare: String(gg.how_to_prepare ?? "") };
        }).filter(g => g.gap)
        : [];

    return { version: 1, likely_questions, talking_points, flagged_claims: flagged, gaps: modelGaps };
}
