import { NextRequest, NextResponse } from "next/server";
import { isAllowedUrlResolved } from "@/lib/ssrf-server";

/**
 * Crawls a URL and returns cleaned text.
 * If ?keepLinks=true, also returns text with href URLs preserved so AI can extract links.
 */
export async function POST(request: NextRequest) {
    try {
        const { url, keepLinks } = await request.json();

        if (!url) {
            return NextResponse.json({ detail: "url is required" }, { status: 400 });
        }

        // ── SSRF Protection (H1) ──
        // Follow redirects manually and re-validate every hop: an allowed
        // public URL must not be able to 302 us into 169.254.x / private
        // ranges and have the body returned to the caller. The resolved check
        // also rejects a public hostname that DNS-resolves to an internal IP.
        const headers = {
            "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        };
        let currentUrl: string = url;
        let response: Response;
        for (let hop = 0; ; hop++) {
            if (!(await isAllowedUrlResolved(currentUrl))) {
                return NextResponse.json({ detail: "URL not allowed" }, { status: 400 });
            }
            response = await fetch(currentUrl, {
                headers,
                redirect: "manual",
                signal: AbortSignal.timeout(15000),
            });
            const location = response.headers.get("location");
            if (response.status < 300 || response.status >= 400 || !location) break;
            if (hop >= 5) {
                return NextResponse.json({ detail: "Too many redirects" }, { status: 502 });
            }
            currentUrl = new URL(location, currentUrl).toString();
        }

        if (!response.ok) {
            return NextResponse.json(
                { detail: `Failed to fetch URL: ${response.status}` },
                { status: 502 }
            );
        }

        const html = await response.text();

        // ── Extract JSON-LD JobPosting (before stripping tags) ──
        let jsonLd: Record<string, unknown> | null = null;
        const findJobPosting = (node: unknown): Record<string, unknown> | null => {
            if (Array.isArray(node)) {
                for (const item of node) {
                    const found = findJobPosting(item);
                    if (found) return found;
                }
                return null;
            }
            if (node && typeof node === 'object') {
                const obj = node as Record<string, unknown>;
                if (obj['@type'] === 'JobPosting') return obj;
                // Many sites wrap entries in an @graph array
                if (obj['@graph']) return findJobPosting(obj['@graph']);
            }
            return null;
        };
        const ldMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
        for (const m of ldMatches) {
            try {
                const found = findJobPosting(JSON.parse(m[1]));
                if (found) {
                    jsonLd = found;
                    break;
                }
            } catch { /* ignore parse errors */ }
        }

        // Standard text extraction (no links)
        const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 15000);

        // If keepLinks is true, extract text but preserve <a> href URLs
        let textWithLinks = "";
        if (keepLinks) {
            textWithLinks = html
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                // Convert <a href="..."> to [LINK:url] markers before stripping tags
                .replace(
                    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
                    (_, href, innerText) => {
                        const cleanInner = innerText
                            .replace(/<[^>]+>/g, "")
                            .trim();
                        return `[LINK:${href}] ${cleanInner} [/LINK]`;
                    }
                )
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/g, " ")
                .replace(/&amp;/g, "&")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 25000); // Larger limit for link extraction
        }

        return NextResponse.json({
            text,
            source_url: url,
            ...(keepLinks ? { textWithLinks } : {}),
            ...(jsonLd ? { jsonLd } : {}),
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to crawl URL";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
