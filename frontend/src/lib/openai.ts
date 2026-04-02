import OpenAI from "openai";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
    if (!_client) {
        const key = process.env.OPENAI_API_KEY;
        if (!key) {
            throw new Error("OPENAI_API_KEY environment variable is not set");
        }
        _client = new OpenAI({ apiKey: key });
    }
    return _client;
}

// ── Model ──
const MODEL = "gpt-5";

function isOverloaded(err: unknown): boolean {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    return msg.includes("503") || msg.includes("unavailable") || msg.includes("overloaded")
        || msg.includes("resource_exhausted") || msg.includes("quota") || msg.includes("rate_limit");
}

// ── Core: call GPT-5 with JSON schema enforcement ──
async function callModel(
    systemPrompt: string,
    userPrompt: string,
): Promise<string> {
    const client = getClient();

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[openai] Calling ${MODEL}... (attempt ${attempt + 1})`);
            const response = await client.chat.completions.create({
                model: MODEL,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                response_format: { type: "json_object" },
            });
            return response.choices[0]?.message?.content ?? "";
        } catch (e) {
            if (attempt < MAX_RETRIES && isOverloaded(e)) {
                console.warn(`[openai] ${MODEL} overloaded, retrying...`);
                continue;
            }
            throw e;
        }
    }
    throw new Error("All retries failed");
}

/**
 * Complex tasks: GPT-5 with JSON mode
 * Use for: CV extraction, JD extraction, scoring, optimization
 */
export async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
    return callModel(systemPrompt, userPrompt);
}

/**
 * Simple tasks: GPT-5 with JSON mode
 * Use for: search URL generation, job link extraction
 */
export async function callAILight(systemPrompt: string, userPrompt: string): Promise<string> {
    return callModel(systemPrompt, userPrompt);
}

/**
 * PDF parsing: GPT-5 with vision (base64 PDF as image)
 */
export async function callAIWithPdf(
    systemPrompt: string,
    userPrompt: string,
    pdfBase64: string
): Promise<string> {
    const client = getClient();

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[openai-pdf] Calling ${MODEL}... (attempt ${attempt + 1})`);
            const response = await client.chat.completions.create({
                model: MODEL,
                messages: [
                    { role: "system", content: systemPrompt },
                    {
                        role: "user",
                        content: [
                            {
                                type: "file",
                                file: {
                                    filename: "document.pdf",
                                    file_data: `data:application/pdf;base64,${pdfBase64}`,
                                },
                            },
                            { type: "text", text: userPrompt },
                        ],
                    },
                ],
                response_format: { type: "json_object" },
            });
            return response.choices[0]?.message?.content ?? "";
        } catch (e) {
            if (attempt < MAX_RETRIES && isOverloaded(e)) {
                console.warn(`[openai-pdf] ${MODEL} overloaded, retrying...`);
                continue;
            }
            throw e;
        }
    }
    throw new Error("All retries failed");
}
