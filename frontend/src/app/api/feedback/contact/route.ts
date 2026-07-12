import { NextRequest, NextResponse } from "next/server";

// PUBLIC proxy for the landing contact form → backend `POST /feedback/contact`.
// No auth headers (anonymous visitors); the submission lands in the same
// feedback table the admin panel reads, tagged source='contact'.
export async function POST(request: NextRequest): Promise<NextResponse> {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
        return NextResponse.json({ detail: "BACKEND_URL not set" }, { status: 500 });
    }
    const body = await request.text();
    try {
        const res = await fetch(`${backendUrl}/feedback/contact`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: AbortSignal.timeout(30_000),
        });
        const data = await res.json().catch(() => ({}));
        return NextResponse.json(data, { status: res.status });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "contact proxy failed";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
