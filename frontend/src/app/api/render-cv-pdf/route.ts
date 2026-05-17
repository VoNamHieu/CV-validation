import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy to backend /render/cv-pdf — turns optimized-CV HTML into a PDF base64
 * that the extension can upload into job application forms.
 */
export async function POST(request: NextRequest) {
    try {
        const { html, filename } = await request.json();

        if (!html || typeof html !== "string") {
            return NextResponse.json({ detail: "html is required" }, { status: 400 });
        }
        if (html.length > 500_000) {
            return NextResponse.json({ detail: "html too large" }, { status: 413 });
        }

        const backendUrl = process.env.BACKEND_URL;
        if (!backendUrl) {
            return NextResponse.json({ detail: "BACKEND_URL not set" }, { status: 500 });
        }

        const response = await fetch(`${backendUrl}/render/cv-pdf`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ html, filename }),
            signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
            const err = await response.text();
            return NextResponse.json(
                { detail: `Backend error: ${response.status} ${err.slice(0, 200)}` },
                { status: response.status },
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "render-cv-pdf proxy failed";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
