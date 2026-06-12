import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/gemini";
import { safeJsonParse } from "@/lib/safe-json";
import { MAX_INPUT_TEXT_LENGTH } from "@/lib/validation";
import { JD_EXTRACTION_RESPONSE_SCHEMA } from "@/lib/cv-extraction-schema";

export async function POST(request: NextRequest) {
    try {
        const { raw_text } = await request.json();

        if (!raw_text) {
            return NextResponse.json({ detail: "raw_text is required" }, { status: 400 });
        }

        // ── Input size guard (H4) ──
        const text = typeof raw_text === "string" ? raw_text.slice(0, MAX_INPUT_TEXT_LENGTH) : "";

        const systemPrompt = `You are an intelligent Job Description parser. Extract strict and accurate requirements.
Return ONLY valid JSON matching this exact schema:
{
  "must_have": ["string"],
  "nice_to_have": ["string"],
  "responsibilities": ["string"],
  "seniority_expected": "string (e.g., Junior, Mid-level, Senior, Executive)",
  "domain": "string (e.g., Fintech, E-commerce, Healthcare)"
}`;

        const userPrompt = `Extract the key requirements, nice-to-haves, responsibilities, seniority, and domain from this Job Description:\n\n${text}`;

        const result = await callAI(systemPrompt, userPrompt, JD_EXTRACTION_RESPONSE_SCHEMA);

        let parsed;
        try { parsed = safeJsonParse(result); }
        catch { return NextResponse.json({ detail: "AI returned invalid JSON. Please retry." }, { status: 502 }); }

        return NextResponse.json(parsed);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to extract JD";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
