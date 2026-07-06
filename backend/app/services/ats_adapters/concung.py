"""Con Cưng (careers.concung.com) — office/corporate careers page (a separate
subdomain, vieclam.concung.com, handles retail-store hiring).

The listing grid is AJAX-loaded (static page has 0 job links); the AJAX call
is public and callable headlessly:
    POST /jobs/loadPage  list=&position=&search=&depart=&limit=&count=&page_count=&p={N}
    → an HTML fragment: div.block-job-home-item cards, each with an
      onclick="window.location.href='{relative-slug}.html'" (not a real
      <a href>), title in span.title-job, summary in div.sumary-job.
"""
from __future__ import annotations

import re

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_ORIGIN = "https://careers.concung.com"
_AJAX_URL = f"{_ORIGIN}/jobs/loadPage"
_MAX_PAGES = 5  # 10/page; caps at _MAX_ATS_JOBS via _finalize anyway
_ONCLICK_RX = re.compile(r"""window\.location\.href\s*=\s*['"]([^'"]+)['"]""")


def _is_concung(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "careers.concung.com", "www.careers.concung.com")


def _concung(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    out = []
    for page in range(1, _MAX_PAGES + 1):
        try:
            r = requests.post(_AJAX_URL, headers=_HEADERS, timeout=_TIMEOUT, data={
                "list": "", "position": "", "search": "", "depart": "",
                "limit": 10, "page_count": 5, "p": page,
            })
            if r.status_code != 200 or not r.text:
                break
            soup = BeautifulSoup(r.text, "html.parser")
        except Exception as e:
            logger.info(f"[ats] concung page {page} failed: {str(e)[:80]}")
            break
        boxes = soup.select("div.block-job-home-item")
        if not boxes:
            break
        for box in boxes:
            title_el = box.select_one("span.title-job")
            m = _ONCLICK_RX.search(box.get("onclick") or "")
            if not title_el or not m:
                continue
            title = title_el.get_text(" ", strip=True)
            summary_el = box.select_one("div.sumary-job")
            out.append({
                "title": title[:200],
                "url": urljoin(_ORIGIN + "/", m.group(1)),
                "location": "",
                "description": summary_el.get_text(" ", strip=True) if summary_el else "",
            })
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] concung → {len(out)} jobs")
    return out


__all__ = ["_is_concung", "_concung"]
