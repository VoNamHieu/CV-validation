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

const PRIMARY_MODEL = "gemini-3-flash-preview";
const FALLBACK_MODEL = "gemini-2.0-flash";

function isOverloaded(err: unknown): boolean {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return msg.includes("503") || msg.includes("unavailable") || msg.includes("overloaded") || msg.includes("resource_exhausted");
}

export async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
    const client = getClient();

    const callModel = async (model: string) => {
        const response = await client.models.generateContent({
            model,
            contents: userPrompt,
            config: {
                systemInstruction: systemPrompt,
                responseMimeType: "application/json",
                thinkingConfig: { thinkingBudget: 2048 },
            },
        });
        return response?.text ?? "";
    };

    // Try primary model, fallback on 503/overload
    try {
        return await callModel(PRIMARY_MODEL);
    } catch (e) {
        if (isOverloaded(e)) {
            console.warn(`[gemini] ${PRIMARY_MODEL} overloaded, falling back to ${FALLBACK_MODEL}`);
            return await callModel(FALLBACK_MODEL);
        }
        throw e;
    }
}

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

    const response = await client.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: "user", parts: [pdfPart, textPart] }],
        config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 2048 },
        },
    });

    return response?.text ?? "";
}
