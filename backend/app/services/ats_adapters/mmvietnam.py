"""MM Mega Market Vietnam (mmvietnam.com) — WordPress "Awesome Job Board"
plugin. Every job is an `a.awsm-job-listing-item` carrying its own detail URL,
title (`.awsm-job-post-title`) and specs (location/category). We read the
all-jobs listing so we're not limited to whichever category the featured URL
points at.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_URL = "https://mmvietnam.com/tuyen-dung/"


def _is_mmvietnam(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "mmvietnam.com", "www.mmvietnam.com")


def _mmvietnam(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get(_URL, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] mmvietnam failed: {str(e)[:80]}")
        return []
    out = []
    # The plugin renders two layouts: the item is an <a> itself (category pages)
    # or a <div> wrapping an inner /jobs/ link (the all-jobs page).
    for it in soup.select("a.awsm-job-listing-item, div.awsm-job-listing-item"):
        te = it.select_one(".awsm-job-post-title")
        title = te.get_text(" ", strip=True) if te else ""
        if it.name == "a":
            href = it.get("href")
        else:
            link = it.select_one('a[href*="/jobs/"]')
            href = link.get("href") if link else None
        if not href or not title:
            continue
        loc = it.select_one(".awsm-job-specification-job-location .awsm-job-specification-term")
        cat = it.select_one(".awsm-job-specification-job-category .awsm-job-specification-term")
        out.append({
            "title": title[:200],
            "url": urljoin(_URL, href),
            "location": loc.get_text(" ", strip=True) if loc else "",
            "category": cat.get_text(" ", strip=True) if cat else "",
            "description": "",
        })
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] mmvietnam → {len(out)} jobs")
    return out


__all__ = ["_is_mmvietnam", "_mmvietnam"]
