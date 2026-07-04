// Shared CV-tailoring pipeline — one source of truth for the three LLM steps
// (extract JD → score fit → optimize CV) used by both the web-app routes
// (/api/ai/extract-jd, /score, /optimize) and the extension Mode-1 endpoint
// (/api/ai/tailor, which runs all three server-side, no-store).
//
// Anti-hallucination guardrails live in the prompts; the optimize step ALSO
// repairs any dropped entries/bullets/skills deterministically (repairOptimizedCv).

import { callAI, callAIExtract } from "@/lib/gemini";
import { safeJsonParse } from "@/lib/safe-json";
import { MAX_INPUT_TEXT_LENGTH } from "@/lib/validation";
import { JD_EXTRACTION_RESPONSE_SCHEMA } from "@/lib/cv-extraction-schema";
import { OPTIMIZE_RESPONSE_SCHEMA, repairOptimizedCv } from "@/lib/cv-optimize";

// ─────────────────────────── Step 1: extract JD ───────────────────────────

const JD_SYSTEM_PROMPT = `You are an intelligent Job Description parser. Extract strict and accurate requirements.
Return ONLY valid JSON matching this exact schema:
{
  "must_have": ["string"],
  "nice_to_have": ["string"],
  "responsibilities": ["string"],
  "seniority_expected": "string (e.g., Junior, Mid-level, Senior, Executive)",
  "required_years_min": number,
  "domain": "string (e.g., Fintech, E-commerce, Healthcare)"
}

required_years_min = the MINIMUM years of professional experience the JD asks for, as a plain integer:
- "3+ years", "at least 3 years", "ít nhất 3 năm", "3-5 years" → 3 (take the lower bound).
- If no number is stated, infer from seniority: Intern/Fresher → 0, Junior → 1, Mid-level → 3, Senior → 5, Lead/Manager → 7.
- If experience is not mentioned and seniority is unclear, use 0.

LANGUAGE: Write every human-readable string (must_have, nice_to_have, responsibilities, domain) in Vietnamese, even when the source JD is in English. Keep technology/tool/framework/certification names and established job-title terms in their ORIGINAL form (e.g. React, SQL, Google Analytics, Figma, Product Manager, AWS). Do not translate proper nouns or brand/tech terms.`;

export async function extractJd(rawText: unknown): Promise<Record<string, unknown>> {
    const text = typeof rawText === "string" ? rawText.slice(0, MAX_INPUT_TEXT_LENGTH) : "";
    if (!text) throw new Error("raw_text is required");
    const userPrompt = `Extract the key requirements, nice-to-haves, responsibilities, seniority, minimum required years of experience, and domain from this Job Description:\n\n${text}`;
    const result = await callAIExtract(JD_SYSTEM_PROMPT, userPrompt, JD_EXTRACTION_RESPONSE_SCHEMA);
    const parsed = safeJsonParse(result);
    if (!parsed) throw new Error("AI returned invalid JSON. Please retry.");
    return parsed as Record<string, unknown>;
}

// ─────────────────────────── Step 2: score fit ───────────────────────────

type RawCategory = { score?: unknown; reasoning?: unknown; gaps?: unknown };

function normalizeCategory(c: unknown) {
    const cat = (c && typeof c === "object" ? c : {}) as RawCategory;
    const raw = typeof cat.score === "number" && Number.isFinite(cat.score) ? cat.score : 0;
    return {
        score: Math.min(100, Math.max(0, raw)),
        reasoning: typeof cat.reasoning === "string" ? cat.reasoning : "",
        gaps: Array.isArray(cat.gaps) ? cat.gaps.filter((g) => typeof g === "string") : [],
    };
}

// Per-requirement verdicts for must_have_match — the source of truth for the
// UI's ✓/✗ chips (replaces the old naive substring match on the frontend).
const REQ_STATUSES = new Set(["met", "partial", "missing"]);
function normalizeRequirements(v: unknown) {
    if (!Array.isArray(v)) return [];
    return v
        .map((r) => {
            const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
            const requirement = typeof o.requirement === "string" ? o.requirement.trim() : "";
            const s = typeof o.status === "string" ? o.status.toLowerCase().trim() : "";
            const status = REQ_STATUSES.has(s) ? s : "missing";
            const evidence = typeof o.evidence === "string" ? o.evidence : "";
            return { requirement, status: status as "met" | "partial" | "missing", evidence };
        })
        .filter((r) => r.requirement);
}

