import { NextRequest, NextResponse } from "next/server";

/**
 * Catch-all proxy to the backend `/compat/*` career-page compatibility API
 * (probe / scan / results / recheck / remove / clear). Forwards method, path,
 * query string and JSON body unchanged. Mirrors the /monitor proxy.
 */
async function proxy(request: NextRequest, path: string[]) {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
        return NextResponse.json({ detail: "BACKEND_URL not set" }, { status: 500 });
    }
    const suffix = path.join("/");
    const qs = request.nextUrl.search; // includes leading "?" or ""
    const body = request.method === "POST" ? await request.text() : undefined;

    try {
        const response = await fetch(`${backendUrl}/compat/${suffix}${qs}`, {
            method: request.method,
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body,
            // A scan renders SPA career pages server-side; give it room.
            signal: AbortSignal.timeout(180_000),
        });
        const data = await response.json().catch(() => ({}));
        return NextResponse.json(data, { status: response.status });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "compat proxy failed";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const { path } = await ctx.params;
    return proxy(request, path);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const { path } = await ctx.params;
    return proxy(request, path);
}
