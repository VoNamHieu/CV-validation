/**
 * URL validation to prevent SSRF attacks (H1).
 * Blocks private IPs, localhost, cloud metadata endpoints.
 */
export function isAllowedUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();

        // Only allow HTTP/HTTPS
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

        // Block localhost and loopback
        if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname)) return false;

        // Block private IP ranges (RFC 1918)
        if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) return false;
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;

        // Block link-local (AWS metadata, etc.)
        if (hostname.startsWith("169.254.")) return false;

        // Block cloud metadata endpoints
        if (hostname === "metadata.google.internal" || hostname === "metadata.google.com") return false;

        // Block internal/local domains
        if (hostname.endsWith(".internal") || hostname.endsWith(".local") || hostname.endsWith(".localhost")) return false;

        return true;
    } catch {
        return false;
    }
}

/** Maximum allowed input text length for AI processing (H4) */
export const MAX_INPUT_TEXT_LENGTH = 50_000;

/** Maximum allowed PDF base64 size (~5MB file) (H5) */
export const MAX_PDF_BASE64_LENGTH = 7_000_000;
