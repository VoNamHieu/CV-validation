/**
 * URL validation to prevent SSRF attacks (H1).
 * Blocks private IPs, localhost, cloud metadata endpoints.
 */

/**
 * Parse inet_aton-style IPv4 hostnames — integer ("2130706433"), hex
 * ("0x7f000001"), octal ("0177.0.0.1"), and short dotted ("127.1") forms all
 * reach the loopback/private ranges while dodging string prefix checks.
 * Returns the address as a 32-bit number, or null when the hostname isn't a
 * numeric IPv4 form (i.e. it's a DNS name or canonical dotted quad handled
 * by the string checks below).
 */
function parseIpv4Numeric(hostname: string): number | null {
    const parts = hostname.split(".");
    if (parts.length < 1 || parts.length > 4 || parts.some((p) => p === "")) return null;
    const nums: number[] = [];
    for (const p of parts) {
        let v: number;
        if (/^0[xX][0-9a-fA-F]+$/.test(p)) v = parseInt(p, 16);
        else if (/^0[0-7]+$/.test(p)) v = parseInt(p, 8);
        else if (/^[0-9]+$/.test(p)) v = parseInt(p, 10);
        else return null;
        nums.push(v);
    }
    // inet_aton semantics: the last part fills all remaining bytes.
    const last = nums.pop()!;
    let ip = 0;
    for (const n of nums) {
        if (n > 255) return null;
        ip = ip * 256 + n;
    }
    const remainingBytes = 4 - nums.length;
    if (last < 0 || last >= 256 ** remainingBytes) return null;
    return ip * 256 ** remainingBytes + last;
}

function isPrivateIpv4(ip: number): boolean {
    const a = Math.floor(ip / 2 ** 24) % 256;
    const b = Math.floor(ip / 2 ** 16) % 256;
    return (
        a === 0 ||                            // "this network" (0.0.0.0/8)
        a === 10 ||                           // RFC 1918
        a === 127 ||                          // loopback
        (a === 100 && b >= 64 && b <= 127) || // CGNAT (100.64/10)
        (a === 169 && b === 254) ||           // link-local / cloud metadata
        (a === 172 && b >= 16 && b <= 31) ||  // RFC 1918
        (a === 192 && b === 168)              // RFC 1918
    );
}

/**
 * Classify a concrete IP-address string (as returned by DNS resolution) as
 * public or blocked. Used by the server-only resolved SSRF check to reject a
 * public hostname whose A/AAAA record points at a private / metadata address.
 * Fails CLOSED (returns false) for anything that isn't a recognizable IP.
 */
export function isPublicIp(ip: string): boolean {
    const v4 = parseIpv4Numeric(ip);
    if (v4 !== null) return !isPrivateIpv4(v4);

    const s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
    if (s.includes(":")) {
        if (s === "::1" || s === "::") return false;                  // loopback / unspecified
        if (/^fe[89ab]/.test(s)) return false;                        // link-local fe80::/10
        if (s.startsWith("fc") || s.startsWith("fd")) return false;   // ULA fc00::/7
        const mapped = s.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
        if (mapped) {
            const m = parseIpv4Numeric(mapped[1]);
            return m !== null ? !isPrivateIpv4(m) : false;
        }
        return true;                                                  // other IPv6 → public
    }
    return false;
}

export function isAllowedUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();

        // Only allow HTTP/HTTPS
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

        // Block IPv6 literals outright — legit job pages don't use them, and
        // they'd need their own private-range logic (::1, fc00::/7, fe80::/10,
        // v4-mapped ::ffff:127.0.0.1, …).
        if (hostname.startsWith("[")) return false;

        // Block localhost and loopback
        if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname)) return false;

        // Non-canonical IPv4 encodings → resolve numerically.
        const numericIp = parseIpv4Numeric(hostname);
        if (numericIp !== null && isPrivateIpv4(numericIp)) return false;

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
