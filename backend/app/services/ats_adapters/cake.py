"""Cake (cake.vn/tuyen-dung/jobs) — a SPA; its job list comes from a public ATS
endpoint found by rendering + sniffing the network:
  GET https://ats.internal.cake.vn/api/job-post/public/all
  → {"data":[{id, title, job_content, office:{name}, department, …}]}
Detail page = cake.vn/tuyen-dung/jobs/{key} (key = slug; the numeric id 404s).
VN fintech → all VN.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_EP = "https://ats.internal.cake.vn/api/job-post/public/all"
_DETAIL = "https://cake.vn/tuyen-dung/jobs/"


def _is_cake(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "cake.vn"


def _cake(career_url: str) -> list[dict]:
    try:
        r = requests.get(_EP, headers=_JSON_POST, timeout=_TIMEOUT)
        if r.status_code != 200:
            logger.info(f"[ats] cake → HTTP {r.status_code}")
            return []
        rows = (r.json() or {}).get("data") or []
    except Exception as e:
        logger.info(f"[ats] cake failed: {str(e)[:80]}")
        return []

    out = []
    for j in rows:
        title = (j.get("title") or "").strip()
        jid = j.get("id")
        # Detail URL is /jobs/{key} — `key` is the slug (e.g. Backend-Engineer);
        # the numeric `id` route 404s. Identity stays the numeric id.
        key = (j.get("key") or "").strip()
        if not title or not jid or not key:
            continue
        office = j.get("office") or {}
        loc = (office.get("name") if isinstance(office, dict) else "") or ""
        out.append({
            "title": title[:200],
            "url": f"{_DETAIL}{key}",
            "external_id": str(jid),
            "location": str(loc)[:120],
            "description": _full_desc(j.get("job_content")),
        })
    logger.info(f"[ats] cake → {len(out)} jobs")
    return out


__all__ = ["_is_cake", "_cake"]
