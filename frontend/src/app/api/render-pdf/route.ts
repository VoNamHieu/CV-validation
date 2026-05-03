import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy to Railway backend for Playwright-based HTML → PDF rendering.
 * Used by the CV preview to download a text-selectable, ATS-friendly PDF.
 */
export async function POST(request: NextRequest) {
    try {
        const { html, filename } = await request.json();

        if (!html || typeof html !== "string") {
            return NextResponse.json({ detail: "html is required" }, { status: 400 });
        }

        const backendUrl = process.env.BACKEND_URL;
        if (!backendUrl) {
            return NextResponse.json({ detail: "BACKEND_URL not set" }, { status: 500 });
        }

        const response = await fetch(`${backendUrl}/render/pdf`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ html, filename }),
            signal: AbortSignal.timeout(45000),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => "");
            return NextResponse.json(
                { detail: `Backend error: ${response.status} ${text}`.slice(0, 500) },
                { status: response.status },
            );
        }

        const pdfBytes = await response.arrayBuffer();
        const cd = response.headers.get("Content-Disposition")
            || `attachment; filename="${(filename as string | undefined) || "cv"}.pdf"`;

        return new NextResponse(pdfBytes, {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": cd,
            },
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "render-pdf proxy failed";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