// Category weights for the overall score (must sum to 1).
const WEIGHTS = {
    must_have_match: 0.4,
    experience_match: 0.25,
    domain_match: 0.15,
    seniority_match: 0.1,
    nice_to_have_match: 0.1,
} as const;

/**
 * Guarantee every CategoryScore the UI relies on exists, and recompute
 * overall_score from the category scores (the model's own arithmetic can
 * contradict the very category scores it produced).
 */
function normalizeMatchResult(raw: unknown) {
    const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const categories = {
        must_have_match: {
            ...normalizeCategory(m.must_have_match),
            requirements: normalizeRequirements(
                (m.must_have_match as Record<string, unknown> | undefined)?.requirements,
            ),
        },
        experience_match: normalizeCategory(m.experience_match),
        domain_match: normalizeCategory(m.domain_match),
        seniority_match: normalizeCategory(m.seniority_match),
        nice_to_have_match: normalizeCategory(m.nice_to_have_match),
    };
    const overall = Math.round(
        (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>)
            .reduce((sum, key) => sum + categories[key].score * WEIGHTS[key], 0)
    );
    return {
        overall_score: overall,
        ...categories,
        strength_summary: typeof m.strength_summary === "string" ? m.strength_summary : "",
        risk_flags: Array.isArray(m.risk_flags) ? m.risk_flags.filter((f) => typeof f === "string") : [],
    };
}

const CATEGORY_SCHEMA = {
    type: "OBJECT",
    properties: {
        score: { type: "NUMBER" },
        reasoning: { type: "STRING" },
        gaps: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["score", "reasoning", "gaps"],
};

// must_have_match additionally carries per-requirement verdicts so the UI can
// mark each JD requirement met/partial/missing by the model's judgment, not a
// naive string comparison.
const MUST_HAVE_CATEGORY_SCHEMA = {
    type: "OBJECT",
    properties: {
        score: { type: "NUMBER" },
        reasoning: { type: "STRING" },
        gaps: { type: "ARRAY", items: { type: "STRING" } },
        requirements: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    requirement: { type: "STRING" },
                    status: { type: "STRING" }, // "met" | "partial" | "missing"
                    evidence: { type: "STRING" },
                },
                required: ["requirement", "status", "evidence"],
            },
        },
    },
    required: ["score", "reasoning", "gaps", "requirements"],
};

