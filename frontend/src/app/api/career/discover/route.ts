import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy to backend `/career/discover`. Grounded-search alternative to the
 * curated featured list: Gemini finds companies hiring for the candidate's role,
 * then the career pipeline lists their jobs. Same response shape as
 * /api/career/featured-jobs (companies + warming flag), cached per role+location.
 */
export async function POST(request: NextRequest) {
    try {
        const backendUrl = process.env.BACKEND_URL;
        if (!backendUrl) {
            return NextResponse.json({ detail: "BACKEND_URL not set" }, { status: 500 });
        }

        const sp = request.nextUrl.searchParams;
        const role = (sp.get("role") || "").trim();
        if (!role) {
            return NextResponse.json({ detail: "role is required" }, { status: 422 });
        }
        const qs = new URLSearchParams({ role });
        const location = (sp.get("location") || "").trim();
        if (location) qs.set("location", location);
        const limit = sp.get("limit");
        if (limit) qs.set("limit", limit);
        if (sp.get("refresh") === "true") qs.set("refresh", "true");

        const response = await fetch(`${backendUrl}/career/discover?${qs.toString()}`, {
            method: "POST",
            // Backend returns fast (warming) on a cold cache, so a short timeout
            // is enough; the crawl continues server-side and the client polls.
            signal: AbortSignal.timeout(60_000),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            return NextResponse.json(
                { detail: data?.detail || `Backend error: ${response.status}` },
                { status: response.status },
            );
        }
        return NextResponse.json(data);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "discover proxy failed";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
