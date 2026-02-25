import { NextRequest, NextResponse } from "next/server";

// ── Types ────────────────────────────────────────────────────────────────────

interface CrawlResult {
    url: string;
    http_success: boolean;
    needs_playwright: boolean;
    has_json_ld: boolean;
    json_ld_data: Record<string, string> | null;
    raw_html_length: number;
    cleaned_text: string;
    cleaned_text_length: number;
    error: string;
    latency_ms: number;
}

// ── JSON-LD Extraction ───────────────────────────────────────────────────────

function extractJsonLd(html: string): Record<string, unknown> | null {
    const regex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = regex.exec(html)) !== null) {
        try {
            const data = JSON.parse(match[1]);
            const items = Array.isArray(data) ? data : [data];

            for (const item of items) {
                if (item?.["@type"] === "JobPosting") return item;
                // Handle @graph arrays
                if (item?.["@graph"]) {
                    for (const node of item["@graph"]) {
                        if (node?.["@type"] === "JobPosting") return node;
                    }
                }
            }
        } catch {
            continue;
        }
    }
    return null;
}

// ── Parse JSON-LD ────────────────────────────────────────────────────────────

function parseJobFromJsonLd(data: Record<string, unknown>): Record<string, string> {
    const locationRaw = data.jobLocation as Record<string, unknown> | Record<string, unknown>[] | undefined;
    let location = "";

    if (Array.isArray(locationRaw) && locationRaw.length > 0) {
        const addr = (locationRaw[0] as Record<string, unknown>)?.address as Record<string, string> | undefined;
        location = addr?.addressLocality || "";
    } else if (locationRaw && typeof locationRaw === "object") {
        const addr = (locationRaw as Record<string, unknown>).address as Record<string, string> | undefined;
        location = addr?.addressLocality || "";
    }

    const hiringOrg = data.hiringOrganization as Record<string, string> | string | undefined;
    const company = typeof hiringOrg === "object" ? hiringOrg?.name || "" : String(hiringOrg || "");

    let description = String(data.description || "");
    if (description.length > 500) description = description.slice(0, 500) + "...";

    return {
        title: String(data.title || ""),
        company,
        location,
        description,
        employment_type: String(data.employmentType || ""),
        date_posted: String(data.datePosted || ""),
        source: "json_ld",
    };
}

// ── HTML Cleaning ────────────────────────────────────────────────────────────

function cleanHtml(html: string): string {
    let text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, "")
        .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
        .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "")
        .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
        .replace(/<[^>]+>/g, "\n")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"');

    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.join("\n");
}

// ── Playwright Detection Heuristic ───────────────────────────────────────────

function detectNeedsPlaywright(html: string): boolean {
    const signals = [
        "window.__reactFiber",
        "ng-version",
        "__nuxt__",
        "data-reactroot",
        "Loading...",
        "__NEXT_DATA__",
    ];
    if (html.length < 2000) return true;
    return signals.some((s) => html.includes(s));
}

// ── Crawl Single URL ─────────────────────────────────────────────────────────

async function crawlUrl(url: string): Promise<CrawlResult> {
    const result: CrawlResult = {
        url,
        http_success: false,
        needs_playwright: false,
        has_json_ld: false,
        json_ld_data: null,
        raw_html_length: 0,
        cleaned_text: "",
        cleaned_text_length: 0,
        error: "",
        latency_ms: 0,
    };

    const start = Date.now();

    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
            signal: AbortSignal.timeout(15000),
            redirect: "follow",
        });

        if (!res.ok) {
            result.error = `HTTP ${res.status}`;
            result.needs_playwright = true;
            result.latency_ms = Date.now() - start;
            return result;
        }

        const html = await res.text();

        if (html.length < 1000 || !html.toLowerCase().includes("<html")) {
            result.error = `Response too short or not HTML (${html.length} chars)`;
            result.needs_playwright = true;
            result.latency_ms = Date.now() - start;
            return result;
        }

        result.http_success = true;
        result.raw_html_length = html.length;
        result.needs_playwright = detectNeedsPlaywright(html);

        // JSON-LD extraction
        const jsonLd = extractJsonLd(html);
        if (jsonLd) {
            result.has_json_ld = true;
            result.json_ld_data = parseJobFromJsonLd(jsonLd);
        }

        // HTML cleaning
        result.cleaned_text = cleanHtml(html);
        result.cleaned_text_length = result.cleaned_text.length;

        // Truncate cleaned_text for response to avoid huge payloads
        if (result.cleaned_text.length > 3000) {
            result.cleaned_text = result.cleaned_text.slice(0, 3000) + "\n\n… truncated";
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        result.error = msg.slice(0, 200);
        result.needs_playwright = true;
    }

    result.latency_ms = Date.now() - start;
    return result;
}

// ── API Handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
    try {
        const { urls } = await request.json();

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return NextResponse.json({ detail: "At least one URL is required." }, { status: 400 });
        }

        if (urls.length > 10) {
            return NextResponse.json({ detail: "Maximum 10 URLs per request." }, { status: 400 });
        }

        const validUrls = urls.map((u: string) => u.trim()).filter(Boolean);
        if (validUrls.length === 0) {
            return NextResponse.json({ detail: "No valid URLs provided." }, { status: 400 });
        }

        // Crawl all URLs concurrently
        const results = await Promise.all(validUrls.map(crawlUrl));
        const total = results.length;

        const summary = {
            total,
            json_ld_count: results.filter((r) => r.has_json_ld).length,
            json_ld_pct: Math.round((results.filter((r) => r.has_json_ld).length / total) * 100),
            http_ok_count: results.filter((r) => r.http_success && !r.needs_playwright).length,
            http_ok_pct: Math.round(
                (results.filter((r) => r.http_success && !r.needs_playwright).length / total) * 100
            ),
            playwright_count: results.filter((r) => r.needs_playwright).length,
            playwright_pct: Math.round((results.filter((r) => r.needs_playwright).length / total) * 100),
            avg_latency_ms: Math.round(results.reduce((sum, r) => sum + r.latency_ms, 0) / total),
        };

        return NextResponse.json({ results, summary });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to process crawl request";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
