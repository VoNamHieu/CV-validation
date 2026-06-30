import { NextRequest, NextResponse } from "next/server";

// Proxy funnel events to the FastAPI backend `/events` ingest endpoint (built
// separately). Fire-and-forget on the client; forwards the JSON body + auth
// headers so the backend can attach user_id from the JWT when present.
const AUTH_HEADERS = ["authorization", "x-user-id"];

export async function POST(request: NextRequest): Promise<NextResponse> {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
        return NextResponse.json({ detail: "BACKEND_URL not set" }, { status: 500 });
    }
    const body = await request.text();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    for (const h of AUTH_HEADERS) {
        const v = request.headers.get(h);
        if (v) headers[h] = v;
    }
    try {
        const res = await fetch(`${backendUrl}/events`, {
            method: "POST",
            headers,
            body,
            signal: AbortSignal.timeout(15_000),
        });
        const data = await res.json().catch(() => ({}));
        return NextResponse.json(data, { status: res.status });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "events proxy failed";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
