import { NextRequest, NextResponse } from "next/server";

/**
 * Proxy to backend `/career/search` — the FACET ENGINE (Phase-1 search).
 *
 * Ranks the cached featured pool against a CV-derived (or explicit) profile by
 * role-family adjacency × industry × location (taxonomy.py), with an optional
 * Phase-2 embedding rerank. This is the relevance-aware ranker the auto-flow
 * uses instead of the old token-overlap title filter + LLM tournament.
 *
 * Body: { cv_text?, target_roles?, domains?, level?, desired_locations?,
 *         salary_floor?, limit?, rerank? }
 * Returns { warming?, profile, reranked, total_matched, results } where each
 * result is a flat job dict tagged with company, industry and `_facet`.
 */
export async function POST(request: NextRequest) {
    try {
        const backendUrl = process.env.BACKEND_URL;
        if (!backendUrl) {
            return NextResponse.json({ detail: "BACKEND_URL not set" }, { status: 500 });
        }

        const body = await request.json().catch(() => ({}));

        const response = await fetch(`${backendUrl}/career/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            // Warm cache ranks in <200ms; a cold cache returns {warming:true}
            // immediately (the client polls), so this is mostly a safety bound.
            signal: AbortSignal.timeout(120_000),
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
        const message = e instanceof Error ? e.message : "career/search proxy failed";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
