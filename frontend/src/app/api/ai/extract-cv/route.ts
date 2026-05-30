import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/gemini";
import { safeJsonParse } from "@/lib/safe-json";
import { MAX_INPUT_TEXT_LENGTH } from "@/lib/validation";
import { CV_EXTRACTION_SYSTEM_PROMPT, normalizeCVResponse } from "@/lib/cv-extraction-schema";

export async function POST(request: NextRequest) {
    try {
        const { raw_text } = await request.json();

        if (!raw_text) {
            return NextResponse.json({ detail: "raw_text is required" }, { status: 400 });
        }

        // ── Input size guard (H4) ──
        const text = typeof raw_text === "string" ? raw_text.slice(0, MAX_INPUT_TEXT_LENGTH) : "";

        const userPrompt = `Extract the following information from this CV text:\n\n${text}`;

        const result = await callAI(CV_EXTRACTION_SYSTEM_PROMPT, userPrompt);

        let parsed;
        try { parsed = safeJsonParse(result); }
        catch { return NextResponse.json({ detail: "AI returned invalid JSON. Please retry." }, { status: 502 }); }

        return NextResponse.json(normalizeCVResponse(parsed));
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to extract CV";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
