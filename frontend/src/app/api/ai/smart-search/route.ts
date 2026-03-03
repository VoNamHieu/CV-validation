import { NextRequest, NextResponse } from "next/server";
import { callGemini } from "@/lib/gemini";

/**
 * AI reads the CV data and the target job site URL,
 * then generates: search keywords + a search URL for that site.
 */
export async function POST(request: NextRequest) {
    try {
        const { cv, siteUrl } = await request.json();

        if (!cv || !siteUrl) {
            return NextResponse.json(
                { detail: "cv and siteUrl are required" },
                { status: 400 }
            );
        }

        const systemPrompt = `You are an expert job search assistant. Given a candidate's CV data and a job website URL, you must:
1. Analyze the CV to determine the most suitable job title / search keyword (in the language most appropriate for the job site).
2. Generate a search URL for that specific job website.

IMPORTANT RULES:
- For Vietnamese job sites (vietnamworks.com, topcv.vn, careerbuilder.vn, timviecnhanh.com), use Vietnamese keywords if the CV suggests a Vietnamese-speaking candidate, otherwise use English.
- For international sites (indeed.com, linkedin.com, glassdoor.com), use English keywords.
- You must understand common URL patterns for major job sites:
  * vietnamworks.com → https://www.vietnamworks.com/viec-lam/{keyword}-kw
  * topcv.vn → https://www.topcv.vn/tim-viec-lam-{keyword}
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

CANDIDATE CV (JSON):
${JSON.stringify(cv, null, 2)}

TARGET JOB SITE URL: ${siteUrl}

Generate the most relevant job search URL for this candidate on this site.`;

        console.log('[smart-search] Site URL:', siteUrl);
        const result = await callGemini(systemPrompt, userPrompt);
        console.log('[smart-search] Raw AI response:', result);
        const parsed = JSON.parse(result);
        console.log('[smart-search] Parsed result:', JSON.stringify(parsed, null, 2));

        return NextResponse.json(parsed);
    } catch (e: unknown) {
        const message =
            e instanceof Error ? e.message : "Failed to generate search";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
