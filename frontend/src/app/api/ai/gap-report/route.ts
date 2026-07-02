import { NextRequest, NextResponse } from "next/server";
import { withCredits, creditErrorResponse } from "@/lib/credits-guard";
import { generateGapReport } from "@/lib/gap-report";

export async function POST(request: NextRequest) {
    try {
        const { cv, jd, match } = await request.json();
        if (!cv || !jd) {
            return NextResponse.json({ detail: "cv and jd are required" }, { status: 400 });
        }
        const result = await withCredits(request, "gap_report", 1, () => generateGapReport(cv, jd, match));
        return NextResponse.json(result);
    } catch (e: unknown) {
        const cr = creditErrorResponse(e); if (cr) return cr;
        const message = e instanceof Error ? e.message : "Failed to generate gap report";
        const status = message.includes("invalid JSON") || message.includes("không hợp lệ") ? 502 : 500;
        return NextResponse.json({ detail: message }, { status });
    }
}
