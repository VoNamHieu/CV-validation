"""VNPT AI (vnptai.io) — plain server-rendered HTML, no API, no gate.

Separate from VNPT Group's own tuyendung.vnpt.vn (a distinct subsidiary/brand
with its own site). Job list is a single static page at /vi/recruitment —
each posting is a `div.box-job` with the title in `h3` and location in the
span following the "Địa điểm làm việc:" label. No pagination observed (all
postings render on one page).
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_LIST_URL = "https://vnptai.io/vi/recruitment"


def _is_vnptai(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "vnptai.io", "www.vnptai.io")


def _vnptai(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get(_LIST_URL, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] vnptai fetch failed: {str(e)[:80]}")
        return []

    out = []
    for box in soup.select("div.box-job"):
        a = box.find("a", href=True)
        h3 = box.find("h3")
        if not a or not h3:
            continue
        title = h3.get_text(" ", strip=True)
        href = a["href"]
        loc_label = box.find(string=lambda s: s and "Địa điểm làm việc" in s)
        location = ""
        if loc_label:
            loc_span = loc_label.find_parent("span")
            sib = loc_span.find_next_sibling("span") if loc_span else None
            location = sib.get_text(" ", strip=True) if sib else ""
        if title and href:
            out.append({"title": title[:200], "url": href, "location": location, "description": ""})
    logger.info(f"[ats] vnptai → {len(out)} jobs")
    return out


__all__ = ["_is_vnptai", "_vnptai"]
