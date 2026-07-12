import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Rate limiting middleware for AI API routes (H1).
 * Prevents OpenAI API cost abuse by limiting requests per IP.
 *
 * NOTE: In-memory map resets on Vercel cold starts.
 * For strict enforcement, upgrade to Upstash Redis.
 */
const rateLimit = new Map<string, number[]>();
const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 20;  // 20 AI calls per minute per IP

// Only the expensive AI routes are worth throttling. This MUST be re-checked
// inside the function, not left to `config.matcher`: Next.js 16 no longer honors
// the matcher for the legacy `middleware` file (it's deprecated in favour of
// `proxy`), so without this guard the limiter ran on EVERY /api/* call. On
// localhost every request also collapses into the single `'unknown'` IP bucket
// (no x-forwarded-for), so a normal page load — /admin fires featured +
// applications + profiles + logo-by-domain ×N + admin/check on mount — blew past
// 20/min in seconds and got /api/admin/check a 429, which the admin page reads as
// a transient server error ("Không kiểm tra được quyền").
const RATE_LIMITED = (path: string): boolean =>
    path.startsWith('/api/ai/') || path === '/api/parse-pdf';

export function middleware(request: NextRequest) {
    if (!RATE_LIMITED(request.nextUrl.pathname)) return NextResponse.next();

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
