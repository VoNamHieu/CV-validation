import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/backend-proxy";

/** Catch-all proxy to the backend `/store/*` catalog API (companies + jobs). */
export async function GET(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "store", path);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "store", path);
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "store", path);
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "store", path);
}
