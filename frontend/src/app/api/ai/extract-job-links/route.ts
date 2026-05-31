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

        // Pre-extract every [LINK:href] text [/LINK] record from the upstream
        // payload (extension or backend produces this markup). Sending the AI
        // a compact, dedup'd link list — instead of 20k chars of mixed
        // header/footer/card text — guarantees no real link gets truncated
        // out, even on pages where job cards render late.
        const linkRecords: string[] = [];
        const seenHrefs = new Set<string>();
        const linkRe = /\[LINK:([^\]]+)\]\s*([\s\S]*?)\s*\[\/LINK\]/g;
        for (const m of html_text.matchAll(linkRe)) {
            const href = (m[1] || "").trim();
            const label = (m[2] || "").replace(/\s+/g, " ").trim().slice(0, 200);
            if (!href || seenHrefs.has(href)) continue;
            seenHrefs.add(href);
            linkRecords.push(`[LINK:${href}] ${label}`);
            if (linkRecords.length >= 400) break;
        }
        const compactLinks = linkRecords.join("\n");

        // ── DEBUG: log what arrived and what we extracted, so we can tell
        //    whether an empty-result run was caused by (a) upstream sending
        //    no [LINK:] markers at all, (b) markers present but no job-shaped
        //    URLs among them, or (c) AI failing to pick anything from a
        //    healthy link list. Server-side console — visible in dev logs.
        console.log("[extract-job-links] incoming payload", {
            siteUrl: site_url,
            htmlTextLen: html_text.length,
            linkMarkerCount: linkRecords.length,
            compactLinksLen: compactLinks.length,
            usingCompactLinks: !!compactLinks,
            firstLinkRecords: linkRecords.slice(0, 5),
        });

        const systemPrompt = `You are an expert web scraper. Given a list of links extracted from a job search results page, identify which ones are individual job postings (URL + the visible job title shown for that link).

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

        // Prefer the compact link list. Fall back to raw text only when the
        // page didn't come through the [LINK:...] preprocessor at all.
        const payload = compactLinks
            ? compactLinks.slice(0, 40000)
            : html_text.slice(0, 20000);

        const userPrompt = `Extract job posting URLs from this search results page.

SITE: ${site_url || "unknown"}

${compactLinks ? "LINKS ON PAGE (one per line):" : "PAGE CONTENT:"}
${payload}`;

        const result = await callAILight(systemPrompt, userPrompt);
        console.log("[extract-job-links] AI raw response", {
            len: result?.length || 0,
            sample: (result || "").slice(0, 500),
        });
        let parsed: { found?: boolean; jobs?: Array<{ url?: string; title?: string }>; total_found?: number };
        try { parsed = safeJsonParse(result); }
        catch {
            console.warn("[extract-job-links] AI returned invalid JSON");
            return NextResponse.json({ detail: "AI returned invalid JSON. Please retry." }, { status: 502 });
        }

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

        console.log("[extract-job-links] returning", {
            found: jobs.length > 0,
            jobsCount: jobs.length,
            firstJob: jobs[0] || null,
        });

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
