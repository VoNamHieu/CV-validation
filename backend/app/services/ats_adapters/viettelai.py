"""Viettel AI (viettelai.vn) — SPA over a plain JSON API.

Jobs come from GET /_backend/api/job/list → {"data":{"data":[{id, title,
job_location:{city}, ...}]}}. The generic scraper minted /job/{id} URLs that
404; the real deep-link is /job-detail/{id} (confirmed from the rendered DOM).
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_API = "https://viettelai.vn/_backend/api/job/list"
_DETAIL = "https://viettelai.vn/job-detail/"


def _is_viettelai(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "viettelai.vn"


def _viettelai(career_url: str) -> list[dict]:
    try:
        r = requests.get(_API, headers={**_HTML_HEADERS, "Accept": "application/json"}, timeout=_TIMEOUT)
        if r.status_code != 200:
            logger.info(f"[ats] viettelai → HTTP {r.status_code}")
            return []
        d = (r.json() or {}).get("data") or {}
        items = d.get("data") if isinstance(d, dict) else d
    except Exception as e:  # noqa: BLE001
        logger.info(f"[ats] viettelai failed: {str(e)[:70]}")
        return []
    if not isinstance(items, list):
        return []
    out: list[dict] = []
    for it in items:
        title = (it.get("title") or "").strip()
        jid = it.get("id")
        if not title or jid is None:
            continue
        jl = it.get("job_location") or {}
        loc = (jl.get("city") if isinstance(jl, dict) else "") or "Việt Nam"
        out.append({
            "title": title[:200],
            "url": f"{_DETAIL}{jid}",
            "external_id": str(jid),
            "location": str(loc)[:120],
            # Measured 2026-08-11: description == short_description on every
            # row (the tenant mirrors them) — this IS the whole posting.
            "description": _full_desc(it.get("description") or it.get("short_description")),
        })
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] viettelai → {len(out)} jobs")
    return out


__all__ = ["_is_viettelai", "_viettelai"]
