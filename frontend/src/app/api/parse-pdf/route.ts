import { NextRequest, NextResponse } from "next/server";
import { callGeminiWithPdf } from "@/lib/gemini";

export async function POST(request: NextRequest) {
    try {
        const { pdf_base64, type } = await request.json();

        if (!pdf_base64) {
            return NextResponse.json({ detail: "pdf_base64 is required" }, { status: 400 });
        }

        const isCV = type === "cv";

        const systemPrompt = isCV
            ? `You are an intelligent CV parser. Extract accurate and structured data.
Return ONLY valid JSON matching this exact schema:
{
  "name": "string",
  "summary": "string",
  "skills": ["string"],
  "experience": [{"title": "string", "company": "string", "duration_months": number, "description": "string"}],
  "education": [{"degree": "string", "institution": "string", "year": "string"}],
  "projects": [{"name": "string", "description": "string"}]
}
If some information is missing, leave strings empty or lists empty.`
            : `You are an intelligent Job Description parser. Extract strict and accurate requirements.
Return ONLY valid JSON matching this exact schema:
{
  "must_have": ["string"],
  "nice_to_have": ["string"],
  "responsibilities": ["string"],
  "seniority_expected": "string (e.g., Junior, Mid-level, Senior, Executive)",
  "domain": "string (e.g., Fintech, E-commerce, Healthcare)"
}`;

        const userPrompt = isCV
            ? "Extract all structured information from this CV/Resume PDF."
            : "Extract the key requirements, nice-to-haves, responsibilities, seniority, and domain from this Job Description PDF.";

        const result = await callGeminiWithPdf(systemPrompt, userPrompt, pdf_base64);
        const parsed = JSON.parse(result);

        return NextResponse.json(parsed);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to parse PDF";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
