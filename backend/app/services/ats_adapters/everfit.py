"""Everfit (jobs.everfit.vn) — the careers site is a JS SPA backed by a clean
public JSON API on the product's HR service (hr-api.everfit.io). No token, and
the API takes a `country` facet so we ask it for VN roles directly.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_API = "https://hr-api.everfit.io/api/public/job/get-list"
_SITE = "https://jobs.everfit.vn"
# The JD is split across several HTML fields on the listing object; stitch the
# populated ones together in reading order.
_JD_FIELDS = ("lookFor", "responsibility", "qualifications", "preferedSkill", "benefits")


def _is_everfit(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "jobs.everfit.vn", "everfit.vn")


def _everfit(career_url: str) -> list[dict]:
    # showClosingJob=false drops expired posts; limit high enough for the whole
    # (small) board in one call; country=VN filters server-side.
    data = _get_json(f"{_API}?showClosingJob=false&country=VN&limit=200")
    lst = ((data or {}).get("data") or {}).get("list") or []
    out = []
    for j in lst:
        if j.get("isDeleted") or not j.get("isActive", True):
            continue
        jid = j.get("_id")
        if not jid:
            continue
        desc = "\n\n".join(
            _strip_html(j[f]) for f in _JD_FIELDS if (j.get(f) or "").strip()
        )
        jt = j.get("jobType") or []
        sal = j.get("totalSalary") or {}
        out.append({
            "title": j.get("jobTitle", ""),
            "url": f"{_SITE}/jobs/{jid}",
            "location": j.get("location", "") or "",
            "description": desc,
            "employment_type": jt[0] if jt else "",
            "category": j.get("category", "") or "",
            "salary": f"{sal.get('min')}–{sal.get('max')}" if sal.get("min") and sal.get("max") else "",
        })
    logger.info(f"[ats] everfit → {len(out)} jobs")
    return out


__all__ = ["_is_everfit", "_everfit"]
