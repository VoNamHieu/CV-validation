import { NextRequest, NextResponse } from "next/server";
import { isAllowedUrl } from "@/lib/validation";

/**
 * Proxy to Railway backend for Playwright-based single-page fetch.
 * Used when a job detail page is a SPA and basic HTTP returns too little content.
 */
export async function POST(request: NextRequest) {
    try {
        const { url } = await request.json();

        if (!url) {
            return NextResponse.json({ detail: "url is required" }, { status: 400 });
        }

        // ── SSRF Protection (H1) ──
        if (!isAllowedUrl(url)) {
            return NextResponse.json({ detail: "URL not allowed" }, { status: 400 });
        }

        const backendUrl = process.env.BACKEND_URL;
        if (!backendUrl) {
            return NextResponse.json({ detail: "BACKEND_URL not set" }, { status: 500 });
        }

        console.log("[fetch-page] Proxying to backend:", url);

        const response = await fetch(`${backendUrl}/crawl/fetch-page`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
            signal: AbortSignal.timeout(45000),
        });

        if (!response.ok) {
            const err = await response.text();
            console.log("[fetch-page] Backend error:", response.status, err);
            return NextResponse.json({ detail: `Backend error: ${response.status}` }, { status: response.status });
        }

        const data = await response.json();
        console.log("[fetch-page] Success, text length:", data.text?.length, "method:", data.method);
        return NextResponse.json(data);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "fetch-page proxy failed";
        console.log("[fetch-page] Error:", message);
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
