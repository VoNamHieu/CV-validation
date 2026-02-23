import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
    try {
        const { url } = await request.json();

        if (!url) {
            return NextResponse.json({ detail: "url is required" }, { status: 400 });
        }

        const response = await fetch(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml",
            },
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            return NextResponse.json(
                { detail: `Failed to fetch URL: ${response.status}` },
                { status: 400 }
            );
        }

        const html = await response.text();

        // Strip HTML tags and extract readable text
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
            .slice(0, 15000); // Limit to ~15k chars to fit in Gemini context

        return NextResponse.json({ text, source_url: url });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to crawl URL";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
