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

export async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
    const client = getClient();

    const response = await client.models.generateContent({
        model: "gemini-2.5-pro-exp-03-25",
        contents: userPrompt,
        config: {
            systemInstruction: systemPrompt,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 2048 },
        },
    });

    return response?.text ?? "";
}
