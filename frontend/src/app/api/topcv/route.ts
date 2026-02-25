import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy route: forwards TopCV search requests to the Python backend.
 * Works on both local (localhost:8000) and Vercel (via BACKEND_URL env var pointing to ngrok).
 */

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const res = await fetch(`${BACKEND_URL}/topcv/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(60000), // 60s — Playwright crawl can be slow
        });

        if (!res.ok) {
            const err = await res.json().catch(() => null);
            return NextResponse.json(
                { detail: err?.detail || `Backend error: ${res.status}` },
                { status: res.status }
            );
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Cannot connect to backend";
        return NextResponse.json(
            { detail: `Backend unreachable: ${message}. Make sure the Python backend is running.` },
            { status: 502 }
        );
    }
}
