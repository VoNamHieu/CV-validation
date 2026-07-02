import { NextRequest, NextResponse } from "next/server";
import { withCredits, creditErrorResponse } from "@/lib/credits-guard";
import { callAILight } from "@/lib/gemini";
import { safeJsonParse } from "@/lib/safe-json";

/**
 * AI reads the CV data and the target job site URL,
 * then generates: search keywords + a search URL for that site.
 */
export async function POST(request: NextRequest) {
    try {
        const { cv, siteUrl, jobTitle } = await request.json();

        if (!cv || !siteUrl) {
            return NextResponse.json(
                { detail: "cv and siteUrl are required" },
                { status: 400 }
            );
        }

        // The role is normally confirmed by the user on the upload step and
        // passed in here; only fall back to inferring it from the CV if absent.
        const confirmedTitle = typeof jobTitle === "string" ? jobTitle.trim() : "";

        const systemPrompt = `You are an expert job search assistant. Given a candidate's CV data and a job website URL, you must:
1. ${confirmedTitle
                ? `Use the candidate's confirmed target role: "${confirmedTitle}". Do NOT pick a different role — translate it to the language most appropriate for the job site if needed, but keep the same role.`
                : `Analyze the CV to determine the most suitable job title / search keyword (in the language most appropriate for the job site).`}
2. Generate a search URL for that specific job website.

IMPORTANT RULES:
- For Vietnamese job sites (vietnamworks.com, careerbuilder.vn, timviecnhanh.com), use Vietnamese keywords if the CV suggests a Vietnamese-speaking candidate, otherwise use English.
- For international sites (indeed.com, linkedin.com, glassdoor.com), use English keywords.
- You must understand common URL patterns for major job sites:
  * vietnamworks.com → https://www.vietnamworks.com/viec-lam?q={keyword} (use hyphens between words)
  // * topcv.vn → https://www.topcv.vn/tim-viec-lam-{keyword} (hyphens between words, no slashes in keyword) — DISABLED: topcv path commented out, only fetch from embedded sites
  * indeed.com → https://www.indeed.com/jobs?q={keyword}
  * linkedin.com → https://www.linkedin.com/jobs/search/?keywords={keyword}
  * glassdoor.com → https://www.glassdoor.com/Job/jobs.htm?sc.keyword={keyword}
  * careerbuilder.vn → https://careerbuilder.vn/viec-lam/{keyword}-kw.html
- If you don't know the exact URL pattern, make your best guess based on common patterns.
- Replace spaces in keywords with hyphens for URL-friendly format.
- Pick a SPECIFIC job title, not vague terms. e.g. "frontend-developer" not "developer".

Return ONLY valid JSON matching this schema:
{
  "inferred_job_title": "string (the job title you think the candidate is looking for)",
  "search_keyword": "string (URL-friendly keyword, hyphens instead of spaces)",
  "search_url": "string (full search URL for the given site)",
  "reasoning": "string (brief explanation of why you chose this job title)"
}`;

        const userPrompt = `Analyze this CV and generate a search URL for the job site.
${confirmedTitle ? `\nCONFIRMED TARGET ROLE (use this exact role): ${confirmedTitle}\n` : ""}
CANDIDATE CV (JSON):
${JSON.stringify(cv, null, 2)}

TARGET JOB SITE URL: ${siteUrl}

Generate the most relevant job search URL for this candidate on this site.`;

        let parsed: Record<string, unknown> | Record<string, unknown>[];
        try {
            parsed = await withCredits(request, "smart_search", 1, async () => {
                const raw = await callAILight(systemPrompt, userPrompt);
                return safeJsonParse<Record<string, unknown> | Record<string, unknown>[]>(raw);
            });
        } catch (e) {
            if (e instanceof SyntaxError) {
                return NextResponse.json({ detail: "AI returned invalid JSON. Please retry." }, { status: 502 });
            }
            throw e;
        }

        // LLM sometimes returns an array instead of an object — unwrap it
        if (Array.isArray(parsed)) {
            console.log('[smart-search] Got array with', parsed.length, 'items, using first element');
            parsed = parsed[0];
        }

        // Validate required fields
        if (!parsed?.search_url || !parsed?.inferred_job_title) {
            console.log('[smart-search] Missing required fields in:', JSON.stringify(parsed));
            return NextResponse.json(
                { detail: "AI failed to generate a valid search URL. Please try again." },
                { status: 500 }
            );
        }



        return NextResponse.json(parsed);
    } catch (e: unknown) {
        const cr = creditErrorResponse(e); if (cr) return cr;
        const message =
            e instanceof Error ? e.message : "Failed to generate search";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
