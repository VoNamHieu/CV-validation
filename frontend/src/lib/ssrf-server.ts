import { lookup } from "dns/promises";
import { isAllowedUrl, isPublicIp } from "./validation";

/**
 * Server-only SSRF gate WITH DNS resolution. The cheap `isAllowedUrl` checks
 * (scheme + IP-literal / private-hostname) plus a resolve-and-validate pass:
 * a public hostname whose A/AAAA record points at a private / metadata IP is
 * rejected. Isolated from validation.ts because `dns/promises` can't be bundled
 * into client components.
 *
 * Fails CLOSED on resolution error. Note: the runtime re-resolves at connect
 * time, so a sub-TTL rebind can still slip; this closes the realistic
 * static-record / misconfig case, not a TOCTOU attacker flipping DNS mid-fetch.
 */
export async function isAllowedUrlResolved(url: string): Promise<boolean> {
    if (!isAllowedUrl(url)) return false;

    let hostname: string;
    try {
        hostname = new URL(url).hostname.toLowerCase();
    } catch {
        return false;
    }

    const bare = hostname.replace(/^\[|\]$/g, "");
    // A literal IP already passed is_global-style checks in isAllowedUrl.
    if (/^[0-9.]+$/.test(bare) || bare.includes(":")) return true;

    try {
        const addrs = await lookup(bare, { all: true });
        if (!addrs.length) return false;
        return addrs.every((a) => isPublicIp(a.address));
    } catch {
        return false;
    }
}
