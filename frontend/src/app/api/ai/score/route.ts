import { NextRequest, NextResponse } from "next/server";
import { scoreFit } from "@/lib/tailor";

export async function POST(request: NextRequest) {
    try {
        const { cv, jd } = await request.json();
        if (!cv || !jd) {
            return NextResponse.json({ detail: "cv and jd are required" }, { status: 400 });
        }
        const result = await scoreFit(cv, jd);
        return NextResponse.json(result);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to score fit";
        const status = message.includes("invalid JSON") ? 502 : 500;
        return NextResponse.json({ detail: message }, { status });
    }
}
