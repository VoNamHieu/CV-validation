import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/gemini";
import { safeJsonParse } from "@/lib/safe-json";

type RawCategory = { score?: unknown; reasoning?: unknown; gaps?: unknown };

function normalizeCategory(c: unknown) {
    const cat = (c && typeof c === "object" ? c : {}) as RawCategory;
    const raw = typeof cat.score === "number" && Number.isFinite(cat.score) ? cat.score : 0;
    return {
        score: Math.min(100, Math.max(0, raw)),
        reasoning: typeof cat.reasoning === "string" ? cat.reasoning : "",
        gaps: Array.isArray(cat.gaps) ? cat.gaps.filter((g) => typeof g === "string") : [],
    };
}

// Category weights for the overall score (must sum to 1).
const WEIGHTS = {
    must_have_match: 0.4,
    experience_match: 0.25,
    domain_match: 0.15,
    seniority_match: 0.1,
    nice_to_have_match: 0.1,
} as const;

/**
 * Guarantee every CategoryScore the UI relies on exists, so a partial/omitted
 * category in the model output can't crash the report render.
 *
 * overall_score is recomputed here from the category scores: the weighted sum
 * is arithmetic, and the model's own "calculation" can contradict the very
 * category scores it just produced.
 */
function normalizeMatchResult(raw: unknown) {
    const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const categories = {
        must_have_match: normalizeCategory(m.must_have_match),
        experience_match: normalizeCategory(m.experience_match),
        domain_match: normalizeCategory(m.domain_match),
        seniority_match: normalizeCategory(m.seniority_match),
        nice_to_have_match: normalizeCategory(m.nice_to_have_match),
    };
    const overall = Math.round(
        (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>)
            .reduce((sum, key) => sum + categories[key].score * WEIGHTS[key], 0)
    );
    return {
        overall_score: overall,
        ...categories,
        strength_summary: typeof m.strength_summary === "string" ? m.strength_summary : "",
        risk_flags: Array.isArray(m.risk_flags) ? m.risk_flags.filter((f) => typeof f === "string") : [],
    };
}

const CATEGORY_SCHEMA = {
    type: "OBJECT",
    properties: {
        score: { type: "NUMBER" },
        reasoning: { type: "STRING" },
        gaps: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["score", "reasoning", "gaps"],
};

const MATCH_SCHEMA = {
    type: "OBJECT",
    properties: {
        overall_score: { type: "NUMBER" },
        must_have_match: CATEGORY_SCHEMA,
        experience_match: CATEGORY_SCHEMA,
        domain_match: CATEGORY_SCHEMA,
        seniority_match: CATEGORY_SCHEMA,
        nice_to_have_match: CATEGORY_SCHEMA,
        strength_summary: { type: "STRING" },
        risk_flags: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: [
        "overall_score", "must_have_match", "experience_match", "domain_match",
        "seniority_match", "nice_to_have_match", "strength_summary", "risk_flags",
    ],
};

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

        const result = await callAI(systemPrompt, userPrompt, MATCH_SCHEMA);

        let parsed;
        try { parsed = safeJsonParse(result); }
        catch { return NextResponse.json({ detail: "AI returned invalid JSON. Please retry." }, { status: 502 }); }

        return NextResponse.json(normalizeMatchResult(parsed));
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to score fit";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
