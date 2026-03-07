/**
 * Safe JSON parsing utility.
 *
 * LLMs sometimes wrap valid JSON in markdown code blocks like:
 *   ```json\n{...}\n```
 * This sanitizer strips those wrappers before parsing.
 */

/**
 * Strip markdown code block wrappers from LLM output, then parse JSON.
 * Handles: ```json ... ```, ``` ... ```, and plain JSON.
 * Throws SyntaxError if the cleaned string is still invalid JSON.
 */
export function safeJsonParse<T = unknown>(raw: string): T {
    let cleaned = raw.trim();

    // Remove markdown code block wrapper: ```json ... ``` or ``` ... ```
    const codeBlockRegex = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/;
    const match = cleaned.match(codeBlockRegex);
    if (match) {
        cleaned = match[1].trim();
    }

    // Some models add trailing commas or extra whitespace
    // Try parsing as-is first
    return JSON.parse(cleaned);
}

/**
 * Same as safeJsonParse but returns { data, error } instead of throwing.
 */
export function trySafeJsonParse<T = unknown>(raw: string): { data: T | null; error: string | null } {
    try {
        return { data: safeJsonParse<T>(raw), error: null };
    } catch (e) {
        return { data: null, error: e instanceof Error ? e.message : "Invalid JSON" };
    }
}
