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

function isOverloaded(err: unknown): boolean {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return msg.includes("503") || msg.includes("unavailable") || msg.includes("overloaded")
        || msg.includes("resource_exhausted") || msg.includes("quota") || msg.includes("rate_limit");
}

// ── Core: call Gemini with JSON mode, main → fallback ──
async function callModel(
    systemPrompt: string,
    userPrompt: string,
): Promise<string> {
    const client = getClient();

    let lastErr: unknown;
    for (const model of [MAIN_MODEL, FALLBACK_MODEL]) {
        try {
            console.log(`[gemini] Calling ${model}...`);
            const response = await client.models.generateContent({
                model,
                contents: userPrompt,
                config: {
                    systemInstruction: systemPrompt,
                    responseMimeType: "application/json",
                },
            });
            return response.text ?? "";
        } catch (e) {
            lastErr = e;
            if (isOverloaded(e)) {
                console.warn(`[gemini] ${model} overloaded, trying next model...`);
                continue;
            }
            throw e;
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error("All Gemini models failed");
}

/**
 * Complex tasks: Gemini main → fallback, JSON mode
 * Use for: CV extraction, JD extraction, scoring, optimization
 */
export async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
    return callModel(systemPrompt, userPrompt);
}

/**
 * Simple tasks: Gemini main → fallback, JSON mode
 * Use for: search URL generation, job link extraction
 */
export async function callAILight(systemPrompt: string, userPrompt: string): Promise<string> {
    return callModel(systemPrompt, userPrompt);
}

/**
 * PDF parsing: Gemini main → fallback with inline PDF input
 */
export async function callAIWithPdf(
    systemPrompt: string,
    userPrompt: string,
    pdfBase64: string,
): Promise<string> {
    const client = getClient();

    let lastErr: unknown;
    for (const model of [MAIN_MODEL, FALLBACK_MODEL]) {
        try {
            console.log(`[gemini-pdf] Calling ${model}...`);
            const response = await client.models.generateContent({
                model,
                contents: [
                    {
                        role: "user",
                        parts: [
                            { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
                            { text: userPrompt },
                        ],
                    },
                ],
                config: {
                    systemInstruction: systemPrompt,
                    responseMimeType: "application/json",
                },
            });
            return response.text ?? "";
        } catch (e) {
            lastErr = e;
            if (isOverloaded(e)) {
                console.warn(`[gemini-pdf] ${model} overloaded, trying next model...`);
                continue;
            }
            throw e;
        }
    }
    throw lastErr instanceof Error ? lastErr : new Error("All Gemini models failed");
}
