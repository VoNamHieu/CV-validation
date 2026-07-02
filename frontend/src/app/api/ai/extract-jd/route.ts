import { NextRequest, NextResponse } from "next/server";
import { withCredits, creditErrorResponse } from "@/lib/credits-guard";
import { extractJd } from "@/lib/tailor";

export async function POST(request: NextRequest) {
    try {
        const { raw_text } = await request.json();
        if (!raw_text) {
            return NextResponse.json({ detail: "raw_text is required" }, { status: 400 });
        }
        const parsed = await withCredits(request, "extract_jd", 1, () => extractJd(raw_text));
        return NextResponse.json(parsed);
    } catch (e: unknown) {
        const cr = creditErrorResponse(e); if (cr) return cr;
        const message = e instanceof Error ? e.message : "Failed to extract JD";
        const status = message.includes("invalid JSON") ? 502 : 500;
        return NextResponse.json({ detail: message }, { status });
    }
}
