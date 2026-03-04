import { GoogleGenAI, Part } from "@google/genai";

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

// ── Model chains ──
// Complex tasks (CV/JD extraction, scoring, optimization): need thinking
const MODELS_PRO = ["gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"];
// Simple tasks (search URL, link extraction): no thinking needed
const MODELS_FLASH = ["gemini-3-flash-preview", "gemini-2.5-pro"];

function isOverloaded(err: unknown): boolean {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return msg.includes("503") || msg.includes("unavailable") || msg.includes("overloaded")
        || msg.includes("resource_exhausted") || msg.includes("quota");
}

// ── Core: try model chain with fallback ──
async function callWithFallback(
    models: string[],
    systemPrompt: string,
    userPrompt: string,
    useThinking: boolean,
): Promise<string> {
    const client = getClient();

    for (let i = 0; i < models.length; i++) {
        const model = models[i];
        const isLast = i === models.length - 1;
        try {
            console.log(`[gemini] Trying ${model}...`);
            const response = await client.models.generateContent({
                model,
                contents: userPrompt,
                config: {
                    systemInstruction: systemPrompt,
                    responseMimeType: "application/json",
                    ...(useThinking ? { thinkingConfig: { thinkingBudget: 2048 } } : {}),
                },
            });
            return response?.text ?? "";
        } catch (e) {
            if (!isLast && isOverloaded(e)) {
                console.warn(`[gemini] ${model} unavailable, trying ${models[i + 1]}...`);
                continue;
            }
            throw e;
        }
    }
    throw new Error("All models failed");
}

/**
 * Complex tasks: 3.0-pro → 3-flash → 2.5-pro (WITH thinking)
 * Use for: CV extraction, JD extraction, scoring, optimization
 */
export async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
    return callWithFallback(MODELS_PRO, systemPrompt, userPrompt, true);
}

/**
 * Simple tasks: 3-flash → 2.5-pro (NO thinking)
 * Use for: search URL generation, job link extraction
 */
export async function callGeminiLight(systemPrompt: string, userPrompt: string): Promise<string> {
    return callWithFallback(MODELS_FLASH, systemPrompt, userPrompt, false);
}

/**
 * PDF parsing: 3.0-pro → 3-flash → 2.5-pro (WITH thinking)
 */
export async function callGeminiWithPdf(
    systemPrompt: string,
    userPrompt: string,
    pdfBase64: string
): Promise<string> {
    const client = getClient();

    const pdfPart: Part = {
        inlineData: {
            mimeType: "application/pdf",
            data: pdfBase64,
        },
    };
    const textPart: Part = { text: userPrompt };

    for (let i = 0; i < MODELS_PRO.length; i++) {
        const model = MODELS_PRO[i];
        const isLast = i === MODELS_PRO.length - 1;
        try {
            console.log(`[gemini-pdf] Trying ${model}...`);
            const response = await client.models.generateContent({
                model,
                contents: [{ role: "user", parts: [pdfPart, textPart] }],
                config: {
                    systemInstruction: systemPrompt,
                    responseMimeType: "application/json",
                    thinkingConfig: { thinkingBudget: 2048 },
                },
            });
            return response?.text ?? "";
        } catch (e) {
            if (!isLast && isOverloaded(e)) {
                console.warn(`[gemini-pdf] ${model} unavailable, trying ${MODELS_PRO[i + 1]}...`);
                continue;
            }
            throw e;
        }
    }
    throw new Error("All models failed");
}
