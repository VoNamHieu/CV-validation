"""Vingroup group career portal (tuyendung.vingroup.net) — eHiring platform.

A shared portal for Vingroup subsidiaries (Vinpearl, VinFast, VinMec, …). Jobs
come from a clean HTTP JSON API — no JS gate, no auth:
    GET api-myvingroup.vingroup.net/prod/v1/app/ehiring/api/JobPosting/searchVGC
        ?countryCode=VN&PageIndex=N&PageSize=100[&OrgLv2Id=<subsidiary-code>]
→ a list of {id, title, locationNameVi, orgLv2Id, …} plus a `totalRecord`.

Two quirks this adapter absorbs:

1. **No per-job detail URL.** The portal opens each posting in a MODAL — every
   route (/job/<id>, /jobs?jobId=<id>, …) just renders the listing shell, so
   there is no real deep-link (the /job/<code> URLs the old spa_sniff produced
   were already dead shells landing on the listing). We mint a UNIQUE-but-listing
   URL `/jobs?companyCode=<org>&jobId=<id>` per posting: distinct enough to keep
   each job a separate store row (a shared URL would collapse 20 jobs into 1 via
   the (company_id, external_id) key), and it lands the user on the right
   subsidiary's listing.

2. **Subsidiary overlap.** career_url carries the subsidiary filter as
   ?companyCode=<OrgLv2Id> (Vinpearl = 45001013 → its own 20 postings). With no
   companyCode the UMBRELLA feed returns every subsidiary — but then drops the
   OrgLv2Ids that are separately featured (Vinpearl), so the "Vingroup" entry and
   the "Vinpearl" entry never double-list the same posting.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_HOST = "tuyendung.vingroup.net"
_API = "https://api-myvingroup.vingroup.net/prod/v1/app/ehiring/api/JobPosting/searchVGC"
_JOB_URL = "https://tuyendung.vingroup.net/jobs?companyCode={org}&jobId={jid}"
_API_HEADERS = {"User-Agent": _HEADERS["User-Agent"], "Accept": "application/json",
                "Origin": "https://tuyendung.vingroup.net",
                "Referer": "https://tuyendung.vingroup.net/"}

# OrgLv2Ids that have their OWN featured entry → excluded from the umbrella feed
# so the two never double-list the same posting. Keep in sync with career_urls
# that carry ?companyCode=<code> in featured_companies.py.
_FEATURED_SUBSIDIARIES = {"45001013"}  # Vinpearl


def _is_vingroup(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() == _HOST


def _find_items(o):
    """The searchVGC job list, wherever it sits in the response envelope."""
    if isinstance(o, list):
        return o if (o and isinstance(o[0], dict) and "title" in o[0]) else []
    if isinstance(o, dict):
        for v in o.values():
            r = _find_items(v)
            if r:
                return r
    return []


def _find_total(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k.lower() == "totalrecord" and isinstance(v, int):
                return v
            r = _find_total(v)
            if r is not None:
                return r
    return None


def _vingroup(career_url: str) -> list[dict]:
    q = dict(parse_qsl(urlparse(career_url).query))
    org = (q.get("companyCode") or q.get("OrgLv2Id") or "").strip()  # subsidiary filter

    out: list[dict] = []
    seen = 0
    for page in range(1, 21):  # 20 * 100 = hard bound; loop really ends at totalRecord
        params = {"countryCode": "VN", "PageIndex": page, "PageSize": 100}
        if org:
            params["OrgLv2Id"] = org
        try:
            r = requests.get(_API, params=params, headers=_API_HEADERS, timeout=_TIMEOUT)
            if r.status_code != 200:
                break
            d = r.json()
        except Exception as e:  # noqa: BLE001
            logger.info(f"[ats] vingroup page {page} failed: {str(e)[:80]}")
            break
        items = _find_items(d)
        if not items:
            break
        total = _find_total(d)
        for j in items:
            seen += 1
            jid = j.get("id")
            title = (j.get("title") or j.get("titleCustom") or "").strip()
            if jid is None or not title:
                continue
            oid = str(j.get("orgLv2Id") or "")
            if not org and oid in _FEATURED_SUBSIDIARIES:
                continue  # umbrella feed skips separately-featured subsidiaries
            loc = (j.get("locationNameVi") or j.get("locationNameEn") or "").strip()
            out.append({
                "title": title[:200],
                "url": _JOB_URL.format(org=oid, jid=jid),
                "location": loc[:120],
                "description": "",
            })
        if (total and seen >= total) or len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] vingroup → {len(out)} jobs (org={org or 'ALL'})")
    return out


__all__ = ["_is_vingroup", "_vingroup"]
