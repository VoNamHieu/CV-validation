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


# The site intermittently serves a stripped page (no job_box, ~38 KB vs ~64 KB) —
# a flaky server variant, NOT a UA/cookie/selector issue (confirmed: an identical
# request alternates full/empty, and a warmed session doesn't help). A single
# fetch per cron run therefore missed the feed and TGDĐ went "stale". Retrying an
# empty page recovers it during "mixed" periods; during a full-bad streak even
# retries fail, so this is a mitigation, not a cure — the durable fix is to let
# the adapter consume the phase-2 rendered HTML (real browsers get the full page).
_EMPTY_RETRIES = 6
_RETRY_SLEEP = 0.4


def _fetch_boxes(page: int):
    import time
    from bs4 import BeautifulSoup
    params = {} if page == 1 else {"key": "", "page": page}
    for attempt in range(_EMPTY_RETRIES):
        try:
            r = requests.get(_LIST_URL, headers=_HTML_HEADERS, params=params, timeout=_TIMEOUT)
        except Exception as e:
            logger.info(f"[ats] thegioididong page {page} attempt {attempt} failed: {str(e)[:80]}")
            time.sleep(_RETRY_SLEEP)
            continue
        if r.status_code != 200:
            return None  # hard failure → stop paginating
        boxes = BeautifulSoup(r.text, "html.parser").select("div.job_box")
        if boxes:
            return boxes
        time.sleep(_RETRY_SLEEP)  # flaky-empty variant → wait, retry
    return []  # empty even after retries → genuine end (or a bad streak)


def _parse_boxes(boxes, out: list[dict]) -> None:
    for box in boxes:
        a = box.find("a", href=True)
        title_el = box.select_one("div.title h3")
        if not a or not title_el:
            continue
        title = title_el.get_text(" ", strip=True)
        if not title:
            continue
        loc_el = box.select_one("li.info_box")
        out.append({
            "title": title[:200],
            "url": urljoin(_LIST_URL, a["href"]),
            "location": loc_el.get_text(" ", strip=True) if loc_el else "",
            "description": "",
        })


def _thegioididong(career_url: str, html: str | None = None) -> list[dict]:
    # Two-gate design for a flaky site:
    #   1st gate (phase 1, html=None): cheap fetch-with-retry, paginated.
    #   2nd gate (phase 2): the cron renders the page and passes the HTML here.
    #     A real-browser render reliably gets the full page, so if that HTML
    #     already carries job_box rows we parse them directly — no re-fetch, no
    #     flakiness. (Render only has page 1 → ~20 jobs, better than 0.)
    out: list[dict] = []
    if html:
        from bs4 import BeautifulSoup
        rendered = BeautifulSoup(html, "html.parser").select("div.job_box")
        if rendered:
            _parse_boxes(rendered, out)
            logger.info(f"[ats] thegioididong (rendered) → {len(out)} jobs")
            return out
        # rendered HTML had no rows (rare) → fall through to the fetch path.

    for page in range(1, _MAX_PAGES + 1):
        boxes = _fetch_boxes(page)
        if boxes is None or not boxes:
            break
        _parse_boxes(boxes, out)
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] thegioididong → {len(out)} jobs")
    return out


__all__ = ["_is_thegioididong", "_thegioididong"]
