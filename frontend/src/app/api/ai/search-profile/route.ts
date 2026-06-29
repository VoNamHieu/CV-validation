import { NextRequest, NextResponse } from "next/server";
import { spendCredits, creditErrorResponse } from "@/lib/credits-guard";
import { callAIExtract } from "@/lib/gemini";
import { safeJsonParse } from "@/lib/safe-json";
import { SEARCH_PROFILE_RESPONSE_SCHEMA } from "@/lib/cv-extraction-schema";

/**
 * Infer a job-SEARCH profile from the CV — not a single title. Reads the whole
 * CV (experience, skills, level) to figure out which roles the candidate can
 * realistically land (target + adjacent), which domains they fit, and their key
 * strengths. Drives the grounded "find suitable jobs" search. Salary/location
 * are intentionally NOT inferred here — they're user preferences.
 */
export async function POST(request: NextRequest) {
    try {
        const { cv } = await request.json();
        if (!cv) {
            return NextResponse.json({ detail: "cv is required" }, { status: 400 });
        }

        const systemPrompt = `You are a senior career advisor. Read the candidate's CV with empathy and judgement — their actual experience, skills, level and trajectory — and infer what roles they should be searching for.
Return ONLY valid JSON matching this exact schema:
{
  "target_roles": ["string"],   // 2-4 realistic roles, including ADJACENT ones the CV genuinely supports (e.g. Product Manager → Product Owner, Business Analyst, Associate PM). Most-fitting first.
  "domains": ["string"],         // 1-3 industries/domains the candidate fits, drawn from their experience (e.g. Fintech, E-commerce)
  "strengths": ["string"],       // 3-6 strongest, most marketable skills/abilities from the CV
  "seniority": "string"          // Junior | Mid-level | Senior | Lead
}

Rules:
- Ground EVERY value in the CV. Do NOT invent roles, domains, or skills the CV doesn't support.
- target_roles must stay within reach of this candidate's real experience — do not suggest unrelated or far-higher roles.
- Keep titles generic and searchable (e.g. "Product Manager", not a company-specific title).`;

        const userPrompt = `Infer the candidate's job-search profile from this CV (JSON):\n\n${JSON.stringify(cv)}`;

        await spendCredits(request, "search_profile");
        const result = await callAIExtract(systemPrompt, userPrompt, SEARCH_PROFILE_RESPONSE_SCHEMA);
        let parsed;
        try { parsed = safeJsonParse(result); }
        catch { return NextResponse.json({ detail: "AI returned invalid JSON. Please retry." }, { status: 502 }); }

        return NextResponse.json(parsed);
    } catch (e: unknown) {
        const cr = creditErrorResponse(e); if (cr) return cr;
        const message = e instanceof Error ? e.message : "Failed to infer search profile";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
