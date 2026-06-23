import { NextRequest, NextResponse } from "next/server";
import { optimizeForJd, type OptimizeOptions } from "@/lib/tailor";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { cv, jd, match, options } = body as {
            cv: unknown; jd: unknown; match: unknown; options?: OptimizeOptions;
        };
        if (!cv || !jd || !match) {
            return NextResponse.json({ detail: "cv, jd, and match are required" }, { status: 400 });
        }
        const variants = await optimizeForJd(cv, jd, match, options);
        return NextResponse.json({ variants });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to optimize CV";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
