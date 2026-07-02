import { NextRequest, NextResponse } from "next/server";
import { withCredits, creditErrorResponse } from "@/lib/credits-guard";
import { generateCoverLetter } from "@/lib/cover-letter";

export async function POST(request: NextRequest) {
    try {
        const { cv, jd, match, lang } = await request.json();
        if (!cv || !jd) {
            return NextResponse.json({ detail: "cv and jd are required" }, { status: 400 });
        }
        const targetLang = typeof lang === "string" && lang ? lang : "vi";
        const coverLetter = await withCredits(request, "cover_letter", 1, () =>
            generateCoverLetter(cv, jd, match, targetLang));
        return NextResponse.json({ coverLetter, lang: targetLang });
    } catch (e: unknown) {
        const cr = creditErrorResponse(e); if (cr) return cr;
        const message = e instanceof Error ? e.message : "Failed to generate cover letter";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
