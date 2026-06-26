import { NextRequest, NextResponse } from "next/server";

/**
 * Catch-all proxy to the backend `/monitor/*` link-health API
 * (report / links / scan / recheck / remove / clear). Forwards method, path,
 * query string and JSON body unchanged.
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
        const response = await fetch(`${backendUrl}/monitor/${suffix}${qs}`, {
            method: request.method,
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body,
            // A full scan fetches many job pages server-side; give it room.
            signal: AbortSignal.timeout(180_000),
        });
        const data = await response.json().catch(() => ({}));
        return NextResponse.json(data, { status: response.status });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "monitor proxy failed";
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
