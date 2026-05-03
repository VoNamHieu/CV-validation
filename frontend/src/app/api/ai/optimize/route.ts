import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/gemini";
import { safeJsonParse } from "@/lib/safe-json";

export async function POST(request: NextRequest) {
    try {
        const { cv, jd, match } = await request.json();

        if (!cv || !jd || !match) {
            return NextResponse.json({ detail: "cv, jd, and match are required" }, { status: 400 });
        }

        const systemPrompt = `You are a CV optimizer that strictly follows anti-hallucination rules.
Return ONLY valid JSON matching this exact schema:
{
  "name": "string",
  "summary": "string",
  "skills": ["string"],
  "experience": [{"title": "string", "company": "string", "duration_months": number, "description": "string"}],
  "education": [{"degree": "string", "institution": "string", "year": "string"}],
  "projects": [{"name": "string", "description": "string"}]
}

STRICT GUARDRAILS:
1. Only use information explicitly found in the original CV.
2. DO NOT add new companies, new tools, new measurable results, or new skills not present in the original CV.
3. DO NOT invent numbers, metrics, or achievements.
4. Maintain the exact original job titles, companies, and duration.`;

        const userPrompt = `Optimize this CV for the given job description.

CANDIDATE CV (JSON):
${JSON.stringify(cv, null, 2)}

JOB DESCRIPTION (JSON):
${JSON.stringify(jd, null, 2)}

MATCH ANALYSIS (JSON):
${JSON.stringify(match, null, 2)}

OPTIMIZATION INSTRUCTIONS:
1. Rephrase the summary to better align with the JD keywords.
2. Reorder bullet points in experience descriptions to put the most relevant achievements first.
3. Improve wording with action verbs and emphasize transferable skills.
4. Keep the same structure, job titles, companies, and duration.
5. NEVER fabricate new information.`;

        const result = await callAI(systemPrompt, userPrompt);

        let parsed;
        try {
            parsed = safeJsonParse(result);
        }
        catch {
            return NextResponse.json({ detail: "AI returned invalid JSON. Please retry." }, { status: 502 });
        }

        return NextResponse.json(parsed);
    } catch (e: unknown) {

        const message = e instanceof Error ? e.message : "Failed to optimize CV";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
