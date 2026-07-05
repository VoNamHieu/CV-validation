import { NextRequest, NextResponse } from "next/server";
import { generateDossier } from "@/lib/interview/dossier";

// Interview-prep dossier. FREE by pricing decision — no withCredits envelope,
// so this route never touches the credits backend. The generated dossier is
// cached by the client via PUT /api/me/interview/prep.
export async function POST(request: NextRequest) {
    try {
        const { cv, jd, match, tailoredCv } = await request.json();
        if (!cv || !jd) {
            return NextResponse.json({ detail: "cv and jd are required" }, { status: 400 });
        }
        const dossier = await generateDossier(cv, jd, match, tailoredCv);
        return NextResponse.json({ dossier });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to generate interview dossier";
        const status = message.includes("JSON không hợp lệ") ? 502 : 500;
        console.error("[/api/ai/interview-dossier] FAILED:", e instanceof Error ? (e.stack || e.message) : e);
        return NextResponse.json({ detail: message }, { status });
    }
}
