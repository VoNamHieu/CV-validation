import { NextRequest, NextResponse } from "next/server";

// Proxy the product-feedback POST to the FastAPI backend `/feedback` endpoint
// (built separately). Forwards the JSON body + auth headers; the backend
// resolves the user from the JWT. Kept as a dedicated route (not the catch-all
// proxy) so it hits `/feedback` exactly, with no trailing-slash redirect.
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
        const res = await fetch(`${backendUrl}/feedback`, {
            method: "POST",
            headers,
            body,
            signal: AbortSignal.timeout(30_000),
        });
        const data = await res.json().catch(() => ({}));
        return NextResponse.json(data, { status: res.status });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "feedback proxy failed";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
