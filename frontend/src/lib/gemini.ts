import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from "@google/genai";

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
    if (!_client) {
        const key = process.env.GEMINI_API_KEY;
        if (!key) {
            throw new Error("GEMINI_API_KEY environment variable is not set");
        }
        _client = new GoogleGenAI({ apiKey: key });
    }
    return _client;
}

// ── Models ──
const PRO_MODEL = "gemini-3.1-pro-preview";
const FLASH_MODEL = "gemini-3-flash-preview";

// ── Cost tiers ──
// Reasoning (score, optimize): Pro first, Flash fallback. Thinking ON — these
// genuinely benefit from it.
const REASON_MODELS = [PRO_MODEL, FLASH_MODEL];
// Extraction & light tasks (parse PDF, extract CV/JD, search/rank/map): these
// are deterministic schema-constrained transforms — no reasoning needed. Flash
// with thinking DISABLED (~5-10× cheaper); Pro only as a reliability fallback.
const LIGHT_MODELS = [FLASH_MODEL, PRO_MODEL];

// ── Reliability knobs ──
// A pipeline run is 10-20 LLM calls; without per-call retries a single
// transient 500 kills a whole JD entry.
const MAX_ATTEMPTS_PER_MODEL = 2;
const BASE_BACKOFF_MS = 1000;
const REQUEST_TIMEOUT_MS = 60_000;

// OpenAPI-subset schema accepted by Gemini's responseSchema (constrained
// decoding). Routes pass this so the model physically can't emit non-JSON
// or drop required keys.
export type GeminiSchema = Record<string, unknown>;

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function isTransient(err: unknown): boolean {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return msg.includes("503") || msg.includes("unavailable") || msg.includes("overloaded")
        || msg.includes("resource_exhausted") || msg.includes("quota") || msg.includes("rate_limit")
        || msg.includes("429") || msg.includes("500") || msg.includes("internal")
        // 504 / deadline are server-side timeouts — retry + fall back to the other
        // model instead of killing the whole JD entry on one slow call.
        || msg.includes("504") || msg.includes("deadline") || msg.includes("gateway")
        || msg.includes("cancelled") || msg.includes("canceled") || msg.includes("aborted")
        || msg.includes("timeout") || msg.includes("timed out")
        || msg.includes("fetch failed") || msg.includes("network") || msg.includes("socket");
}

type Contents = Parameters<GoogleGenAI["models"]["generateContent"]>[0]["contents"];

// ── Core: call Gemini with JSON mode. Per model: retry transient errors with
//    backoff; non-transient errors throw immediately. Main → fallback. ──
async function callModel(
    systemPrompt: string,
    contents: Contents,
    schema?: GeminiSchema,
    tag = "gemini",
    opts: { models?: string[]; noThinking?: boolean } = {},
): Promise<string> {
    const client = getClient();
    const models = opts.models ?? REASON_MODELS;

    // Inject the real current date into every call. Without it the model resolves
    // relative time ("present", "hiện tại", "nay") against its training cutoff
    // (~2025) and under-counts years of experience / recency by a year+.
    const now = new Date();
    const dateContext =
        `Today's date is ${now.toISOString().slice(0, 10)} (the current year is ${now.getUTCFullYear()}). `
        + `Interpret every relative time reference — "present", "now", "current", `
        + `"hiện tại", "nay", "đến nay" — as this date when computing durations, `
        + `years of experience, or recency. Do not assume any earlier year.\n\n`;
    const systemInstruction = dateContext + systemPrompt;

    let lastErr: unknown;
    for (const model of models) {
        // Disable thinking on the light tier. Flash accepts thinkingBudget:0;
        // Pro rejects it ("only works in thinking mode"), so cap it via
        // thinkingLevel:"low" when Pro is used as the fallback.
        const thinkingConfig: ThinkingConfig | undefined = opts.noThinking
            ? (model.includes("flash") ? { thinkingBudget: 0 } : { thinkingLevel: ThinkingLevel.LOW })
            : undefined;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
            try {
                console.log(`[${tag}] Calling ${model} (attempt ${attempt})...`);
                const response = await client.models.generateContent({
                    model,
                    contents,
                    config: {
                        systemInstruction,
                        responseMimeType: "application/json",
                        ...(schema ? { responseSchema: schema } : {}),
                        ...(thinkingConfig ? { thinkingConfig } : {}),
                        httpOptions: { timeout: REQUEST_TIMEOUT_MS },
                    },
                });
                // Log token usage so real per-action cost can be measured from
                // logs (input / output / thinking). thinkingTokenCount is the
                // dominant cost on the Pro reasoning tier.
                const u = response.usageMetadata;
                if (u) {
                    console.log(`[${tag}] tokens model=${model} `
                        + `in=${u.promptTokenCount ?? 0} `
                        + `out=${u.candidatesTokenCount ?? 0} `
                        + `think=${u.thoughtsTokenCount ?? 0} `
                        + `total=${u.totalTokenCount ?? 0}`);
                }
                return response.text ?? "";
            } catch (e) {
                lastErr = e;
                if (!isTransient(e)) {
                    // Non-transient (bad schema, safety block, 400) — surfaced to
                    // the server log so silent optimize/score failures are debuggable.
                    console.error(`[${tag}] ${model} NON-TRANSIENT error (no retry):`,
                        e instanceof Error ? (e.stack || e.message) : e);
                    throw e;
                }
                if (attempt < MAX_ATTEMPTS_PER_MODEL) {
                    // Exponential backoff with jitter so parallel callers don't re-stampede.
                    const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1) * (0.5 + Math.random());
                    console.warn(`[${tag}] ${model} transient error, retrying in ${Math.round(delay)}ms:`,
                        e instanceof Error ? e.message : e);
                    await sleep(delay);
                }
            }
        }
        console.warn(`[${tag}] ${model} exhausted retries, trying next model...`);
    }
    console.error(`[${tag}] ALL MODELS FAILED:`,
        lastErr instanceof Error ? (lastErr.stack || lastErr.message) : lastErr);
    throw lastErr instanceof Error ? lastErr : new Error("All Gemini models failed");
}

