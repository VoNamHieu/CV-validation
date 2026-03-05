import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/gemini";
import { MAX_INPUT_TEXT_LENGTH } from "@/lib/validation";

export async function POST(request: NextRequest) {
    try {
        const { raw_text } = await request.json();

        if (!raw_text) {
            return NextResponse.json({ detail: "raw_text is required" }, { status: 400 });
        }

        // ── Input size guard (H4) ──
        const text = typeof raw_text === "string" ? raw_text.slice(0, MAX_INPUT_TEXT_LENGTH) : "";

        const systemPrompt = `You are an intelligent CV parser. Extract accurate and structured data. 
Return ONLY valid JSON matching this exact schema:
{
  "name": "string",
  "summary": "string",
  "skills": ["string"],
  "experience": [{"title": "string", "company": "string", "duration_months": number, "description": "string"}],
  "education": [{"degree": "string", "institution": "string", "year": "string"}],
  "projects": [{"name": "string", "description": "string"}]
}
If some information is missing, leave strings empty or lists empty.`;

        const userPrompt = `Extract the following information from this CV text:\n\n${text}`;

        const result = await callGemini(systemPrompt, userPrompt);

        let parsed;
        try { parsed = JSON.parse(result); }
        catch { return NextResponse.json({ detail: "AI returned invalid JSON. Please retry." }, { status: 502 }); }

        return NextResponse.json(parsed);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to extract CV";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
