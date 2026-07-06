"""Viettel High Tech (viettelhightech.vn) — static HTML behind a trivial JS
cookie-gate, no ATS/anti-bot vendor involved.

A bare GET returns a 177-byte stub:
    <script>document.cookie="D1N=<token>"; ...; window.location.reload(true);</script>
A real browser executes this, sets the cookie, and reloads to get the actual
page; a plain HTTP client never does. But the gate itself is trivial to pass
headlessly: read the token out of that stub with a regex and replay the exact
same GET with the cookie set — no render, no capture, needed. (The token was
observed identical across two unrelated pages/times, suggesting it's a fixed
site-wide value rather than a per-visit challenge — read it fresh each time
anyway rather than hardcoding it, in case that ever changes.)

Once past the gate, job list + detail pages are plain server-rendered HTML
(no API): list tiles are `<a href=".../tuyen-dung/{slug}">{title}</a>`, detail
JD lives in `div.s-content`.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_LIST_URL = "https://viettelhightech.vn/danh-sach-tuyen-dung"
_GATE_RX = re.compile(r'document\.cookie\s*=\s*"([^"]+)"')


def _is_viettelhightech(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "viettelhightech.vn", "www.viettelhightech.vn")


def _pass_gate(url: str) -> str:
    """GET url; if answered with the cookie-gate stub, extract the cookie and
    replay the GET. Returns the real page HTML, or "" on failure."""
    try:
        r = requests.get(url, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        html = r.text or ""
    except Exception as e:
        logger.info(f"[ats] viettelhightech gate GET failed ({url}): {str(e)[:80]}")
        return ""
    m = _GATE_RX.search(html)
    if not m:
        return html  # already past the gate (or site stopped using it)
    try:
        r2 = requests.get(url, headers={**_HTML_HEADERS, "Cookie": m.group(1)}, timeout=_TIMEOUT)
        return r2.text or ""
    except Exception as e:
        logger.info(f"[ats] viettelhightech gated GET failed ({url}): {str(e)[:80]}")
        return ""


def _viettelhightech(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    html = _pass_gate(_LIST_URL)
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    out = []
    for h3 in soup.select("h3.title"):
        a = h3.find("a", href=True)
        if not a:
            continue
        title = a.get_text(" ", strip=True)
        href = a["href"]
        if not title or not href or "/tuyen-dung/" not in href:
            continue
        out.append({"title": title[:200], "url": href, "location": "", "description": ""})
    logger.info(f"[ats] viettelhightech → {len(out)} jobs")
    return out


__all__ = ["_is_viettelhightech", "_viettelhightech"]
