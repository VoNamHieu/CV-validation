import { NextRequest, NextResponse } from "next/server";
import { withCredits, creditErrorResponse } from "@/lib/credits-guard";
import { callAIWithPdf } from "@/lib/gemini";
import { safeJsonParse } from "@/lib/safe-json";
import { MAX_PDF_BASE64_LENGTH } from "@/lib/validation";
import {
    CV_EXTRACTION_SYSTEM_PROMPT, normalizeCVResponse,
    CV_EXTRACTION_RESPONSE_SCHEMA, JD_EXTRACTION_RESPONSE_SCHEMA,
} from "@/lib/cv-extraction-schema";

export async function POST(request: NextRequest) {
    try {
        const { pdf_base64, type } = await request.json();

        if (!pdf_base64) {
            return NextResponse.json({ detail: "pdf_base64 is required" }, { status: 400 });
        }

        // ── PDF size limit (H5) ──
        if (pdf_base64.length > MAX_PDF_BASE64_LENGTH) {
            return NextResponse.json({ detail: "PDF too large (max ~5MB)" }, { status: 413 });
        }

        const isCV = type === "cv";

        const systemPrompt = isCV
            ? CV_EXTRACTION_SYSTEM_PROMPT
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

        const responseSchema = isCV ? CV_EXTRACTION_RESPONSE_SCHEMA : JD_EXTRACTION_RESPONSE_SCHEMA;
        let parsed;
        try {
            parsed = await withCredits(request, "parse_pdf", 1, async () => {
                const result = await callAIWithPdf(systemPrompt, userPrompt, pdf_base64, responseSchema);
                return safeJsonParse(result);
            });
        } catch (e) {
            if (e instanceof SyntaxError) {
                return NextResponse.json({ detail: "AI returned invalid JSON. Please retry." }, { status: 502 });
            }
            throw e;
        }

        return NextResponse.json(isCV ? normalizeCVResponse(parsed) : parsed);
    } catch (e: unknown) {
        const cr = creditErrorResponse(e); if (cr) return cr;
        const message = e instanceof Error ? e.message : "Failed to parse PDF";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
