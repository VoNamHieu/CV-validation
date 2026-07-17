import { NextRequest, NextResponse } from "next/server";

// Proxy client incident reports to the FastAPI backend `/incidents` ingest
// endpoint. Fire-and-forget on the client (lib/incidents.ts); forwards the JSON
// body + auth headers so the backend can attach user_id from the JWT when
// present. Mirrors /api/events — same public, never-fails-the-app contract.
//
// This route was missing, so every client-side api_error/extension_error was
// silently 404-ing here (the reporter swallows failures) and never reached the
// incidents table — only backend-originated incidents were being logged.
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
        const res = await fetch(`${backendUrl}/incidents`, {
            method: "POST",
            headers,
            body,
            signal: AbortSignal.timeout(15_000),
        });
        const data = await res.json().catch(() => ({}));
        return NextResponse.json(data, { status: res.status });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "incidents proxy failed";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
