"""FE Credit (tuyendung.fecredit.com.vn) — server-rendered job cards under
/ung-tuyen/. Each `.intro-item` card holds location (`.location-text`), title
(`.title-text`), salary (`.salary-text`) and an apply link
(/ung-tuyen/danh-sach-vi-tri-dang-mo/{slug}).
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_URL = "https://tuyendung.fecredit.com.vn/ung-tuyen/"


def _is_fecredit(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() == "tuyendung.fecredit.com.vn"


def _fecredit(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get(_URL, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] fecredit failed: {str(e)[:80]}")
        return []
    out = []
    seen = set()
    for card in soup.select(".intro-item"):
        te = card.select_one(".title-text")
        a = card.select_one('a[href*="danh-sach-vi-tri-dang-mo/"]')
        title = te.get_text(" ", strip=True) if te else ""
        if not title or not a:
            continue
        url = urljoin(_URL, a["href"])
        if url in seen:
            continue
        seen.add(url)
        loc = card.select_one(".location-text")
        sal = card.select_one(".salary-text")
        salt = sal.get_text(" ", strip=True) if sal else ""
        out.append({
            "title": title[:200],
            "url": url,
            "location": loc.get_text(" ", strip=True) if loc else "",
            "description": "",
            "salary": "" if salt.lower() in ("thỏa thuận", "thoa thuan") else salt,
        })
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] fecredit → {len(out)} jobs")
    return out


__all__ = ["_is_fecredit", "_fecredit"]
