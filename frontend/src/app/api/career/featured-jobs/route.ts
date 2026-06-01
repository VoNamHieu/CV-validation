import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy to backend `/career/featured-jobs`. Returns jobs aggregated across the
 * curated FEATURED_COMPANIES list (see backend/app/data/featured_companies.py).
 *
 * Used by the "Find jobs from my CV" button as the short-term demo flow while
 * the full company-first refactor lands.
 */
export async function POST(request: NextRequest) {
    try {
        const refresh = request.nextUrl.searchParams.get("refresh") === "true";
        const backendUrl = process.env.BACKEND_URL;
        if (!backendUrl) {
            return NextResponse.json({ detail: "BACKEND_URL not set" }, { status: 500 });
        }

        const response = await fetch(
            `${backendUrl}/career/featured-jobs${refresh ? "?refresh=true" : ""}`,
            {
                method: "POST",
                // Stage 4 fan-out across ~8 sites can take a while on a cold
                // cache; warm cache returns in <50ms.
                signal: AbortSignal.timeout(120_000),
            },
        );

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            return NextResponse.json(
                { detail: data?.detail || `Backend error: ${response.status}` },
                { status: response.status },
            );
        }
        return NextResponse.json(data);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "featured-jobs proxy failed";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
