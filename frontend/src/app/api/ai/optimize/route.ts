import { NextRequest, NextResponse } from "next/server";
import { callAI } from "@/lib/gemini";
import { safeJsonParse } from "@/lib/safe-json";
import { OPTIMIZE_RESPONSE_SCHEMA, repairOptimizedCv } from "@/lib/cv-optimize";

type OptimizeStyle = 'formal' | 'direct' | 'impact-driven' | 'storytelling';
type OptimizeFocus = 'balanced' | 'technical' | 'leadership' | 'metrics' | 'ats-keyword';
type OptimizeLength = 'concise' | 'detailed';

interface OptimizeOptions {
    style?: OptimizeStyle;
    focus?: OptimizeFocus;
    length?: OptimizeLength;
    variants?: number; // 1-3
    useGaps?: boolean;
}

interface VariantConfig {
    label: string;
    style: OptimizeStyle;
    focus: OptimizeFocus;
    length: OptimizeLength;
}

const STYLE_INSTRUCTIONS: Record<OptimizeStyle, string> = {
    formal: 'Use a formal, polished tone. Complete professional sentences. Avoid colloquialisms.',
    direct: 'Use a direct, concise tone. Short sentences. Strong action verbs. Cut filler words.',
    'impact-driven':
        'Lead each bullet with a measurable outcome (numbers, %, scope) when those metrics are present in the source. When metrics are absent, lead with the deliverable instead. NEVER invent numbers.',
    storytelling:
        'Use brief narrative phrasing — challenge → action → result. Keep it grounded in the source content; do not embellish.',
};

const FOCUS_INSTRUCTIONS: Record<OptimizeFocus, string> = {
    balanced: 'Balance technical, leadership, and impact signals.',
    technical:
        'Surface technologies, tools, frameworks, and engineering depth. Use precise technical vocabulary already present in the source CV.',
    leadership:
        'Highlight team size, mentorship, ownership, cross-functional collaboration, and decision-making — only where the source CV supports it.',
    metrics:
        'Foreground every quantifiable result already present in the source. Do not fabricate any new numbers.',
    'ats-keyword':
        'Front-load JD must-have keywords into the summary and the first sentence of each experience bullet, only where they faithfully describe the source content.',
};

const LENGTH_INSTRUCTIONS: Record<OptimizeLength, string> = {
    concise:
        'Tight, punchy phrasing — keep each bullet under ~25 words and the summary under ~70 words. PRESERVE every bullet from the source CV: shorten wording, never drop, merge, or summarize bullets together.',
    detailed:
        'Full descriptive phrasing — bullets up to ~40 words, summary up to ~100 words. PRESERVE every bullet from the source CV: you may split one source bullet into two only if that genuinely improves clarity.',
};

function clampVariantCount(n: unknown): number {
    const v = typeof n === 'number' ? n : 1;
    return Math.max(1, Math.min(3, Math.floor(v)));
}

function buildVariants(opts: OptimizeOptions): VariantConfig[] {
    const count = clampVariantCount(opts.variants);
    const length: OptimizeLength = opts.length ?? 'concise';

    if (count === 1) {
        return [{
            label: 'Tailored',
            style: opts.style ?? 'direct',
            focus: opts.focus ?? 'balanced',
            length,
        }];
    }
    if (count === 2) {
        return [
            { label: 'Direct & Technical', style: 'direct', focus: 'technical', length },
            { label: 'Impact & Metrics', style: 'impact-driven', focus: 'metrics', length },
        ];
    }
    return [
        { label: 'Direct & Technical', style: 'direct', focus: 'technical', length },
        { label: 'Impact & Metrics', style: 'impact-driven', focus: 'metrics', length },
        { label: 'Leadership Story', style: 'storytelling', focus: 'leadership', length: opts.length ?? 'detailed' },
    ];
}

interface CategoryScore { gaps?: string[] }
interface MatchAnalysis {
    must_have_match?: CategoryScore;
    experience_match?: CategoryScore;
    domain_match?: CategoryScore;
    seniority_match?: CategoryScore;
    nice_to_have_match?: CategoryScore;
}

function collectGaps(match: MatchAnalysis): string[] {
    const gaps: string[] = [];
    const cats: (keyof MatchAnalysis)[] = [
        'must_have_match', 'experience_match', 'domain_match',
        'seniority_match', 'nice_to_have_match',
    ];
    for (const k of cats) {
        const cat = match?.[k];
        if (cat?.gaps && Array.isArray(cat.gaps)) {
            for (const g of cat.gaps) if (typeof g === 'string' && g.trim()) gaps.push(g);
        }
    }
    return gaps;
}

