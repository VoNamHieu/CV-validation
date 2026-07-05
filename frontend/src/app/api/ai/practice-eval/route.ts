import { NextRequest, NextResponse } from "next/server";
import { withCredits, creditErrorResponse } from "@/lib/credits-guard";
import { runPreChecks } from "@/lib/skills/interview/evaluate/pre-checks";
import { judgeStar } from "@/lib/skills/interview/evaluate/star-judge";
import { buildChecklist } from "@/lib/skills/interview/evaluate/checklist";
import { buildCoaching } from "@/lib/skills/interview/evaluate/coaching";
import type { Question } from "@/lib/skills/interview/types";
import type { CVData } from "@/lib/types";

// Evaluate one practice answer. METERED (withCredits "practice") — the star
// judge is the only LLM call; the deterministic pre-checks run first for free.
// The question + CV context are sent by the client (which already holds the
// dossier + CV); prep_id/question_id/attempt_no are for persistence.
function authHeaders(request: Request): Record<string, string> {
    const h: Record<string, string> = {};
    const a = request.headers.get("authorization");
    const x = request.headers.get("x-user-id");
    if (a) h["authorization"] = a;
    if (x) h["x-user-id"] = x;
    return h;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { prep_id, question_id, attempt_no, answer, self_reflection, question, cv } = body as {
            prep_id?: string; question_id?: string; attempt_no?: number;
            answer?: string; self_reflection?: string; question?: Question; cv?: CVData;
        };
        if (!answer || !question || !cv) {
            return NextResponse.json({ detail: "answer, question, and cv are required" }, { status: 400 });
        }
        const attemptNo = Number(attempt_no) || 1;

        const result = await withCredits(request, "practice", 1, async () => {
            // Deterministic first (free), then the single judge call.
            const pre = runPreChecks(answer, question, cv);
            const judge = await judgeStar(question, answer);
            const checklist = buildChecklist(pre, judge, question.section);
            const coaching = buildCoaching(checklist, question, attemptNo, self_reflection, judge.bridge_hint_vi);

            // Persist the attempt (best-effort — a persistence hiccup must not
            // fail the eval the user already paid for).
            const backend = process.env.BACKEND_URL;
            const auth = authHeaders(request);
            if (backend && prep_id && question_id && (auth["authorization"] || auth["x-user-id"])) {
                try {
                    await fetch(`${backend}/me/interview/attempts`, {
                        method: "POST",
                        headers: { ...auth, "Content-Type": "application/json" },
                        body: JSON.stringify({
                            prep_id, question_id, attempt_no: attemptNo,
                            answer_text: answer, self_reflection: self_reflection ?? null, checklist,
                        }),
                        signal: AbortSignal.timeout(10_000),
                    });
                } catch { /* non-fatal */ }
            }

            return { checklist, coaching, outline_reveal_allowed: attemptNo >= 2 };
        });

        return NextResponse.json(result);
    } catch (e: unknown) {
        const cr = creditErrorResponse(e); if (cr) return cr;
        const message = e instanceof Error ? e.message : "Failed to evaluate answer";
        console.error("[/api/ai/practice-eval] FAILED:", e instanceof Error ? (e.stack || e.message) : e);
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
