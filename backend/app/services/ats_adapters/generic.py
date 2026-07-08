"""Generic hosted-ATS fetchers (Lever, Greenhouse, Ashby, Recruitee,
SmartRecruiters) + the name→fetcher map. Detection lives in core.detect_ats /
core.detect_ats_in_html; these turn a detected (name, slug) into jobs."""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

def _lever(slug: str) -> list[dict]:
    data = _get_json(f"https://api.lever.co/v0/postings/{slug}?mode=json")
    if not isinstance(data, list):  # error responses come back as a dict
        return []
    out = []
    for j in data:
        cats = j.get("categories") or {}
        out.append({
            "title": j.get("text", ""),
            "url": j.get("hostedUrl", ""),
            "location": cats.get("location", "") or "",
            "description": j.get("descriptionPlain") or _strip_html(j.get("description", "")),
        })
    return out


def _greenhouse(slug: str) -> list[dict]:
    data = _get_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true")
    out = []
    for j in (data or {}).get("jobs", []):
        loc = j.get("location") or {}
        out.append({
            "title": j.get("title", ""),
            "url": j.get("absolute_url", ""),
            "location": loc.get("name", "") if isinstance(loc, dict) else "",
            "description": _strip_html(j.get("content", "")),
        })
    return out


def _ashby(slug: str) -> list[dict]:
    data = _get_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
    out = []
    for j in (data or {}).get("jobs", []):
        out.append({
            "title": j.get("title", ""),
            "url": j.get("jobUrl", "") or j.get("applyUrl", ""),
            "location": j.get("location", "") or "",
            "description": j.get("descriptionPlain") or _strip_html(j.get("descriptionHtml", "")),
        })
    return out


def _recruitee(slug: str) -> list[dict]:
    data = _get_json(f"https://{slug}.recruitee.com/api/offers/")
    out = []
    for o in (data or {}).get("offers", []):
        out.append({
            "title": o.get("title", ""),
            "url": o.get("careers_url") or o.get("url", ""),
            "location": o.get("city", "") or o.get("location", "") or "",
            "description": _strip_html(o.get("description", "")),
        })
    return out


def _smartrecruiters(slug: str) -> list[dict]:
    # Ask the API for VN postings first (server-side country facet). Big tenants
    # (Grab: 300+ roles) bury their handful of VN jobs past the first page, so an
    # unfiltered limit=100 misses them; country=vn returns exactly the VN set.
    # Fall back to unfiltered when the country facet yields nothing (a company
    # that tags VN roles without the country field), leaving the VN filter to the
    # caller.
    base = f"https://api.smartrecruiters.com/v1/companies/{slug}/postings"
    out = []
    # Try the VN country facet first, else unfiltered. Whichever returns content,
    # paginate it by offset — the API caps at limit=100/page and returns
    # `totalFound`, so a single page silently truncated big tenants (Bosch: 164
    # VN jobs → 100). Loop until we've pulled totalFound or hit the global cap.
    for q in (f"{base}?limit=100&country=vn", f"{base}?limit=100"):
        first = _get_json(f"{q}&offset=0")
        content = (first or {}).get("content") or []
        if not content:
            continue
        total = (first or {}).get("totalFound") or len(content)
        offset = 0
        while content:
            for j in content:
                loc = j.get("location") or {}
                jid = j.get("id", "")
                out.append({
                    "title": j.get("name", ""),
                    "url": f"https://jobs.smartrecruiters.com/{slug}/{jid}" if jid else "",
                    "location": loc.get("city", "") if isinstance(loc, dict) else "",
                    "description": "",  # JD needs a per-posting call; skip for now
                })
            offset += 100
            if offset >= total or len(out) >= _MAX_ATS_JOBS:
                break
            content = (_get_json(f"{q}&offset={offset}") or {}).get("content") or []
        break  # used whichever query first returned content
    return out


_FETCHERS = {
    "lever": _lever,
    "greenhouse": _greenhouse,
    "ashby": _ashby,
    "recruitee": _recruitee,
    "smartrecruiters": _smartrecruiters,
}

