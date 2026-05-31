import { NextRequest, NextResponse } from "next/server";
import { isAllowedUrl } from "@/lib/validation";

/**
 * Proxy to backend `/career/find`. Discovers a company's own careers page
 * (and the jobs listed on it) from one of:
 *   - input_url: a TopCV/VietnamWorks URL (company profile or job posting)
 *   - homepage_url: the company's own homepage
 *   - company_name: free-text, cache-lookup only
 *
 * The pipeline is described in backend/app/services/career_finder.py.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { input_url, homepage_url, company_name } = body ?? {};

        if (!input_url && !homepage_url && !company_name) {
            return NextResponse.json(
                { detail: "Provide input_url, homepage_url, or company_name" },
                { status: 400 },
            );
        }

        for (const u of [input_url, homepage_url] as (string | undefined)[]) {
            if (u && !isAllowedUrl(u)) {
                return NextResponse.json({ detail: `URL not allowed: ${u}` }, { status: 400 });
            }
        }

        const backendUrl = process.env.BACKEND_URL;
        if (!backendUrl) {
            return NextResponse.json({ detail: "BACKEND_URL not set" }, { status: 500 });
        }

        const response = await fetch(`${backendUrl}/career/find`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ input_url, homepage_url, company_name }),
            // Pipeline runs Stage 0 → 1 → 2 → 3 → 4; brute-force + sitemap can
            // each be slow. 90s upper bound matches the worst case observed.
            signal: AbortSignal.timeout(90000),
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
        const message = e instanceof Error ? e.message : "career/find proxy failed";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
