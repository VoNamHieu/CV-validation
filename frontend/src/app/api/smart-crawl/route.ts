import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy to the Railway-hosted Python backend for Playwright-based crawling.
 * This is used when the target site is a SPA that can't be crawled with basic HTTP.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const backendUrl = process.env.BACKEND_URL;
        if (!backendUrl) {
            return NextResponse.json(
                { detail: "BACKEND_URL environment variable is not set" },
                { status: 500 }
            );
        }

        console.log("[smart-crawl-proxy] Forwarding to backend:", `${backendUrl}/crawl/smart-search`);
        console.log("[smart-crawl-proxy] Body:", JSON.stringify(body));

        const response = await fetch(`${backendUrl}/crawl/smart-search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60000), // 60s timeout for Playwright
        });

        if (!response.ok) {
            const err = await response.text();
            console.log("[smart-crawl-proxy] Backend error:", response.status, err);
            return NextResponse.json(
                { detail: `Backend error: ${response.status}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        console.log("[smart-crawl-proxy] Backend response:", JSON.stringify(data).slice(0, 500));
        return NextResponse.json(data);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Smart crawl proxy failed";
        console.log("[smart-crawl-proxy] Error:", message);
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
