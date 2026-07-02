import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireUser } from "@/lib/auth-guard";
import { tailorForJob, type OptimizeOptions } from "@/lib/tailor";

// ─────────────────────────────────────────────────────────────────────────────
// Extension Mode-1 endpoint. This is the ONLY server endpoint that sees raw job-
// board JD text, and it is a STATELESS NO-STORE PASSTHROUGH:
//   • no DB write, no cache, no analytics
//   • the request body (CV + JD) is NEVER logged — only an opaque request_id is
//   • output is the user's own tailored CV (facts), persisted by a SEPARATE
//     endpoint that never sees the JD.
// The board JD transits process memory for the duration of the call only.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" };
const MAX_BODY_BYTES = 256 * 1024; // guard against oversized DOM dumps

export async function POST(request: NextRequest) {
    const reqId = randomUUID();
    try {
        // Login required — without it this route is an anonymous Gemini proxy.
        const unauth = await requireUser(request);
        if (unauth) return unauth;

        // Size guard — reject oversized payloads before parsing/forwarding.
        const len = Number(request.headers.get("content-length") || 0);
        if (len > MAX_BODY_BYTES) {
            return NextResponse.json(
                { detail: "Payload too large" }, { status: 413, headers: NO_STORE },
            );
        }

        const body = await request.json();
        const { cv, jd_text, source_ref, options } = body as {
            cv: unknown; jd_text: unknown; source_ref?: string; options?: OptimizeOptions;
        };
        if (!cv || !jd_text) {
            return NextResponse.json(
                { detail: "cv and jd_text are required" }, { status: 400, headers: NO_STORE },
            );
        }

        const result = await tailorForJob(cv, jd_text, options, source_ref ?? "");
        return NextResponse.json(result, { headers: NO_STORE });
    } catch (e: unknown) {
        // Log the failure class + request_id ONLY — never the JD/CV payload.
        const message = e instanceof Error ? e.message : "Failed to tailor CV";
        console.warn(`[tailor] request ${reqId} failed: ${message}`);
        const status = message.includes("invalid JSON") ? 502 : 500;
        return NextResponse.json({ detail: message }, { status, headers: NO_STORE });
    }
}
