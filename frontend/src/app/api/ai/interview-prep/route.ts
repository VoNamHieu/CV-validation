import { NextRequest, NextResponse } from "next/server";
import { generateDossier } from "@/lib/skills/interview/dossier";
import { cvHash } from "@/lib/interview/cv-hash";

// Interview-prep dossier. FREE (no credit metering). Orchestrates the whole
// flow server-side: check the cache (/me/interview/prep) → miss → generate →
// persist → return. Caching only happens for an authenticated user (the cache
// is user-scoped); anonymous callers just get a fresh, uncached dossier.
function authHeaders(request: Request): Record<string, string> {
    const h: Record<string, string> = {};
    const a = request.headers.get("authorization");
    const x = request.headers.get("x-user-id");
    if (a) h["authorization"] = a;
    if (x) h["x-user-id"] = x;
    return h;
}

export async function POST(request: NextRequest) {
    try {
        const { jobRef, cv, jd, match, tailoredCv, companyText } = await request.json();
        if (!cv || !jd) {
            return NextResponse.json({ detail: "cv and jd are required" }, { status: 400 });
        }
        const backend = process.env.BACKEND_URL;
        const auth = authHeaders(request);
        const canCache = !!backend && !!jobRef && !!(auth["authorization"] || auth["x-user-id"]);
        const hash = await cvHash(tailoredCv ?? cv);

        // 1. Cache hit → return the stored dossier.
        if (canCache) {
            try {
                const res = await fetch(
                    `${backend}/me/interview/prep?job_ref=${encodeURIComponent(jobRef)}&cv_hash=${encodeURIComponent(hash)}`,
                    { headers: auth, signal: AbortSignal.timeout(10_000) },
                );
                if (res.ok) {
                    const row = await res.json();
                    if (row?.dossier?.questions) return NextResponse.json({ dossier: row.dossier, cached: true });
                }
            } catch { /* cache is an optimization — fall through to generate */ }
        }

        // 2. Generate.
        const dossier = await generateDossier(cv, jd, match, tailoredCv, companyText);

        // 3. Persist (best-effort; awaited so serverless doesn't kill it mid-flight).
        if (canCache) {
            try {
                await fetch(`${backend}/me/interview/prep`, {
                    method: "PUT",
                    headers: { ...auth, "Content-Type": "application/json" },
                    body: JSON.stringify({ job_ref: jobRef, cv_hash: hash, dossier }),
                    signal: AbortSignal.timeout(10_000),
                });
            } catch { /* non-fatal: the dossier is still returned, just not cached */ }
        }

        return NextResponse.json({ dossier, cached: false });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to generate interview prep";
        const status = message.includes("JSON không hợp lệ") ? 502 : 500;
        console.error("[/api/ai/interview-prep] FAILED:", e instanceof Error ? (e.stack || e.message) : e);
        return NextResponse.json({ detail: message }, { status });
    }
}
