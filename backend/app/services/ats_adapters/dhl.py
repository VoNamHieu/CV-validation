"""DHL (careers.dhl.com) — a Phenom career site, but neither Phenom variant the
existing adapters speak works here:
  - /services/jobs/search/  → returns non-JSON (phenom-services fails)
  - /api/apply/v2/jobs      → "Tenant not identified" for dhl.com/careers.dhl.com

DHL's search runs on Phenom's `/widgets` refineSearch API instead:

  POST {origin}/widgets
    {ddoKey:"refineSearch", country:"global", lang:"en_global",
     selected_fields:{country:["Vietnam"]}, from:<n>, size:10}
  → {refineSearch:{totalHits, data:{jobs:[{title, cityState, jobId,
       descriptionTeaser, applyUrl, ...}]}}}

The server does NOT validate pageId/config (an empty pageId still returns the
full result set), so a static body is enough — no HTML pre-fetch. Detail page =
{origin}/global/en/job/{jobId}/{slug}; jobId keeps its "AV-"/"VN…" prefix and the
slug segment is cosmetic (verified: numeric-only id 410s, full id + any slug 200s).

The SAME /widgets endpoint also serves the detail: ddoKey="jobDetail" + jobId →
jobDetail.data.job.description = the whole posting (measured 2026-08-12:
2.6k chars vs the 200-char descriptionTeaser).
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_DETAIL_LOCALE = "global/en"
_MAX_JD_FETCH = 30  # bound per-job jobDetail calls (VN board is small)


def _jd_detail(origin: str, jid: str, headers: dict) -> str:
    """Full JD via /widgets ddoKey=jobDetail for one jobId ("" on any miss)."""
    body = {"lang": "en_global", "deviceType": "desktop", "country": "global",
            "pageName": "page-jobdetails", "ddoKey": "jobDetail", "jobId": jid,
            "pageId": "page-jobdetails", "siteType": "external"}
    try:
        r = requests.post(f"{origin}/widgets", json=body, headers=headers, timeout=_TIMEOUT)
        if r.status_code != 200:
            return ""
        job = ((((r.json() or {}).get("jobDetail") or {}).get("data") or {}).get("job") or {})
        return _full_desc(job.get("description"))
    except Exception as e:
        logger.info(f"[ats] dhl detail {jid} failed: {str(e)[:60]}")
        return ""


def _is_dhl(career_url: str) -> bool:
    host = (urlparse(career_url or "").netloc or "").lower()
    return host == "careers.dhl.com" or host.endswith(".careers.dhl.com")


def _slug(title: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", _norm_title(title)).strip("-")
    return s or "job"


def _dhl(career_url: str) -> list[dict]:
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"
    country = os.getenv("DISCOVER_COUNTRY", "Vietnam")
    ep = f"{origin}/widgets"
    headers = {**_JSON_POST, "Referer": f"{origin}/global/en/search-results"}
    out, seen = [], set()
    _PER = 10
    for start in range(0, _MAX_ATS_JOBS, _PER):
        body = {
            "lang": "en_global", "deviceType": "desktop", "country": "global",
            "pageName": "search-results", "ddoKey": "refineSearch", "sortBy": "",
            "subsearch": "", "from": start, "jobs": True, "counts": True,
            "all_fields": ["country"], "size": _PER, "clearAll": False,
            "jdsource": "facets", "isSliderEnable": False, "pageId": "",
            "siteType": "external", "keywords": "", "global": True,
            "selected_fields": {"country": [country]}, "locationData": {},
        }
        try:
            r = requests.post(ep, json=body, headers=headers, timeout=_TIMEOUT)
            if r.status_code != 200:
                break
            rs = (r.json() or {}).get("refineSearch") or {}
            jobs = (rs.get("data") or {}).get("jobs") or []
            total = int(rs.get("totalHits") or 0)
        except Exception as e:
            logger.info(f"[ats] dhl failed: {str(e)[:80]}")
            break
        if not jobs:
            break
        for j in jobs:
            title = (j.get("title") or "").strip()
            jid = (j.get("jobId") or "").strip()
            loc = j.get("cityState") or j.get("country") or ""
            if not title or not jid:
                continue
            # widgets already scopes to country=Vietnam; drop any leaked foreign row.
            if loc and not _is_vn_loc(loc):
                continue
            url = f"{origin}/{_DETAIL_LOCALE}/job/{jid}/{_slug(title)}"
            if url in seen:
                continue
            seen.add(url)
            # descriptionTeaser is never the full posting — pull the real JD
            # from the jobDetail widget (full-or-blank: a miss ships "").
            desc = _jd_detail(origin, jid, headers) if len(out) < _MAX_JD_FETCH else ""
            out.append({"title": title[:200], "url": url, "location": str(loc)[:120],
                        "description": desc})
        if start + _PER >= total or len(jobs) < _PER or len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] dhl → {len(out)} VN jobs ({origin})")
    return out


__all__ = ["_is_dhl", "_dhl"]
