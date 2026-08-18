import { NextRequest, NextResponse } from "next/server";
import { withCredits, creditErrorResponse } from "@/lib/credits-guard";
import { generateCoverLetter } from "@/lib/cover-letter";

export async function POST(request: NextRequest) {
    try {
        const { cv, jd, match, lang, format } = await request.json();
        if (!cv || !jd) {
            return NextResponse.json({ detail: "cv and jd are required" }, { status: 400 });
        }
        const targetLang = typeof lang === "string" && lang ? lang : "vi";
        // A short in-form message is a fraction of the letter's generation, and
        // it is charged per APPLY rather than per user click — so it bills as
        // its own cheaper action instead of riding the letter's price.
        const fmt = format === "message" ? "message" : "letter";
        const action = fmt === "message" ? "apply_message" : "cover_letter";
        const coverLetter = await withCredits(request, action, 1, () =>
            generateCoverLetter(cv, jd, match, targetLang, fmt));
        return NextResponse.json({ coverLetter, lang: targetLang, format: fmt });
    } catch (e: unknown) {
        const cr = creditErrorResponse(e); if (cr) return cr;
        const message = e instanceof Error ? e.message : "Failed to generate cover letter";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
