"""Honda Vietnam (honda.com.vn) — server-rendered job cards under
/tuyen-dung/co-hoi-nghe-nghiep. Each `div.card-body` holds the title
(`.title`), location (`.address`) and an apply link (/tuyen-dung/cv/{slug}).
The listing carries no JD, so description is left for the crawler to read from
the linked page.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_URL = "https://www.honda.com.vn/tuyen-dung/co-hoi-nghe-nghiep"


def _is_honda(career_url: str) -> bool:
    p = urlparse(career_url or "")
    return (p.netloc or "").lower() in ("www.honda.com.vn", "honda.com.vn") \
        and "tuyen-dung" in (p.path or "")


def _honda(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get(_URL, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] honda failed: {str(e)[:80]}")
        return []
    out = []
    for a in soup.select('a[href*="/tuyen-dung/cv/"]'):
        card = a.find_parent(class_="card-body") or a.find_parent(["div", "article", "li"])
        if not card:
            continue
        te = card.select_one(".title")
        title = te.get_text(" ", strip=True) if te else ""
        if not title:
            continue
        loc = card.select_one(".address")
        out.append({
            "title": title[:200],
            "url": urljoin(_URL, a["href"]),
            "location": loc.get_text(" ", strip=True) if loc else "",
            "description": "",
        })
    logger.info(f"[ats] honda → {len(out)} jobs")
    return out


__all__ = ["_is_honda", "_honda"]
