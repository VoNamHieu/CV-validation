"""Home Credit Vietnam (career.homecredit.vn) — job list ships as a static
JSON file the page's own JS fetches client-side (server HTML renders an
empty `#jobs-accordion` + a `<template>`), so a plain page GET sees no jobs.
The JSON itself needs no auth/render:
    GET /hiring-jobs.json  → [{slug, title, title_vn, desc (HTML),
                               province_vn, district_vn, ...}, ...]
All jobs ship in one response (no pagination). Detail URL is /vn/job/{slug}/.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_API = "https://career.homecredit.vn/hiring-jobs.json"
_DETAIL_BASE = "https://career.homecredit.vn/vn/job"


def _is_homecredit(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "career.homecredit.vn", "www.career.homecredit.vn")


def _homecredit(career_url: str) -> list[dict]:
    try:
        r = requests.get(_API, headers=_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        items = r.json() or []
    except Exception as e:
        logger.info(f"[ats] homecredit fetch failed: {str(e)[:80]}")
        return []

    out = []
    for it in items:
        slug = it.get("slug")
        title = (it.get("title_vn") or it.get("title") or "").strip()
        if not slug or not title:
            continue
        location = ", ".join(p for p in (it.get("province_vn"), it.get("district_vn")) if p)
        out.append({
            "title": title[:200],
            "url": f"{_DETAIL_BASE}/{slug}/",
            "location": location,
            "description": _strip_html(it.get("desc", "")),
        })
    logger.info(f"[ats] homecredit → {len(out)} jobs")
    return out


__all__ = ["_is_homecredit", "_homecredit"]
