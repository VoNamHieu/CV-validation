"""Thế Giới Di Động / Mobile World Group (vieclam.thegioididong.com) — plain
server-rendered HTML, no API, no anti-bot gate.

Job list is paginated static HTML at
  /tuyen-dung-tat-ca-dia-diem              (page 1)
  /tuyen-dung-tat-ca-dia-diem?key=&page=N  (page N)
Each posting is a `div.job_box` with title in `div.title h3` and location in
the first `li.info_box`. Anchor text mixes title + headcount + salary with no
separators, so the title element must be read directly, not the link text.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_LIST_URL = "https://vieclam.thegioididong.com/tuyen-dung-tat-ca-dia-diem"
_MAX_PAGES = 5  # ~20/page; caps at _MAX_ATS_JOBS via _finalize anyway


def _is_thegioididong(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "vieclam.thegioididong.com", "www.vieclam.thegioididong.com")


def _thegioididong(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    out = []
    for page in range(1, _MAX_PAGES + 1):
        params = {} if page == 1 else {"key": "", "page": page}
        try:
            r = requests.get(_LIST_URL, headers=_HTML_HEADERS, params=params, timeout=_TIMEOUT)
            if r.status_code != 200:
                break
            soup = BeautifulSoup(r.text, "html.parser")
        except Exception as e:
            logger.info(f"[ats] thegioididong page {page} failed: {str(e)[:80]}")
            break
        boxes = soup.select("div.job_box")
        if not boxes:
            break
        for box in boxes:
            a = box.find("a", href=True)
            title_el = box.select_one("div.title h3")
            if not a or not title_el:
                continue
            title = title_el.get_text(" ", strip=True)
            href = urljoin(_LIST_URL, a["href"])
            loc_el = box.select_one("li.info_box")
            location = loc_el.get_text(" ", strip=True) if loc_el else ""
            if title:
                out.append({"title": title[:200], "url": href, "location": location, "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] thegioididong → {len(out)} jobs")
    return out


__all__ = ["_is_thegioididong", "_thegioididong"]
