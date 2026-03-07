import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Rate limiting middleware for AI API routes (H1).
 * Prevents Gemini API cost abuse by limiting requests per IP.
 *
 * NOTE: In-memory map resets on Vercel cold starts.
 * For strict enforcement, upgrade to Upstash Redis.
 */
const rateLimit = new Map<string, number[]>();
const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 20;  // 20 AI calls per minute per IP

export function middleware(request: NextRequest) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const now = Date.now();

    // Clean expired timestamps
    const timestamps = (rateLimit.get(ip) || []).filter(t => now - t < WINDOW_MS);

    if (timestamps.length >= MAX_REQUESTS) {
        return NextResponse.json(
            { detail: 'Rate limit exceeded. Please wait a minute.' },
            { status: 429 }
        );
    }

    timestamps.push(now);
    rateLimit.set(ip, timestamps);

    // Periodic cleanup: remove IPs with no recent activity (every ~100 requests)
    if (Math.random() < 0.01) {
        for (const [key, ts] of rateLimit.entries()) {
            if (ts.every(t => now - t > WINDOW_MS)) {
                rateLimit.delete(key);
            }
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/api/ai/:path*', '/api/parse-pdf'],
};
