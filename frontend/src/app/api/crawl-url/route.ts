import { NextRequest, NextResponse } from "next/server";

/**
 * Crawls a URL and returns cleaned text.
 * If ?keepLinks=true, also returns text with href URLs preserved so AI can extract links.
 */
export async function POST(request: NextRequest) {
    try {
        const { url, keepLinks } = await request.json();

        if (!url) {
            return NextResponse.json(
                { detail: "url is required" },
                { status: 400 }
            );
        }

        const response = await fetch(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml",
                "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
            },
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            return NextResponse.json(
                { detail: `Failed to fetch URL: ${response.status}` },
                { status: 400 }
            );
        }

        const html = await response.text();

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
        });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to crawl URL";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
