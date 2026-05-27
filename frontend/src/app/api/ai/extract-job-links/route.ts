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

        const systemPrompt = `You are an expert web scraper. Given the text content from a job search results page, extract all individual job postings (URL + the visible job title shown for that link).

RULES:
- Look for URLs that point to individual job postings (not category pages, not the homepage).
- Job posting URLs usually contain patterns like: /job/, /viec-lam/, /jobs/, /work/, or have job-specific IDs.
- Return FULL URLs (with https://). If the URL is relative, prepend the site domain.
- For each job, also capture the visible job title text shown next to that link (e.g. "Senior Frontend Developer"). If no title is visible, use an empty string.
- Filter out URLs that are clearly NOT job postings (login pages, about pages, contact pages, FAQ, etc.).
- If you find fewer than 1 job URL, return an empty array and set "found" to false.
- Maximum 20 jobs.

Return ONLY valid JSON matching this schema:
{
  "found": boolean,
  "jobs": [{ "url": "string", "title": "string" }],
  "total_found": number
}`;

        const userPrompt = `Extract job posting URLs from this search results page.

SITE: ${site_url || "unknown"}

PAGE CONTENT:
${html_text.slice(0, 20000)}`;

        const result = await callAILight(systemPrompt, userPrompt);
        let parsed: { found?: boolean; jobs?: Array<{ url?: string; title?: string }>; total_found?: number };
        try { parsed = safeJsonParse(result); }
        catch { return NextResponse.json({ detail: "AI returned invalid JSON. Please retry." }, { status: 502 }); }

        // Normalize: keep jobs with a url, de-dupe, and derive job_urls for
        // backward compatibility with callers that only read the URL list.
        const seen = new Set<string>();
        const jobs: Array<{ url: string; title: string }> = [];
        for (const j of Array.isArray(parsed?.jobs) ? parsed.jobs : []) {
            const url = j?.url?.trim();
            if (!url || seen.has(url)) continue;
            seen.add(url);
            jobs.push({ url, title: (j?.title || "").trim() });
        }

        return NextResponse.json({
            found: jobs.length > 0,
            jobs,
            job_urls: jobs.map((j) => j.url),
            total_found: typeof parsed?.total_found === "number" ? parsed.total_found : jobs.length,
        });
    } catch (e: unknown) {
        const message =
            e instanceof Error ? e.message : "Failed to extract job links";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
