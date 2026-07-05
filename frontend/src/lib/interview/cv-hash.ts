// Stable content hash of a CV, used as the interview-prep cache key together
// with (user_id, application id). Runs in BOTH the browser (modal cache lookup)
// and Node (route) via the Web Crypto API, which both expose.

/** Deterministic JSON with recursively sorted object keys. */
export function stableStringify(value: unknown): string {
    return JSON.stringify(value, (_k, v) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
            return Object.keys(v as Record<string, unknown>).sort().reduce((acc, k) => {
                acc[k] = (v as Record<string, unknown>)[k];
                return acc;
            }, {} as Record<string, unknown>);
        }
        return v;
    });
}

/** sha1 of the stable-stringified CV, as lowercase hex. */
export async function cvHash(cv: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(stableStringify(cv));
    const digest = await globalThis.crypto.subtle.digest("SHA-1", bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
