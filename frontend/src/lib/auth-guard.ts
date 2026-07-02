import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side auth gate for AI routes that must not be anonymous (the
 * extension-facing Gemini proxies: tailor / map-form / agent-plan). These are
 * deliberately unmetered for now — the extension charges a flat per-job fee
 * via /credits/spend instead — but without at least a valid login they are a
 * free Gemini proxy for anyone with the URL.
 *
 * Verifies the bearer token against Supabase Auth. Mirrors the metering
 * philosophy of credits-guard: fails CLOSED on a missing/invalid token, fails
 * OPEN when Supabase itself is unreachable (an auth-infra hiccup must not
 * take the product down). When Supabase isn't configured (local dev) the gate
 * is a no-op, matching the backend's dev X-User-Id seam.
 */

let _client: SupabaseClient | null;
let _resolved = false;

function client(): SupabaseClient | null {
    if (!_resolved) {
        _resolved = true;
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _client = url && key
            ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
            : null;
    }
    return _client;
}

/** Returns a 401 response to send back, or null when the caller may proceed. */
export async function requireUser(request: Request): Promise<NextResponse | null> {
    const sb = client();
    if (!sb) return null; // auth not configured (local dev) → open

    const unauthorized = () => NextResponse.json(
        { detail: "Vui lòng đăng nhập để dùng tính năng AI.", code: "auth_required" },
        { status: 401 },
    );

    const auth = request.headers.get("authorization") || "";
    if (!auth.toLowerCase().startsWith("bearer ")) return unauthorized();
    const token = auth.slice(7).trim();
    if (!token) return unauthorized();

    try {
        const { data, error } = await sb.auth.getUser(token);
        if (error || !data?.user) return unauthorized();
    } catch {
        return null; // Supabase unreachable → fail open
    }
    return null;
}
