import { NextRequest, NextResponse } from "next/server";
import { withCredits, creditErrorResponse } from "@/lib/credits-guard";
import { callAIExtract } from "@/lib/gemini";
import { safeJsonParse } from "@/lib/safe-json";
import { MAX_INPUT_TEXT_LENGTH } from "@/lib/validation";
import {
    CV_EXTRACTION_SYSTEM_PROMPT, normalizeCVResponse, CV_EXTRACTION_RESPONSE_SCHEMA,
} from "@/lib/cv-extraction-schema";

export async function POST(request: NextRequest) {
    try {
        const { raw_text } = await request.json();

        if (!raw_text) {
            return NextResponse.json({ detail: "raw_text is required" }, { status: 400 });
        }

        // ── Input size guard (H4) ──
        const text = typeof raw_text === "string" ? raw_text.slice(0, MAX_INPUT_TEXT_LENGTH) : "";

        const userPrompt = `Extract the following information from this CV text:\n\n${text}`;

        // Parse INSIDE the envelope: invalid AI JSON throws SyntaxError, which
        // refunds the charge before the 502 goes out — the user must not pay
        // for a "please retry".
        let parsed;
        try {
            parsed = await withCredits(request, "extract_cv", 1, async () => {
                const result = await callAIExtract(CV_EXTRACTION_SYSTEM_PROMPT, userPrompt, CV_EXTRACTION_RESPONSE_SCHEMA);
                return safeJsonParse(result);
            });
        } catch (e) {
            if (e instanceof SyntaxError) {
                return NextResponse.json({ detail: "AI returned invalid JSON. Please retry." }, { status: 502 });
            }
            throw e;
        }

        return NextResponse.json(normalizeCVResponse(parsed));
    } catch (e: unknown) {
        const cr = creditErrorResponse(e); if (cr) return cr;
        const message = e instanceof Error ? e.message : "Failed to extract CV";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