/**
 * Reasoning tasks: Pro (thinking ON) → Flash fallback, JSON mode.
 * Use ONLY for tasks that genuinely reason: scoring, optimization/tailoring.
 */
export async function callAI(
    systemPrompt: string,
    userPrompt: string,
    schema?: GeminiSchema,
): Promise<string> {
    return callModel(systemPrompt, userPrompt, schema, "gemini", { models: REASON_MODELS });
}

/**
 * Extraction tasks: Flash (thinking OFF) → Pro fallback, JSON mode.
 * Use for schema-constrained transforms: CV/JD extraction, profile distill,
 * form mapping — no reasoning, so no thinking budget burned.
 */
export async function callAIExtract(
    systemPrompt: string,
    userPrompt: string,
    schema?: GeminiSchema,
): Promise<string> {
    return callModel(systemPrompt, userPrompt, schema, "gemini-extract", { models: LIGHT_MODELS, noThinking: true });
}

/**
 * Judgment tasks: Flash with thinking ON → Pro fallback, JSON mode.
 * For tasks that need light reasoning but not Pro — ranking by fit, agent
 * action planning, form-field mapping. A/B-tested: Flash+thinking matches Pro's
 * ordering on nuanced fit calls; Flash WITHOUT thinking gets them wrong.
 */
export async function callAIJudge(
    systemPrompt: string,
    userPrompt: string,
    schema?: GeminiSchema,
): Promise<string> {
    return callModel(systemPrompt, userPrompt, schema, "gemini-judge", { models: LIGHT_MODELS });
}

/**
 * Simple mechanical tasks: Flash (thinking OFF) → Pro fallback, JSON mode.
 * Use for: search URL generation, job-link extraction from markers.
 */
export async function callAILight(
    systemPrompt: string,
    userPrompt: string,
    schema?: GeminiSchema,
): Promise<string> {
    return callModel(systemPrompt, userPrompt, schema, "gemini-light", { models: LIGHT_MODELS, noThinking: true });
}

/**
 * PDF parsing: Flash (thinking OFF) → Pro fallback, inline PDF input.
 * Parsing a PDF into structured fields is extraction, not reasoning.
 */
export async function callAIWithPdf(
    systemPrompt: string,
    userPrompt: string,
    pdfBase64: string,
    schema?: GeminiSchema,
): Promise<string> {
    const contents = [
        {
            role: "user",
            parts: [
                { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
                { text: userPrompt },
            ],
        },
    ];
    return callModel(systemPrompt, contents, schema, "gemini-pdf", { models: LIGHT_MODELS, noThinking: true });
}
