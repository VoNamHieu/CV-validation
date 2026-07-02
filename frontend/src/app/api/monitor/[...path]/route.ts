import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/backend-proxy";

/**
 * Catch-all proxy to the backend `/monitor/*` link-health API
 * (report / links / scan / recheck / remove / clear). Auth headers are
 * forwarded — the backend requires a logged-in user for /report and an admin
 * for everything else. A full scan fetches many job pages server-side, hence
 * the long timeout.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "monitor", path, 180_000);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "monitor", path, 180_000);
}
