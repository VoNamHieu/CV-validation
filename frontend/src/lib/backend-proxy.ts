import { NextRequest, NextResponse } from "next/server";

/**
 * Shared catch-all proxy to the FastAPI backend. Keeps the Supabase
 * `DATABASE_URL` server-side: the browser only ever talks to these Next API
 * routes, which forward to `BACKEND_URL`.
 *
 * Forwards method, trailing path, query string, JSON body, and the auth
 * headers (`Authorization` bearer + dev `X-User-Id`) unchanged. JSON responses
 * are re-serialized; NON-JSON responses (e.g. logo image bytes from
 * /store/companies/{id}/logo) are streamed through untouched — parsing those as
 * JSON returns `{}` and breaks every <img> that points at a proxied endpoint.
 */
const AUTH_HEADERS = ["authorization", "x-user-id"];
const METHODS_WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

export async function proxyToBackend(
    request: NextRequest,
    prefix: string,
    path: string[],
    timeoutMs = 60_000,
): Promise<NextResponse> {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
        return NextResponse.json({ detail: "BACKEND_URL not set" }, { status: 500 });
    }

    const suffix = path.join("/");
    // No trailing slash when suffix is empty (bare `/me`): backend routes are
    // registered without one, so `/me/` would force a 307 redirect.
    const target = suffix ? `/${prefix}/${suffix}` : `/${prefix}`;
    const qs = request.nextUrl.search; // includes leading "?" or ""
    const body = METHODS_WITH_BODY.has(request.method) ? await request.text() : undefined;

    const headers: Record<string, string> = {};
    if (body) headers["Content-Type"] = "application/json";
    for (const h of AUTH_HEADERS) {
        const v = request.headers.get(h);
        if (v) headers[h] = v;
    }

    try {
        const response = await fetch(`${backendUrl}${target}${qs}`, {
            method: request.method,
            headers,
            body,
            signal: AbortSignal.timeout(timeoutMs),
        });
        const contentType = response.headers.get("content-type") || "";
        // Binary / non-JSON (image logos, files) → pass the raw bytes through
        // with the original content-type + cache-control, don't JSON-parse.
        if (!contentType.includes("application/json")) {
            const out = new NextResponse(await response.arrayBuffer(), { status: response.status });
            if (contentType) out.headers.set("Content-Type", contentType);
            const cache = response.headers.get("cache-control");
            if (cache) out.headers.set("Cache-Control", cache);
            return out;
        }
        const data = await response.json().catch(() => ({}));
        return NextResponse.json(data, { status: response.status });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : `${prefix} proxy failed`;
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
