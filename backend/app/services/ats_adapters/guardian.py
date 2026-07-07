"""Guardian Vietnam (guardian.com.vn) — server-rendered jobs table under
/tuyen-dung. Each row is [title, department, province, expiry, detail-link];
the row's anchor points at the job page. JD lives on the detail page.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_URL = "https://www.guardian.com.vn/tuyen-dung"


def _is_guardian(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "guardian.com.vn", "www.guardian.com.vn")


def _guardian(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get(_URL, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] guardian failed: {str(e)[:80]}")
        return []
    out, seen = [], set()
    for row in soup.select("table tr"):
        tds = row.find_all("td")
        if len(tds) < 3:
            continue
        a = row.select_one("a[href]")
        title = tds[0].get_text(" ", strip=True)
        if not a or not title:
            continue
        url = urljoin(_URL, a["href"])
        if url in seen:
            continue
        seen.add(url)
        out.append({
            "title": title[:200],
            "url": url,
            "location": tds[2].get_text(" ", strip=True),
            "description": "",
            "category": tds[1].get_text(" ", strip=True),
        })
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] guardian → {len(out)} jobs")
    return out


__all__ = ["_is_guardian", "_guardian"]
