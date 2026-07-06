"""DOJI Group (tuyendung.doji.vn) — plain server-rendered ASP.NET WebForms
page, no API, no anti-bot.

Job list is a single static table at /tuyen-dung.html: each row is a
`<tr>` with the title link in the 1st `<td>` and location in the 2nd. No
query-string pagination was found (only an ASP.NET `__doPostBack` search
form) — 20 postings render on the one page.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_LIST_URL = "https://tuyendung.doji.vn/tuyen-dung.html"


def _is_doji(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "tuyendung.doji.vn", "www.tuyendung.doji.vn")


def _doji(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get(_LIST_URL, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] doji fetch failed: {str(e)[:80]}")
        return []

    out = []
    for tr in soup.select("table.table tr"):
        tds = tr.find_all("td")
        if len(tds) < 2:
            continue
        a = tds[0].find("a", href=True)
        if not a:
            continue
        title = a.get_text(" ", strip=True)
        if not title:
            continue
        out.append({
            "title": title[:200],
            "url": urljoin(_LIST_URL, a["href"]),
            "location": tds[1].get_text(" ", strip=True),
            "description": "",
        })
    logger.info(f"[ats] doji → {len(out)} jobs")
    return out


__all__ = ["_is_doji", "_doji"]
