"""Cốc Cốc (careers.coccoc.com) — Next.js SPA backed by a public JSON API.

Jobs come from ``https://careers-api.coccoc.com/api/v3/jobs`` (paginated, items
carry id / title / location / job_slug). The generic SPA-sniff was minting
``/job/{id}`` (singular) URLs that 404; the real detail route is
``/jobs/{job_slug}`` (plural, slug) — e.g. /jobs/compensation-benefits-intern-2.
Identity is the numeric id (stable regardless of the slug's uniqueness suffix).
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_API = "https://careers-api.coccoc.com/api/v3/jobs"
_DETAIL = "https://careers.coccoc.com/jobs"


def _is_coccoc(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.").endswith("coccoc.com")


def _coccoc(career_url: str) -> list[dict]:
    hdr = {**_HTML_HEADERS, "Accept": "application/json"}
    out: list[dict] = []
    url = f"{_API}?per_page=100"
    for _ in range(10):  # pagination guard (follow _links.next_page)
        try:
            r = requests.get(url, headers=hdr, timeout=_TIMEOUT)
            if r.status_code != 200:
                break
            j = r.json()
        except Exception as e:  # noqa: BLE001
            logger.info(f"[ats] coccoc failed: {str(e)[:70]}")
            break
        for it in (j.get("items") or []):
            title = (it.get("title") or "").strip()
            slug = it.get("job_slug")
            jid = it.get("id")
            if not title or not slug:
                continue
            out.append({
                "title": title[:200],
                "url": f"{_DETAIL}/{slug}",
                "external_id": str(jid) if jid else str(slug),
                "location": it.get("location") or "",
                "description": "",
            })
            if len(out) >= _MAX_ATS_JOBS:
                return out
        nxt = (j.get("_links") or {}).get("next_page")
        if not nxt:
            break
        url = nxt
    logger.info(f"[ats] coccoc → {len(out)} jobs")
    return out


__all__ = ["_is_coccoc", "_coccoc"]
