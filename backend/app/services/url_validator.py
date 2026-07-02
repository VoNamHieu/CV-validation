"""
URL validation to prevent SSRF attacks.
Mirrors the frontend's isAllowedUrl() logic from validation.ts.

``is_allowed_url`` is the cheap, synchronous, no-I/O gate (scheme + IP-literal /
private-hostname checks). ``is_allowed_url_resolved`` adds a DNS-resolution pass
that closes the rebinding gap: a public hostname whose A/AAAA record points at a
private / metadata IP. Use the resolved variant at the actual fetch site;
``is_allowed_url`` alone is fine as a fast pre-reject.
"""

import asyncio
import ipaddress
import socket
from urllib.parse import urlparse


def _parse_ip(hostname: str):
    """Parse a hostname as an IP if it is one, or None.

    Beyond the canonical forms, catches inet_aton-style IPv4 encodings that
    dodge string checks while still reaching internal hosts: integer
    (``2130706433``), hex (``0x7f000001``), octal (``0177.0.0.1``), and short
    dotted (``127.1``). ``inet_aton`` parses only — it never resolves DNS."""
    try:
        return ipaddress.ip_address(hostname)
    except ValueError:
        pass
    if hostname.isdigit():
        try:
            return ipaddress.ip_address(int(hostname))
        except ValueError:
            pass
    try:
        return ipaddress.ip_address(socket.inet_aton(hostname))
    except (OSError, ValueError):
        return None


def is_allowed_url(url: str) -> bool:
    """
    Validate that a URL is safe to crawl.
    Blocks: private IPs, localhost, cloud metadata endpoints, non-HTTP protocols.
    """
    try:
        parsed = urlparse(url)

        # Only allow HTTP/HTTPS
        if parsed.scheme not in ("http", "https"):
            return False

        hostname = (parsed.hostname or "").lower()
        if not hostname:
            return False

        # Block localhost and loopback
        if hostname in ("localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"):
            return False

        # IP-literal hosts (incl. integer/hex/octal/short-dotted encodings):
        # only globally-routable addresses pass — is_global rejects private,
        # loopback, link-local, reserved, CGNAT, multicast and unspecified.
        ip = _parse_ip(hostname)
        if ip is not None and not ip.is_global:
            return False

        # Block private IP string patterns (in case ipaddress parsing was skipped)
        if hostname.startswith("10.") or hostname.startswith("192.168."):
            return False
        if hostname.startswith("172."):
            parts = hostname.split(".")
            if len(parts) >= 2:
                try:
                    second = int(parts[1])
                    if 16 <= second <= 31:
                        return False
                except ValueError:
                    pass

        # Block link-local (AWS metadata, etc.)
        if hostname.startswith("169.254."):
            return False

        # Block cloud metadata endpoints
        if hostname in ("metadata.google.internal", "metadata.google.com"):
            return False

        # Block internal/local domains
        blocked_suffixes = (".internal", ".local", ".localhost")
        if any(hostname.endswith(s) for s in blocked_suffixes):
            return False

        return True
    except Exception:
        return False


async def _host_resolves_public(hostname: str) -> bool:
    """Resolve ``hostname`` and return True only if EVERY resolved address is
    globally routable. Closes the DNS-rebinding gap where a public hostname has
    a private / metadata A/AAAA record. Fails CLOSED (False) on any resolution
    error — an unresolvable host can't be a legitimate fetch target anyway.

    Note: this narrows but doesn't fully eliminate rebinding — the OS re-resolves
    at connect time, so a record that flips between this check and the socket
    connect (sub-TTL) can still slip. Pinning the connection to the validated IP
    would close that; this covers the realistic misconfig / static-record case.
    """
    try:
        infos = await asyncio.to_thread(
            socket.getaddrinfo, hostname, None, 0, socket.SOCK_STREAM
        )
    except OSError:
        return False
    if not infos:
        return False
    for info in infos:
        ip_str = info[4][0]
        # Strip any IPv6 scope id (e.g. "fe80::1%eth0").
        ip_str = ip_str.split("%", 1)[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            return False
        # IPv4-mapped IPv6 (::ffff:10.0.0.1) — judge the embedded v4.
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        if not ip.is_global:
            return False
    return True


async def is_allowed_url_resolved(url: str) -> bool:
    """SSRF gate WITH DNS resolution — the cheap ``is_allowed_url`` checks plus a
    resolve-and-validate pass on the hostname. Use this at the fetch site."""
    if not is_allowed_url(url):
        return False
    hostname = (urlparse(url).hostname or "").lower()
    if not hostname:
        return False
    # Literal IPs already passed is_global in is_allowed_url — no DNS needed.
    if _parse_ip(hostname) is not None:
        return True
    return await _host_resolves_public(hostname)
