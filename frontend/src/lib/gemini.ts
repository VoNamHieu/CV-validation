import { GoogleGenAI } from "@google/genai";

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
const MAIN_MODEL = "gemini-3.1-pro-preview";
const FALLBACK_MODEL = "gemini-3-flash-preview";

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
): Promise<string> {
    const client = getClient();

    let lastErr: unknown;
    for (const model of [MAIN_MODEL, FALLBACK_MODEL]) {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
            try {
                console.log(`[${tag}] Calling ${model} (attempt ${attempt})...`);
                const response = await client.models.generateContent({
                    model,
                    contents,
                    config: {
                        systemInstruction: systemPrompt,
                        responseMimeType: "application/json",
                        ...(schema ? { responseSchema: schema } : {}),
                        httpOptions: { timeout: REQUEST_TIMEOUT_MS },
                    },
                });
                return response.text ?? "";
            } catch (e) {
                lastErr = e;
                if (!isTransient(e)) throw e;
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
    throw lastErr instanceof Error ? lastErr : new Error("All Gemini models failed");
}

/**
 * Complex tasks: Gemini main → fallback, JSON mode
 * Use for: CV extraction, JD extraction, scoring, optimization
 */
export async function callAI(
    systemPrompt: string,
    userPrompt: string,
    schema?: GeminiSchema,
): Promise<string> {
    return callModel(systemPrompt, userPrompt, schema);
}

/**
 * Simple tasks: Gemini main → fallback, JSON mode
 * Use for: search URL generation, job link extraction
 */
export async function callAILight(
    systemPrompt: string,
    userPrompt: string,
    schema?: GeminiSchema,
): Promise<string> {
    return callModel(systemPrompt, userPrompt, schema);
}

/**
 * PDF parsing: Gemini main → fallback with inline PDF input
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
    return callModel(systemPrompt, contents, schema, "gemini-pdf");
}
