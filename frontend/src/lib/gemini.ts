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

export async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
    const client = getClient();

    const response = await client.models.generateContent({
        model: "gemini-3-pro-preview",
        contents: userPrompt,
        config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 2048 },
        },
    });

    return response?.text ?? "";
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
        model: "gemini-3-pro-preview",
        contents: [{ role: "user", parts: [pdfPart, textPart] }],
        config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 2048 },
        },
    });

    return response?.text ?? "";
}
