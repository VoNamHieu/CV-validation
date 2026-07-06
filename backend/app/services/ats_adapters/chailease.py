"""Chailease Vietnam (chailease.com.vn) — plain server-rendered HTML, no
API, no anti-bot gate.

Job list is a paginated static table at
  /vn/tuyen-dung/-vi-tri-tuyen-dung/8/{N}
(the leading "8" is this category's fixed CMS id). Each row is a `<tr>` in
`div.new-recruitment table` with title in the 2nd `<td>`, location in the
3rd, and the detail link (anchor text is just "Tìm hiểu thêm", not the
title) in the last `<td>`.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_BASE = "https://www.chailease.com.vn/vn/tuyen-dung/-vi-tri-tuyen-dung/8"
_MAX_PAGES = 5  # ~10/page; caps at _MAX_ATS_JOBS via _finalize anyway


def _is_chailease(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "www.chailease.com.vn", "chailease.com.vn")


def _chailease(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    out = []
    for page in range(1, _MAX_PAGES + 1):
        url = f"{_BASE}/{page}"
        try:
            r = requests.get(url, headers=_HTML_HEADERS, timeout=_TIMEOUT)
            if r.status_code != 200:
                break
            r.encoding = "utf-8"  # server omits charset in Content-Type; page declares utf-8
            soup = BeautifulSoup(r.text, "html.parser")
        except Exception as e:
            logger.info(f"[ats] chailease page {page} failed: {str(e)[:80]}")
            break
        box = soup.select_one("div.new-recruitment table")
        if not box:
            break
        rows = box.select("tbody tr")
        if not rows:
            break
        for tr in rows:
            tds = tr.find_all("td")
            if len(tds) < 5:
                continue
            title = tds[1].get_text(" ", strip=True)
            a = tds[4].find("a", href=True)
            if not title or not a:
                continue
            out.append({
                "title": title[:200],
                "url": urljoin(url, a["href"]),
                "location": tds[2].get_text(" ", strip=True),
                "description": "",
            })
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] chailease → {len(out)} jobs")
    return out


__all__ = ["_is_chailease", "_chailease"]
