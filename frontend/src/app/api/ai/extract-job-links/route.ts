import { NextRequest, NextResponse } from "next/server";
import { callAILight } from "@/lib/gemini";
import { safeJsonParse } from "@/lib/safe-json";

/**
 * AI reads raw HTML text from a search results page
 * and extracts individual job posting URLs.
 */
export async function POST(request: NextRequest) {
    try {
        const { html_text, site_url } = await request.json();

        if (!html_text) {
            return NextResponse.json(
                { detail: "html_text is required" },
                { status: 400 }
            );
        }

        const systemPrompt = `You are an expert web scraper. Given the text content from a job search results page, extract all individual job posting URLs.

RULES:
- Look for URLs that point to individual job postings (not category pages, not the homepage).
- Job posting URLs usually contain patterns like: /job/, /viec-lam/, /jobs/, /work/, or have job-specific IDs.
- Return FULL URLs (with https://). If the URL is relative, prepend the site domain.
- Filter out URLs that are clearly NOT job postings (login pages, about pages, contact pages, FAQ, etc.).
- If you find fewer than 1 job URL, return an empty array and set "found" to false.
- Maximum 20 URLs.

Return ONLY valid JSON matching this schema:
{
  "found": boolean,
  "job_urls": ["string"],
  "total_found": number
}`;

        const userPrompt = `Extract job posting URLs from this search results page.

SITE: ${site_url || "unknown"}

PAGE CONTENT:
${html_text.slice(0, 20000)}`;

        const result = await callAILight(systemPrompt, userPrompt);
        let parsed;
        try { parsed = safeJsonParse(result); }
        catch { return NextResponse.json({ detail: "AI returned invalid JSON. Please retry." }, { status: 502 }); }

        return NextResponse.json(parsed);
    } catch (e: unknown) {
        const message =
            e instanceof Error ? e.message : "Failed to extract job links";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
