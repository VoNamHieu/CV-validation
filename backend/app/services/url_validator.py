"""
URL validation to prevent SSRF attacks.
Mirrors the frontend's isAllowedUrl() logic from validation.ts.
"""

import ipaddress
from urllib.parse import urlparse


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

        # Block private IP ranges (RFC 1918) and link-local.
        # Also catch integer-encoded hosts (e.g. http://2130706433 == 127.0.0.1),
        # which urlparse keeps as a bare digit string that ip_address(str) rejects.
        ip = None
        try:
            ip = ipaddress.ip_address(hostname)
        except ValueError:
            if hostname.isdigit():
                try:
                    ip = ipaddress.ip_address(int(hostname))
                except ValueError:
                    ip = None
        if ip is not None and (
            ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
        ):
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