const MATCH_SCHEMA = {
    type: "OBJECT",
    properties: {
        overall_score: { type: "NUMBER" },
        must_have_match: MUST_HAVE_CATEGORY_SCHEMA,
        experience_match: CATEGORY_SCHEMA,
        domain_match: CATEGORY_SCHEMA,
        seniority_match: CATEGORY_SCHEMA,
        nice_to_have_match: CATEGORY_SCHEMA,
        strength_summary: { type: "STRING" },
        risk_flags: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: [
        "overall_score", "must_have_match", "experience_match", "domain_match",
        "seniority_match", "nice_to_have_match", "strength_summary", "risk_flags",
    ],
};

const SCORE_SYSTEM_PROMPT = `You are a precise, objective ATS scoring algorithm.
Return ONLY valid JSON matching this exact schema:
{
  "overall_score": number (0-100, weighted),
  "must_have_match": {"score": number, "reasoning": "string", "gaps": ["string"], "requirements": [{"requirement": "string", "status": "met" | "partial" | "missing", "evidence": "string"}]},
  "experience_match": {"score": number, "reasoning": "string", "gaps": ["string"]},
  "domain_match": {"score": number, "reasoning": "string", "gaps": ["string"]},
  "seniority_match": {"score": number, "reasoning": "string", "gaps": ["string"]},
  "nice_to_have_match": {"score": number, "reasoning": "string", "gaps": ["string"]},
  "strength_summary": "string",
  "risk_flags": ["string"]
}

LANGUAGE: Every human-readable string you output — each requirement, evidence, reasoning, every item in gaps, strength_summary, and risk_flags — MUST be written in Vietnamese, even when the CV or JD is in English. Keep technology/tool/framework/certification names and established job-title terms in their ORIGINAL form (e.g. React, SQL, Google Analytics, Figma, Product Manager, AWS). Do not translate proper nouns or brand/tech terms.`;

export async function scoreFit(cv: unknown, jd: unknown): Promise<Record<string, unknown>> {
    if (!cv || !jd) throw new Error("cv and jd are required");
    const userPrompt = `Evaluate the candidate's CV against the Job Description.

CRITERIA & WEIGHTS:
1. Must-have skills (40%): Are the exact required tools/skills present?
2. Experience depth (25%): Do they have the required years of experience and impact?
3. Domain alignment (15%): Have they worked in the same industry/domain?
4. Seniority fit (10%): Does their past trajectory match the target seniority level?
5. Nice-to-have skills (10%): Have they touched the bonus tools/technologies?

CANDIDATE CV (JSON):
${JSON.stringify(cv, null, 2)}

JOB DESCRIPTION (JSON):
${JSON.stringify(jd, null, 2)}

Determine a score from 0-100 for each dimension, explain the reasoning briefly, list the gaps, and calculate the weighted overall score. Be rigorous and identify any risk flags.

For must_have_match.requirements: output ONE entry for EVERY item in the JD's must_have list, restating each requirement in natural Vietnamese (keep tech/tool/certification names and established job titles in their original form), and judge each against the WHOLE CV (skills, experience bullets, education, projects) — not just the skills list. Set:
- "status": "met" if the CV clearly demonstrates it; "partial" if there is related/adjacent evidence but it is not fully or explicitly shown; "missing" if there is no supporting evidence.
- "evidence": a short quote or reference from the CV that justifies the status (empty string when missing).
Judge by meaning, not literal keyword overlap — e.g. "led a team of 2-4" is met by "managed 3 engineers", and "3+ years as PM" is met by dated PM roles totaling 3+ years. Keep the per-requirement verdicts consistent with the score and gaps.`;
    const result = await callAI(SCORE_SYSTEM_PROMPT, userPrompt, MATCH_SCHEMA);
    const parsed = safeJsonParse(result);
    if (!parsed) throw new Error("AI returned invalid JSON. Please retry.");
    return normalizeMatchResult(parsed);
}

// ─────────────────────────── Step 3: optimize CV ───────────────────────────

export type OptimizeStyle = "formal" | "direct" | "impact-driven" | "storytelling";
export type OptimizeFocus = "balanced" | "technical" | "leadership" | "metrics" | "ats-keyword";
export type OptimizeLength = "concise" | "detailed";

export interface OptimizeOptions {
    style?: OptimizeStyle;
    focus?: OptimizeFocus;
    length?: OptimizeLength;
    variants?: number; // 1-3
    useGaps?: boolean;
    notes?: string; // candidate's own emphasis points (re-optimize)
}

interface VariantConfig {
    label: string;
    style: OptimizeStyle;
    focus: OptimizeFocus;
    length: OptimizeLength;
}

const STYLE_INSTRUCTIONS: Record<OptimizeStyle, string> = {
    formal: "Use a formal, polished tone. Complete professional sentences. Avoid colloquialisms.",
    direct: "Use a direct, concise tone. Short sentences. Strong action verbs. Cut filler words.",
    "impact-driven":
        "Lead each bullet with a measurable outcome (numbers, %, scope) when those metrics are present in the source. When metrics are absent, lead with the deliverable instead. NEVER invent numbers.",
    storytelling:
        "Use brief narrative phrasing — challenge → action → result. Keep it grounded in the source content; do not embellish.",
};

const FOCUS_INSTRUCTIONS: Record<OptimizeFocus, string> = {
    balanced: "Balance technical, leadership, and impact signals.",
    technical:
        "Surface technologies, tools, frameworks, and engineering depth. Use precise technical vocabulary already present in the source CV.",
    leadership:
        "Highlight team size, mentorship, ownership, cross-functional collaboration, and decision-making — only where the source CV supports it.",
    metrics:
        "Foreground every quantifiable result already present in the source. Do not fabricate any new numbers.",
    "ats-keyword":
        "Front-load JD must-have keywords into the summary and the first sentence of each experience bullet, only where they faithfully describe the source content.",
};

const LENGTH_INSTRUCTIONS: Record<OptimizeLength, string> = {
    concise:
        "Tight, punchy phrasing — keep each bullet under ~25 words and the summary under ~70 words. PRESERVE every bullet from the source CV: shorten wording, never drop, merge, or summarize bullets together.",
    detailed:
        "Full descriptive phrasing — bullets up to ~40 words, summary up to ~100 words. PRESERVE every bullet from the source CV: you may split one source bullet into two only if that genuinely improves clarity.",
};

function clampVariantCount(n: unknown): number {
    const v = typeof n === "number" ? n : 1;
    return Math.max(1, Math.min(3, Math.floor(v)));
}

function buildVariants(opts: OptimizeOptions): VariantConfig[] {
    const count = clampVariantCount(opts.variants);
    const length: OptimizeLength = opts.length ?? "concise";
    if (count === 1) {
        return [{ label: "Tailored", style: opts.style ?? "direct", focus: opts.focus ?? "balanced", length }];
    }
    if (count === 2) {
        return [
            { label: "Direct & Technical", style: "direct", focus: "technical", length },
            { label: "Impact & Metrics", style: "impact-driven", focus: "metrics", length },
        ];
    }
    return [
        { label: "Direct & Technical", style: "direct", focus: "technical", length },
        { label: "Impact & Metrics", style: "impact-driven", focus: "metrics", length },
        { label: "Leadership Story", style: "storytelling", focus: "leadership", length: opts.length ?? "detailed" },
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
        "must_have_match", "experience_match", "domain_match",
        "seniority_match", "nice_to_have_match",
    ];
    for (const k of cats) {
        const cat = match?.[k];
        if (cat?.gaps && Array.isArray(cat.gaps)) {
            for (const g of cat.gaps) if (typeof g === "string" && g.trim()) gaps.push(g);
        }
    }
    return gaps;
}

function buildOptimizeUserPrompt(
    cv: unknown, jd: unknown, match: unknown, cfg: VariantConfig, useGaps: boolean, notes: string,
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
${gaps.length > 0 ? `\nKNOWN GAPS — address each by reframing existing CV content (never by fabrication):\n${gaps.map(g => `  - ${g}`).join("\n")}` : ""}
${notes ? `\nCANDIDATE PRIORITIES — the candidate explicitly asked you to emphasize or incorporate the following. Treat these as high priority and surface them where the source CV genuinely supports them. NEVER fabricate experience, skills, or metrics to satisfy a request — if the CV does not support a point, leave it out:\n${notes}` : ""}

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

const OPTIMIZE_SYSTEM_PROMPT = `You are a CV optimizer that strictly follows anti-hallucination rules.
Return ONLY valid JSON matching this exact schema:
{
  "name": "string",
  "summary": "string",
  "skills": ["string"],
  "experience": [{"title": "string", "company": "string", "duration_months": number, "description": "string"}],
  "education": [{"degree": "string", "institution": "string", "year": "string"}],
  "projects": [{"name": "string", "description": "string"}],
  "improvements": [{"section": "string", "change": "string", "reason": "string"}],
  "suggestions": [{"section": "string", "suggestion": "string", "placeholder": "string"}]
}

improvements = a list of EVERY concrete change you made, written in VIETNAMESE for the candidate to read. Make each one SPECIFIC and IMPACTFUL — the candidate must immediately see the value:
- "section": where the change is ("Mục tiêu nghề nghiệp", "Kinh nghiệm: <company>", "Kỹ năng", "Dự án: <name>").
- "change": QUOTE the concrete edit — the exact phrase/metric/keyword you added or the before→after, not a generic summary. Good: 'Thêm "giảm 40% thời gian tải trang" vào gạch đầu dòng đầu'. Bad: 'viết lại bullet cho rõ hơn'.
- "reason": the SPECIFIC JD requirement/keyword it targets and why it strengthens the match (e.g. 'JD yêu cầu tối ưu hiệu năng — định lượng tác động làm nổi bật điều đó').
Prefer fewer, high-signal entries over many trivial ones; merge tiny edits. Only list changes you actually made; if you made none, return an empty improvements array (the app shows a deterministic diff in that case).

suggestions = 3-5 PROSPECTIVE improvements you could NOT make yourself because they need a real fact the candidate must supply — a number, a scale, a concrete detail you must NEVER invent. Written in VIETNAMESE. This is how the CV gets stronger without fabrication: you point to the weak spot, the candidate fills in the real figure, then re-optimization uses it.
- "section": where it applies ("Kinh nghiệm: <company>", "Dự án: <name>", "Mục tiêu nghề nghiệp").
- "suggestion": point out what would make this stronger, tied to a JD requirement. e.g. 'Định lượng quy mô công việc hậu cần để làm bật năng lực quản lý nguồn lực JD yêu cầu'.
- "placeholder": the exact quantification question to show inside the input box. e.g. 'Ngân sách phụ trách? Số thành viên? Quy mô sự kiện lớn nhất?'.
Only suggest things the source CV plausibly supports (do NOT invent achievements the candidate never mentioned). Prioritize gaps that would most raise the JD match. Return an empty suggestions array only if the CV is already fully quantified.

STRICT GUARDRAILS:
1. Only use information explicitly found in the original CV.
2. DO NOT add new companies, new tools, new measurable results, or new skills not present in the original CV.
3. DO NOT invent numbers, metrics, or achievements.
4. Maintain the exact original job titles, companies, and duration.`;

export interface OptimizedVariant {
    label: string;
    style: OptimizeStyle;
    focus: OptimizeFocus;
    length: OptimizeLength;
    cv: Record<string, unknown>;
    improvements: unknown[];
    suggestions: unknown[];
}

export async function optimizeForJd(
    cv: unknown, jd: unknown, match: unknown, options?: OptimizeOptions,
): Promise<OptimizedVariant[]> {
    if (!cv || !jd || !match) throw new Error("cv, jd, and match are required");
    const opts = options ?? {};
    const useGaps = opts.useGaps !== false;
    const notes = typeof opts.notes === "string" ? opts.notes.trim().slice(0, 2000) : "";
    const configs = buildVariants(opts);

    // Run variants in parallel — Gemini main+fallback handles overload.
    return Promise.all(
        configs.map(async (cfg) => {
            const userPrompt = buildOptimizeUserPrompt(cv, jd, match, cfg, useGaps, notes);
            const raw = await callAI(OPTIMIZE_SYSTEM_PROMPT, userPrompt, OPTIMIZE_RESPONSE_SCHEMA);
            const parsed = safeJsonParse(raw);
            if (!parsed) throw new Error(`Variant "${cfg.label}" returned invalid JSON`);
            // improvements + suggestions are explanation metadata, not CV
            // content — split them off before the CV repair pass.
            const { improvements, suggestions, ...optimizedCv } = parsed as Record<string, unknown>;
            // Deterministic guard: restore any entries/bullets/skills the model dropped.
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
                suggestions: Array.isArray(suggestions) ? suggestions : [],
            };
        })
    );
}

// ─────────────────── Mode-1 composition: JD text → tailored CV ───────────────────

export interface TailorResult {
    source_ref: string;       // caller-supplied opaque handle (or "" if none)
    improved_cv: Record<string, unknown>;
    improvements: unknown[];
    suggestions: unknown[];   // prospective "Có thể cân nhắc" probes — carry to the editor
    match: Record<string, unknown>;
    jd: Record<string, unknown>;   // extracted JD — lets the editor show context + re-optimize
}

/**
 * Full Mode-1 pipeline run server-side: raw JD text + structured CV → tailored CV.
 * Runs extract → score → optimize (single "Tailored" variant). The CALLER (the
 * /api/ai/tailor route) is responsible for the no-store guarantee: this function
 * returns facts only and persists nothing.
 */
export async function tailorForJob(
    cv: unknown, jdText: unknown, options?: OptimizeOptions, sourceRef = "",
): Promise<TailorResult> {
    if (!cv) throw new Error("cv is required");
    const jd = await extractJd(jdText);
    const match = await scoreFit(cv, jd);
    const variants = await optimizeForJd(cv, jd, match, { ...options, variants: 1 });
    const best = variants[0];
    return {
        source_ref: typeof sourceRef === "string" ? sourceRef : "",
        improved_cv: best.cv,
        improvements: best.improvements,
        suggestions: best.suggestions,
        match,
        jd: jd as Record<string, unknown>,
    };
}
