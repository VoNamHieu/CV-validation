"""De Heus Vietnam (deheus.com.vn) — server-rendered careers listing. Each
opening is a link to /lam-viec-tai-de-heus/co-hoi-nghe-nghiep/{slug} with the
title as its anchor text. JD lives on the detail page (read by the crawler).
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_URL = "https://www.deheus.com.vn/lam-viec-tai-de-heus/co-hoi-nghe-nghiep/"
_DETAIL_RX = re.compile(r"/lam-viec-tai-de-heus/co-hoi-nghe-nghiep/[^/]+/?$", re.I)


def _is_deheus(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "deheus.com.vn", "www.deheus.com.vn")


def _deheus(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get(_URL, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] deheus failed: {str(e)[:80]}")
        return []
    out, seen = [], set()
    for a in soup.select('a[href*="/co-hoi-nghe-nghiep/"]'):
        href = a.get("href") or ""
        title = a.get_text(" ", strip=True)
        if not _DETAIL_RX.search(href) or not title:
            continue
        url = urljoin(_URL, href)
        if url in seen:
            continue
        seen.add(url)
        out.append({"title": title[:200], "url": url, "location": "", "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] deheus → {len(out)} jobs")
    return out


__all__ = ["_is_deheus", "_deheus"]
