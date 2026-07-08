"""VNPT Group (tuyendung.vnpt.vn) — plain server-rendered HTML, no API, no gate.

Job list is paginated static HTML at
  /viec-lam/tat-ca-viec-lam.html          (page 1)
  /viec-lam/tat-ca-viec-lam/p{N}.html     (page N)
Each posting is a `div.result-item` with the title in `div.item-text h4`
(also the anchor text) and location in `div.div-location`. No anti-bot, no
JS — a plain GET is enough.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_BASE = "https://tuyendung.vnpt.vn/viec-lam/tat-ca-viec-lam"
_MAX_PAGES = 30  # ~10/page; source has ~145 jobs, so 30 pages reaches the 300 cap


def _is_vnpt(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "tuyendung.vnpt.vn", "www.tuyendung.vnpt.vn")


def _vnpt(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    out = []
    for page in range(1, _MAX_PAGES + 1):
        url = _BASE + ".html" if page == 1 else f"{_BASE}/p{page}.html"
        try:
            r = requests.get(url, headers=_HTML_HEADERS, timeout=_TIMEOUT)
            if r.status_code != 200:
                break
            soup = BeautifulSoup(r.text, "html.parser")
        except Exception as e:
            logger.info(f"[ats] vnpt page {page} failed: {str(e)[:80]}")
            break
        items = soup.select("div.result-item")
        if not items:
            break
        for it in items:
            a = it.select_one("div.item-text a[href]")
            if not a:
                continue
            title = a.get_text(" ", strip=True)
            href = a["href"]
            if not title or not href:
                continue
            loc_el = it.select_one("div.div-location")
            location = loc_el.get_text(" ", strip=True) if loc_el else ""
            out.append({"title": title[:200], "url": href, "location": location, "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] vnpt → {len(out)} jobs")
    return out


__all__ = ["_is_vnpt", "_vnpt"]
