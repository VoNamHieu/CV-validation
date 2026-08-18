"""Mondelez (mondelezinternational.com/careers) — the careers page embeds Phenom's
`frontline` job-search widget (loaded from cdn-bot.phenompeople.com), which
queries the Phenom `/widgets` refineSearch API on the tenant host
`virtualhiringassistant.mondelezinternational.com` (same request/response shape as
DHL). Each job's `applyUrl` is the canonical Workday job page on the
custom-tenant host (wd3.myworkdaysite.com/recruiting/mdlz/External/job/…) —
the Phenom detail URL 404s here, so we use applyUrl directly, and the same
path under /wday/cxs/{tenant}/{site}/ is Workday's public CXS REST serving
the FULL JD (jobPostingInfo.jobDescription). VN via country=Vietnam.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_WIDGETS = "https://virtualhiringassistant.mondelezinternational.com/widgets"

_CXS_RX = re.compile(
    r"^https://(wd\d+)\.myworkdaysite\.com/recruiting/([^/]+)/([^/]+)/(job/[^?#]+)", re.I)
_MAX_JD_FETCH = 30  # bound per-job CXS calls (VN board is small; odoo precedent)


def _cxs_jd(apply_url: str) -> str:
    """Full JD via Workday CXS for a custom-tenant (myworkdaysite.com) job URL."""
    m = _CXS_RX.match(apply_url or "")
    if not m:
        return ""
    pod, tenant, site, jobpath = m.groups()
    d = _get_json(f"https://{pod}.myworkdaysite.com/wday/cxs/{tenant}/{site}/{jobpath}")
    return _full_desc(((d or {}).get("jobPostingInfo") or {}).get("jobDescription"))


def _is_mondelez(career_url: str) -> bool:
    p = urlparse(career_url or "")
    host = (p.netloc or "").lower()
    return host.endswith("mondelezinternational.com") and "career" in (p.path or "").lower()


def _mondelez(career_url: str) -> list[dict]:
    country = os.getenv("DISCOVER_COUNTRY", "Vietnam")
    headers = {**_JSON_POST, "Referer": "https://www.mondelezinternational.com/careers/jobs/"}
    out, seen = [], set()
    _PER = 10
    for start in range(0, _MAX_ATS_JOBS, _PER):
        body = {
            "lang": "en_global", "deviceType": "desktop", "country": "global",
            "pageName": "search-results", "ddoKey": "refineSearch", "from": start,
            "jobs": True, "counts": True, "all_fields": ["country"], "size": _PER,
            "clearAll": False, "jdsource": "facets", "pageId": "", "siteType": "external",
            "keywords": "", "global": True,
            "selected_fields": {"country": [country]}, "locationData": {},
        }
        try:
            r = requests.post(_WIDGETS, json=body, headers=headers, timeout=_TIMEOUT)
            if r.status_code != 200:
                break
            rs = (r.json() or {}).get("refineSearch") or {}
            jobs = (rs.get("data") or {}).get("jobs") or []
            total = int(rs.get("totalHits") or 0)
        except Exception as e:
            logger.info(f"[ats] mondelez failed: {str(e)[:80]}")
            break
        if not jobs:
            break
        for j in jobs:
            title = (j.get("title") or "").strip()
            url = (j.get("applyUrl") or "").strip()          # Phenom detail 404s → use the (Workday) apply URL
            loc = j.get("cityState") or j.get("country") or ""
            if not title or not url:
                continue
            if loc and not _is_vn_loc(loc):
                continue
            if url in seen:
                continue
            seen.add(url)
            # descriptionTeaser is never the full posting — pull the real JD
            # from the Workday CXS mirror of applyUrl (full-or-blank: a CXS
            # miss ships "" and resolves on-demand later).
            desc = _cxs_jd(url) if len(out) < _MAX_JD_FETCH else ""
            out.append({"title": title[:200], "url": url, "location": str(loc)[:120],
                        "description": desc})
        if start + _PER >= total or len(jobs) < _PER or len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] mondelez → {len(out)} VN jobs")
    return out


__all__ = ["_is_mondelez", "_mondelez"]
