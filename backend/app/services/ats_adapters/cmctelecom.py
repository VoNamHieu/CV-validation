"""CMC Telecom (cmctelecom.vn) — server-rendered job table under
/danh-sach-tuyen-dung/. Each row links to /recruit/{slug} with the title as
anchor text; the row's cells carry salary, area (location) and expiry. Mobile
labels ("Khu vực …") are prefixed into the cell text, so we strip them.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_URL = "https://cmctelecom.vn/danh-sach-tuyen-dung/"
_LABELS = ("Khu vực", "Mức lương", "Ngày hết hạn", "Công việc")


def _is_cmctelecom(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "cmctelecom.vn", "www.cmctelecom.vn")


def _clean(cell: str) -> str:
    s = (cell or "").strip()
    for lbl in _LABELS:
        if s.startswith(lbl):
            s = s[len(lbl):].strip()
    return s


def _cmctelecom(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get(_URL, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] cmctelecom failed: {str(e)[:80]}")
        return []
    out = []
    seen = set()
    for row in soup.select("table tr"):
        a = row.select_one('a[href*="/recruit/"]')
        if not a:
            continue
        title = a.get_text(" ", strip=True)
        url = urljoin(_URL, a["href"])
        if not title or url in seen:
            continue
        seen.add(url)
        tds = row.find_all("td")
        loc = _clean(tds[2].get_text(" ", strip=True)) if len(tds) > 2 else ""
        sal = _clean(tds[1].get_text(" ", strip=True)) if len(tds) > 1 else ""
        out.append({
            "title": title[:200],
            "url": url,
            "location": loc,
            "description": "",
            "salary": "" if sal.lower() in ("thỏa thuận", "thoa thuan") else sal,
        })
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] cmctelecom → {len(out)} jobs")
    return out


__all__ = ["_is_cmctelecom", "_cmctelecom"]
