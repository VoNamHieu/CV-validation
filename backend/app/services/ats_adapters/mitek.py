"""MiTek Vietnam (mii.wd5.myworkdayjobs.com / site `MiTekVietnam`) — a
Vietnam-dedicated Workday tenant.

The generic `_workday` adapter narrows any tenant server-side with
`searchText: "Vietnam"` because most Workday tenants are global and would
otherwise flood the store with foreign jobs. But this tenant is *entirely* VN
(every posting is in Hồ Chí Minh) and job titles rarely contain the literal
word "Vietnam" — so that filter collapses ~44 real jobs down to ~12. Here we
take the whole board instead: same public `cxs` JSON API, no searchText, no
per-location filter (they are all VN by construction).
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_TENANT = "mii"
_WD = "wd5"
_SITE = "MiTekVietnam"
_BASE = f"https://{_TENANT}.{_WD}.myworkdayjobs.com"
_CXS = f"{_BASE}/wday/cxs/{_TENANT}/{_SITE}"
_JD_LIMIT = 15  # bounded per-job detail fetches


def _is_mitek(career_url: str) -> bool:
    p = urlparse(career_url or "")
    host = (p.netloc or "").lower()
    if host != f"{_TENANT}.{_WD}.myworkdayjobs.com":
        return False
    # Bare tenant root or the MiTekVietnam site (case-insensitive path match);
    # ignore locale segments Workday sometimes prefixes (e.g. /en-US/MiTekVietnam).
    path = (p.path or "").lower()
    return not path.strip("/") or _SITE.lower() in path


def _mitek(career_url: str) -> list[dict]:
    out = []
    # cxs caps limit at 20 (HTTP 400 above that); paginate by offset. Stop when a
    # short page comes back or we hit the shared per-company cap.
    for offset in range(0, 200, 20):
        try:
            r = requests.post(f"{_CXS}/jobs", headers=_JSON_POST, timeout=_TIMEOUT,
                              json={"limit": 20, "offset": offset, "appliedFacets": {}})
            if r.status_code != 200:
                break
            postings = (r.json() or {}).get("jobPostings", []) or []
            if not postings:
                break
            for j in postings:
                ext = j.get("externalPath", "") or ""
                out.append({
                    "title": j.get("title", ""),
                    # externalPath is relative to the SITE ("/job/…"); the public
                    # URL needs the site segment, else Workday 404s.
                    "url": f"{_BASE}/{_SITE}{ext}" if ext else f"{_BASE}/{_SITE}",
                    "location": j.get("locationsText", "") or "",
                    "description": "",
                    "_ext": ext,
                })
            if len(postings) < 20 or len(out) >= _MAX_ATS_JOBS:
                break
        except Exception as e:
            logger.info(f"[ats] mitek offset {offset} failed: {str(e)[:80]}")
            break

    # Enrich the first N with their full JD from the cxs detail endpoint.
    for job in out[:_JD_LIMIT]:
        ext = job.pop("_ext", "")
        if not ext:
            continue
        try:
            dr = requests.get(f"{_CXS}{ext}", headers=_JSON_POST, timeout=_TIMEOUT)
            if dr.status_code == 200:
                info = (dr.json() or {}).get("jobPostingInfo", {})
                job["description"] = _strip_html(info.get("jobDescription", ""))
        except Exception:
            pass
    for job in out:
        job.pop("_ext", None)
    logger.info(f"[ats] mitek → {len(out)} jobs")
    return out


__all__ = ["_is_mitek", "_mitek"]
