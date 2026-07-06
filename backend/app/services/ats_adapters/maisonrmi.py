"""Maison RMI (maisonrmi.com, fashion retail: Charles & Keith / MLB / …) —
WordPress + JetEngine, listing grid is AJAX-loaded so the static career page
itself has 0 job links; the AJAX call it makes is public and callable
headlessly:
    POST /vi/career-vn/?nocache=1
      action=jet_engine_ajax&handler=get_listing&listing_type=elementor
      &page_settings[post_id]=3153&page_settings[queried_id]=3153|WP_Post
      &page_settings[element_id]=1836452&page_settings[page]={N}
    → {"success": true, "data": {"html": "<div class=jet-listing-grid>...<a href=.../vi/job/{slug}/>Title</a>..."}}
post_id/element_id are fixed IDs baked into this company's specific page
layout (not a generic JetEngine API param) — they'd need re-discovering if
this page is ever rebuilt.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_AJAX_URL = "https://maisonrmi.com/vi/career-vn/?nocache=1"
_MAX_PAGES = 5  # 10/page; caps at _MAX_ATS_JOBS via _finalize anyway


def _is_maisonrmi(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "maisonrmi.com", "www.maisonrmi.com")


def _maisonrmi(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    out, seen = [], set()
    for page in range(1, _MAX_PAGES + 1):
        try:
            r = requests.post(_AJAX_URL, headers=_HEADERS, timeout=_TIMEOUT, data={
                "action": "jet_engine_ajax", "handler": "get_listing",
                "listing_type": "elementor", "isEditMode": "false",
                "page_settings[post_id]": "3153",
                "page_settings[queried_id]": "3153|WP_Post",
                "page_settings[element_id]": "1836452",
                "page_settings[page]": str(page),
            })
            if r.status_code != 200:
                break
            html = ((r.json() or {}).get("data") or {}).get("html") or ""
        except Exception as e:
            logger.info(f"[ats] maisonrmi page {page} failed: {str(e)[:80]}")
            break
        if not html:
            break
        soup = BeautifulSoup(html, "html.parser")
        links = soup.select('a[href*="/vi/job/"]')
        if not links:
            break
        for a in links:
            href = a["href"]
            title = a.get_text(" ", strip=True)
            if not title or href in seen:
                continue
            seen.add(href)
            out.append({"title": title[:200], "url": href, "location": "", "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] maisonrmi → {len(out)} jobs")
    return out


__all__ = ["_is_maisonrmi", "_maisonrmi"]
