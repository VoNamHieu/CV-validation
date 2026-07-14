"""247Express (247express.vn) — a Next.js SPA whose job list loads from a JSON
API found by rendering + sniffing the network (no static HTML jobs):
  POST https://v4-api.247express.vn/api/Job/ListJob
  body {"PageIndex":1,"PageSize":N,"SortBy":"desc","OrderBy":"Id","CityId":0,
        "JobTypeBlock":0,"JobBlock":0,"Keyword":""}   (the SortBy/OrderBy/CityId/
        JobTypeBlock/JobBlock/Keyword keys are all required — an empty body 0s it)
  → {"Data":[{Name, SEO:{Slug}, Cities:[…], JobSummary, …}], "TotalRecord":N}
Detail page = 247express.vn/tuyen-dung/{slug}. VN delivery company → all VN.
Replaces the spa_sniff render fallback with a clean single POST.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_EP = "https://v4-api.247express.vn/api/Job/ListJob"
_DETAIL = "https://247express.vn/tuyen-dung/"


def _is_express247(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "247express.vn"


def _express247(career_url: str) -> list[dict]:
    body = {"PageIndex": 1, "PageSize": min(_MAX_ATS_JOBS, 200), "SortBy": "desc",
            "OrderBy": "Id", "CityId": 0, "JobTypeBlock": 0, "JobBlock": 0, "Keyword": ""}
    try:
        r = requests.post(_EP, json=body, timeout=_TIMEOUT, headers={
            **_JSON_POST, "Origin": "https://247express.vn",
            "Referer": "https://247express.vn/tuyen-dung"})
        if r.status_code != 200:
            logger.info(f"[ats] 247express → HTTP {r.status_code}")
            return []
        rows = (r.json() or {}).get("Data") or []
    except Exception as e:
        logger.info(f"[ats] 247express failed: {str(e)[:80]}")
        return []

    out = []
    for j in rows:
        seo = j.get("SEO") or {}
        title = (j.get("Name") or seo.get("Name") or "").strip()
        slug = (seo.get("Slug") or "").strip()
        if not title or not slug:
            continue
        cities = [c for c in (j.get("Cities") or []) if c]
        out.append({
            "title": title[:200],
            "url": _DETAIL + slug,
            "location": ", ".join(cities)[:120],
            "description": _strip_html(j.get("JobSummary") or j.get("JobDescription") or "")[:600],
        })
    logger.info(f"[ats] 247express → {len(out)} jobs")
    return out


__all__ = ["_is_express247", "_express247"]
