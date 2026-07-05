import { NextRequest, NextResponse } from "next/server";
import { withCredits, creditErrorResponse } from "@/lib/credits-guard";
import { generateDossier } from "@/lib/skills/interview/dossier";
import { cvHash } from "@/lib/interview/cv-hash";

// Interview-prep dossier. The first FREE_JOB_QUOTA distinct jobs an account
// generates a dossier for are free; generating one for a NEW job beyond that
// costs "interview_dossier" credits. Re-generating for a job that already has a
// prep (e.g. after a CV tweak) is always free, and a cache hit never charges.
// Orchestrated server-side: cache-check → (charge?) → generate → persist.
// Anonymous callers can't be metered/cached — they get a free, uncached dossier.
const FREE_JOB_QUOTA = 3;

function authHeaders(request: Request): Record<string, string> {
    const h: Record<string, string> = {};
    const a = request.headers.get("authorization");
    const x = request.headers.get("x-user-id");
    if (a) h["authorization"] = a;
    if (x) h["x-user-id"] = x;
    return h;
}

// Whether THIS generation should be charged: only when the user is past the
// free quota AND this is a job they haven't prepped before.
async function shouldCharge(backend: string, auth: Record<string, string>, jobRef: string): Promise<boolean> {
    try {
        const res = await fetch(`${backend}/me/interview/preps`, { headers: auth, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return false; // can't tell → fail open (don't charge)
        const rows = (await res.json()) as Array<{ job_ref: string }>;
        const jobs = new Set(rows.map(r => r.job_ref));
        if (jobs.has(jobRef)) return false;      // re-gen of an existing job → free
        return jobs.size >= FREE_JOB_QUOTA;       // new job beyond the free 3 → charge
    } catch {
        return false; // fail open — never block a dossier on a metering hiccup
    }
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
                    if (row?.dossier?.questions) {
                        return NextResponse.json({ dossier: row.dossier, cached: true, prep_id: row.id ?? null });
                    }
                }
            } catch { /* cache is an optimization — fall through to generate */ }
        }

        // 2. Generate — charged only for a new job past the free quota. withCredits
        //    refunds automatically if generation throws.
        const gen = () => generateDossier(cv, jd, match, tailoredCv, companyText);
        const charge = canCache && (await shouldCharge(backend!, auth, jobRef));
        const dossier = charge
            ? await withCredits(request, "interview_dossier", 1, gen)
            : await gen();

        // 3. Persist (best-effort; awaited so serverless doesn't kill it mid-flight).
        //    The PUT returns the row so the client learns prep_id for attempts.
        let prepId: string | null = null;
        if (canCache) {
            try {
                const put = await fetch(`${backend}/me/interview/prep`, {
                    method: "PUT",
                    headers: { ...auth, "Content-Type": "application/json" },
                    body: JSON.stringify({ job_ref: jobRef, cv_hash: hash, dossier }),
                    signal: AbortSignal.timeout(10_000),
                });
                if (put.ok) prepId = (await put.json())?.id ?? null;
            } catch { /* non-fatal: the dossier is still returned, just not cached */ }
        }

        return NextResponse.json({ dossier, cached: false, prep_id: prepId });
    } catch (e: unknown) {
        const cr = creditErrorResponse(e); if (cr) return cr; // 401/402 → friendly message
        const message = e instanceof Error ? e.message : "Failed to generate interview prep";
        const status = message.includes("JSON không hợp lệ") ? 502 : 500;
        console.error("[/api/ai/interview-prep] FAILED:", e instanceof Error ? (e.stack || e.message) : e);
        return NextResponse.json({ detail: message }, { status });
    }
}
