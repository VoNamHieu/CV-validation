"""AEON Việt Nam (tuyendung.aeon.com.vn) — plain JSON API, no anti-bot.

Career site is a Next.js SPA; the list itself calls a public, unauthenticated
API directly:
    POST /api/hiring/list  {"page": N}
    → {"data": {"data": [...], "pagination": {"total","total_pages",...}}}
Each item carries `text_deadline` — many postings in the feed are already
expired ("Hết hạn") but still returned, so that field is the only reliable
active/expired signal and must be filtered on.

Detail route is /vi/job-detail/{slug} — confirmed live (200, not 404) with
the API's own `slug` field; the route is client-rendered so a plain fetch
can't verify per-job content, but it's the real prefix the app itself uses
(other guessed prefixes 404 outright).
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_API = "https://api-tuyendung.aeon.com.vn/api/hiring/list"
_DETAIL_BASE = "https://tuyendung.aeon.com.vn/vi/job-detail"
_MAX_PAGES = 20  # 10/page; caps at _MAX_ATS_JOBS via _finalize anyway


def _is_aeon(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "tuyendung.aeon.com.vn", "www.tuyendung.aeon.com.vn")


def _aeon(career_url: str) -> list[dict]:
    out = []
    for page in range(1, _MAX_PAGES + 1):
        try:
            r = requests.post(_API, headers=_JSON_POST, timeout=_TIMEOUT, json={"page": page})
            if r.status_code != 200:
                break
            data = (r.json() or {}).get("data") or {}
            items = data.get("data") or []
            if not items:
                break
            for it in items:
                if it.get("text_deadline") == "Hết hạn":
                    continue  # expired posting still returned by the feed
                title = (it.get("title") or "").strip()
                slug = it.get("slug")
                if not title or not slug:
                    continue
                out.append({"title": title[:200], "url": f"{_DETAIL_BASE}/{slug}",
                            "location": it.get("address") or "", "description": ""})
            if page >= (data.get("pagination") or {}).get("total_pages", page) or len(out) >= _MAX_ATS_JOBS:
                break
        except Exception as e:
            logger.info(f"[ats] aeon page {page} failed: {str(e)[:80]}")
            break
    logger.info(f"[ats] aeon → {len(out)} jobs")
    return out


__all__ = ["_is_aeon", "_aeon"]