function buildUserPrompt(
    cv: unknown,
    jd: unknown,
    match: unknown,
    cfg: VariantConfig,
    useGaps: boolean,
): string {
    const gaps = useGaps ? collectGaps(match as MatchAnalysis) : [];
    return `Optimize this CV for the given job description.

VARIANT STYLE — ${cfg.style}: ${STYLE_INSTRUCTIONS[cfg.style]}
VARIANT FOCUS — ${cfg.focus}: ${FOCUS_INSTRUCTIONS[cfg.focus]}
LENGTH — ${cfg.length}: ${LENGTH_INSTRUCTIONS[cfg.length]}

CANDIDATE CV (JSON):
${JSON.stringify(cv, null, 2)}

JOB DESCRIPTION (JSON):
${JSON.stringify(jd, null, 2)}

MATCH ANALYSIS (JSON):
${JSON.stringify(match, null, 2)}
${gaps.length > 0 ? `\nKNOWN GAPS — address each by reframing existing CV content (never by fabrication):\n${gaps.map(g => `  - ${g}`).join('\n')}` : ''}

OPTIMIZATION INSTRUCTIONS:
1. Rephrase the summary to align with JD must-have keywords that are actually supported by the source CV.
2. Reorder bullet points in experience descriptions to put the most JD-relevant achievements first.
3. Apply the variant style and focus consistently across summary and experience descriptions.
4. Format experience.description and projects.description as bullet lines separated by "\\n". Each bullet on its own line. Do not include leading "-" or "*" — the renderer will add them.
5. Keep the same structure, job titles, companies, durations, and education entries.
6. NEVER fabricate companies, tools, metrics, achievements, or skills not present in the original CV.
7. PRESERVE every experience, education, and project entry from the source CV — never delete, drop, or combine entries. Output arrays must have the same length as the source.
8. PRESERVE every bullet inside each experience.description and projects.description — rewrite the wording but never drop, merge, or summarize multiple bullets into one. Bullet count out must equal bullet count in.
9. PRESERVE every skill from the source CV — you may reorder to surface JD-relevant ones first, but never remove a skill.`;
}

const SYSTEM_PROMPT = `You are a CV optimizer that strictly follows anti-hallucination rules.
Return ONLY valid JSON matching this exact schema:
{
  "name": "string",
  "summary": "string",
  "skills": ["string"],
  "experience": [{"title": "string", "company": "string", "duration_months": number, "description": "string"}],
  "education": [{"degree": "string", "institution": "string", "year": "string"}],
  "projects": [{"name": "string", "description": "string"}],
  "improvements": [{"section": "string", "change": "string", "reason": "string"}]
}

improvements = a list of EVERY concrete change you made, written in VIETNAMESE for the candidate to read:
- "section": where the change is ("Mục tiêu nghề nghiệp", "Kinh nghiệm: <company>", "Kỹ năng", "Dự án: <name>").
- "change": what you rewrote/reordered, specific (quote the keyword or bullet topic, not generic phrases).
- "reason": why it helps for THIS job description (name the JD requirement/keyword it targets).
Only list changes you actually made. If you made no change to the CV, return an empty improvements array.

STRICT GUARDRAILS:
1. Only use information explicitly found in the original CV.
2. DO NOT add new companies, new tools, new measurable results, or new skills not present in the original CV.
3. DO NOT invent numbers, metrics, or achievements.
4. Maintain the exact original job titles, companies, and duration.`;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { cv, jd, match, options } = body as {
            cv: unknown; jd: unknown; match: unknown; options?: OptimizeOptions;
        };

        if (!cv || !jd || !match) {
            return NextResponse.json({ detail: "cv, jd, and match are required" }, { status: 400 });
        }

        const opts: OptimizeOptions = options ?? {};
        const useGaps = opts.useGaps !== false;
        const configs = buildVariants(opts);

        // Run variants in parallel — Gemini main+fallback handles overload.
        const variantResults = await Promise.all(
            configs.map(async (cfg) => {
                const userPrompt = buildUserPrompt(cv, jd, match, cfg, useGaps);
                const raw = await callAI(SYSTEM_PROMPT, userPrompt, OPTIMIZE_RESPONSE_SCHEMA);
                const parsed = safeJsonParse(raw);
                if (!parsed) throw new Error(`Variant "${cfg.label}" returned invalid JSON`);
                // improvements is explanation metadata, not CV content — split
                // it off before the repair pass builds the CV object.
                const { improvements, ...optimizedCv } = parsed as Record<string, unknown>;
                // Deterministic guard: restore any entries/bullets/skills the
                // model dropped despite the PRESERVE rules in the prompt.
                const { cv: repairedCv, repairs } = repairOptimizedCv(cv, optimizedCv);
                if (repairs.length) {
                    console.warn(`[optimize] Variant "${cfg.label}" dropped content, repaired:`, repairs);
                }
                return {
                    label: cfg.label,
                    style: cfg.style,
                    focus: cfg.focus,
                    length: cfg.length,
                    cv: repairedCv,
                    improvements: Array.isArray(improvements) ? improvements : [],
                };
            })
        );

        return NextResponse.json({ variants: variantResults });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to optimize CV";
        return NextResponse.json({ detail: message }, { status: 500 });
    }
}
