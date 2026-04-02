import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/openai";
import { safeJsonParse } from "@/lib/safe-json";

export async function POST(request: NextRequest) {
    try {
        const { cv, jd } = await request.json();

        if (!cv || !jd) {
            return NextResponse.json({ detail: "cv and jd are required" }, { status: 400 });
        }

        const systemPrompt = `You are a precise, objective ATS scoring algorithm. 
Return ONLY valid JSON matching this exact schema:
{
  "overall_score": number (0-100, weighted),
  "must_have_match": {"score": number, "reasoning": "string", "gaps": ["string"]},
  "experience_match": {"score": number, "reasoning": "string", "gaps": ["string"]},
  "domain_match": {"score": number, "reasoning": "string", "gaps": ["string"]},
  "seniority_match": {"score": number, "reasoning": "string", "gaps": ["string"]},
  "nice_to_have_match": {"score": number, "reasoning": "string", "gaps": ["string"]},
  "strength_summary": "string",
  "risk_flags": ["string"]
}`;

        const userPrompt = `Evaluate the candidate's CV against the Job Description.

CRITERIA & WEIGHTS:
1. Must-have skills (40%): Are the exact required tools/skills present?
2. Experience depth (25%): Do they have the required years of experience and impact?
3. Domain alignment (15%): Have they worked in the same industry/domain?
4. Seniority fit (10%): Does their past trajectory match the target seniority level?
5. Nice-to-have skills (10%): Have they touched the bonus tools/technologies?

CANDIDATE CV (JSON):
${JSON.stringify(cv, null, 2)}

JOB DESCRIPTION (JSON):
${JSON.stringify(jd, null, 2)}

Determine a score from 0-100 for each dimension, explain the reasoning briefly, list the gaps, and calculate the weighted overall score. Be rigorous and identify any risk flags.`;

        const result = await callAI(systemPrompt, userPrompt);

        let parsed;
        try { parsed = safeJsonParse(result); }
        catch { return NextResponse.json({ detail: "AI returned invalid JSON. Please retry." }, { status: 502 }); }

        return NextResponse.json(parsed);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to score fit";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
