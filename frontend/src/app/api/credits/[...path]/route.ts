import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/backend-proxy";

/** Catch-all proxy to the backend `/credits/*` API (balance, costs, spend). */
export async function GET(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "credits", path);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
    const { path } = await ctx.params;
    return proxyToBackend(request, "credits", path);
}
