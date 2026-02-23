import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/gemini";

export async function POST(request: NextRequest) {
    try {
        const { raw_text } = await request.json();

        if (!raw_text) {
            return NextResponse.json({ detail: "raw_text is required" }, { status: 400 });
        }

        const systemPrompt = `You are an intelligent Job Description parser. Extract strict and accurate requirements.
Return ONLY valid JSON matching this exact schema:
{
  "must_have": ["string"],
  "nice_to_have": ["string"],
  "responsibilities": ["string"],
  "seniority_expected": "string (e.g., Junior, Mid-level, Senior, Executive)",
  "domain": "string (e.g., Fintech, E-commerce, Healthcare)"
}`;

        const userPrompt = `Extract the key requirements, nice-to-haves, responsibilities, seniority, and domain from this Job Description:\n\n${raw_text}`;

        const result = await callGemini(systemPrompt, userPrompt);
        const parsed = JSON.parse(result);

        return NextResponse.json(parsed);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to extract JD";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
