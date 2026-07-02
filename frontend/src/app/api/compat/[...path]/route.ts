import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/backend-proxy";

/**
 * Catch-all proxy to the backend `/compat/*` career-page compatibility API
 * (probe / scan / results / recheck / remove / clear). Auth headers are
 * forwarded — the whole backend surface is admin-only. A scan renders SPA
 * career pages server-side, hence the long timeout.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "compat", path, 180_000);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "compat", path, 180_000);
}
