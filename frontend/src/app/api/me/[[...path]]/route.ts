import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/backend-proxy";

/**
 * Optional catch-all proxy to the backend `/me` + `/me/*` user-scoped API
 * (profile itself, cv-profiles, saved-jobs, applications). `[[...path]]` also
 * matches the bare `/api/me` (profile) — a required `[...path]` would 404 it.
 * Auth headers are forwarded by the proxy.
 */
type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(request: NextRequest, ctx: Ctx) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "me", path ?? []);
}

export async function POST(request: NextRequest, ctx: Ctx) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "me", path ?? []);
}

export async function PUT(request: NextRequest, ctx: Ctx) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "me", path ?? []);
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "me", path ?? []);
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "me", path ?? []);
}
