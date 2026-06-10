import { NextRequest, NextResponse } from "next/server";
import { callAILight } from "@/lib/gemini";
import { safeJsonParse } from "@/lib/safe-json";

/**
 * The "CV-fit brain" that runs BEFORE crawling.
 *
 * Given the candidate's CV and the list of job links found on the search
 * results page (url + visible title), rank them by how well each job fits
 * THIS candidate — so we spend our crawl budget on the most promising jobs
 * instead of whatever the site happened to list first.
 *
 * Note: ranking only uses the title text available on the results page (no
 * full JD yet — that's fetched after crawling). It's a cheap pre-filter, not
 * the final score.
 */

interface JobCandidate {
    url: string;
    title?: string;
}

// Keep the CV compact so we don't blow the token budget on a ranking task.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function compactCv(cv: any): string {
    if (!cv || typeof cv !== "object") return "";
    const skills = Array.isArray(cv.skills) ? cv.skills.slice(0, 30).join(", ") : "";
    const experience = Array.isArray(cv.experience)
        ? cv.experience
              .slice(0, 8)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((e: any) => {
                  const months = e?.duration_months ? ` (${e.duration_months}mo)` : "";
                  return `- ${e?.title || "?"}${e?.company ? ` @ ${e.company}` : ""}${months}`;
              })
              .join("\n")
        : "";
    return [
        cv.name && `Name: ${cv.name}`,
        cv.summary && `Summary: ${cv.summary}`,
        skills && `Skills: ${skills}`,
        experience && `Experience:\n${experience}`,
    ]
        .filter(Boolean)
        .join("\n");
}

const RANK_SCHEMA = {
    type: "OBJECT",
    properties: {
        ranked: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    url: { type: "STRING" },
                    title: { type: "STRING" },
                    fit_score: { type: "NUMBER" },
                    reason: { type: "STRING" },
                },
                required: ["url", "fit_score"],
            },
        },
    },
    required: ["ranked"],
};

export async function POST(request: NextRequest) {
    try {
        const { cv, jobs } = await request.json();

        if (!Array.isArray(jobs) || jobs.length === 0) {
            return NextResponse.json(
                { detail: "jobs (non-empty array) is required" },
                { status: 400 }
            );
        }

        // Normalize + cap the candidate list. De-dupe by URL.
        const seen = new Set<string>();
        const candidates: JobCandidate[] = [];
        for (const j of jobs as JobCandidate[]) {
            const url = typeof j === "string" ? j : j?.url;
            if (!url || seen.has(url)) continue;
            seen.add(url);
            candidates.push({ url, title: typeof j === "string" ? "" : (j?.title || "") });
            if (candidates.length >= 30) break;
        }

        if (candidates.length === 0) {
            return NextResponse.json(
                { detail: "No valid job URLs in jobs array" },
                { status: 400 }
            );
        }

        const systemPrompt = `You are an expert technical recruiter. Given a candidate's CV and a list of job postings (each with a URL and a visible title), rank the jobs from BEST to WORST fit for THIS specific candidate.

RULES:
- Judge fit using the candidate's actual skills, seniority, and experience — NOT generic desirability.
- You only have each job's title to go on (the full description isn't available yet), so rank on title relevance, role, and seniority match.
- fit_score is 0-100: 100 = perfect match, 0 = clearly irrelevant.
- reason is ONE short clause (max ~10 words) explaining the score.
- Include EVERY url you were given, exactly once, using the EXACT url string provided. Do NOT invent, modify, or drop URLs.
- Order the "ranked" array best-fit first.

Return ONLY valid JSON matching this schema:
{
  "ranked": [
    { "url": "string (exact, as given)", "title": "string", "fit_score": number, "reason": "string" }
  ]
}`;

        const userPrompt = `CANDIDATE CV:
${compactCv(cv)}

JOB POSTINGS TO RANK (${candidates.length}):
${candidates.map((c, i) => `${i + 1}. [${c.url}] ${c.title || "(no title)"}`).join("\n")}

Rank these jobs from best to worst fit for this candidate.`;

        const raw = await callAILight(systemPrompt, userPrompt, RANK_SCHEMA);
        let parsed: { ranked?: Array<{ url: string; title?: string; fit_score?: number; reason?: string }> };
        try {
            parsed = safeJsonParse(raw);
        } catch {
            return NextResponse.json(
                { detail: "AI returned invalid JSON. Please retry." },
                { status: 502 }
            );
        }

        // Defensive: keep only URLs we actually sent, in the AI's order, then
        // append any the AI forgot so we never silently lose candidates.
        const order = Array.isArray(parsed?.ranked) ? parsed.ranked : [];
        const ranked: Array<{ url: string; title: string; fit_score: number; reason: string }> = [];
        const used = new Set<string>();
        for (const r of order) {
            if (!r?.url || !seen.has(r.url) || used.has(r.url)) continue;
            used.add(r.url);
            const original = candidates.find((c) => c.url === r.url);
            ranked.push({
                url: r.url,
                title: r.title || original?.title || "",
                fit_score: typeof r.fit_score === "number" ? r.fit_score : 0,
                reason: r.reason || "",
            });
        }
        for (const c of candidates) {
            if (used.has(c.url)) continue;
            ranked.push({ url: c.url, title: c.title || "", fit_score: 0, reason: "not ranked by AI" });
        }

        return NextResponse.json({ ranked });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to rank jobs";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
