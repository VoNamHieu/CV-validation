"""Pharmacity (corp.pharmacity.vn) — WordPress careers page, server-rendered.

All ~57 openings render as <a href="…/career/<slug>/"> anchors on one static
page — no server pagination, no API. Its career_url path (/tim-viec-lam/) would
otherwise be mis-claimed by the talentnet adapter, whose /viec-lam/*.html tile
selector matches nothing here → 0 jobs. So this adapter is registered BEFORE
talentnet and gated on the host, taking Pharmacity out of talentnet's reach.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_HOSTS = ("corp.pharmacity.vn", "pharmacity.vn", "www.pharmacity.vn")
_JOB_RX = re.compile(r"/career/[a-z0-9-]{3,}/?$", re.I)


def _is_pharmacity(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in _HOSTS


def _pharmacity(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get(career_url, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:  # noqa: BLE001
        logger.info(f"[ats] pharmacity fetch failed: {str(e)[:80]}")
        return []

    out, seen = [], set()
    for a in soup.select('a[href*="/career/"]'):
        href = a.get("href", "")
        if not _JOB_RX.search(href):  # skip the bare /career root + nav links
            continue
        url = urljoin(career_url, href)
        title = a.get_text(" ", strip=True)
        if url in seen or not title or len(title) < 4:
            continue
        seen.add(url)
        out.append({"title": title[:200], "url": url, "location": "", "description": ""})
    logger.info(f"[ats] pharmacity → {len(out)} jobs")
    return out


__all__ = ["_is_pharmacity", "_pharmacity"]
