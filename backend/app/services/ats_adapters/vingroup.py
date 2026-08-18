"""Vingroup group career portal (tuyendung.vingroup.net) — eHiring platform.

A shared portal for Vingroup subsidiaries (Vinpearl, VinFast, VinMec, …). Jobs
come from a clean HTTP JSON API — no JS gate, no auth:
    GET api-myvingroup.vingroup.net/prod/v1/app/ehiring/api/JobPosting/searchVGC
        ?countryCode=VN&PageIndex=N&PageSize=100[&OrgLv2Id=<subsidiary-code>]
→ a list of {id, title, locationNameVi, orgLv2Id, …} plus a `totalRecord`.

Detail deep-link is /jobs/{id} — the numeric job id is globally unique across
subsidiaries, so it needs no companyCode. The portal is a SPA (the route renders
a shell to plain HTTP), but /jobs/{id} is the real link the site itself uses.

Consolidated: all subsidiaries (Vinpearl, VinFast, VinMec, …) list under the
single "Vingroup" featured entry (career_url = tuyendung.vingroup.net/jobs, no
companyCode → the umbrella feed returns every subsidiary). career_url may still
carry ?companyCode=<OrgLv2Id> to scope to one subsidiary if ever needed.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_HOST = "tuyendung.vingroup.net"
# 2026-08: the eHiring backend moved hosts — the old api-myvingroup gateway
# 504s (even from inside a rendered page); the SPA now calls
# ehiring-api.vinsmartfuture.tech with the SAME searchVGC/detailVGC shapes.
# While the old host was down, the SPA-sniff fallback ingested 85 fake rows
# keyed on orgLv2Id (8-digit) at /job/{id} — a route that renders the LIST.
_API = "https://ehiring-api.vinsmartfuture.tech/api/JobPosting/searchVGC"
# Per-job deep-link is /jobs/{id} (the numeric job id is globally unique across
# subsidiaries). The portal is a SPA so the route renders a shell to plain HTTP,
# but it's the real deep-link the site itself uses.
_JOB_URL = "https://tuyendung.vingroup.net/jobs/{jid}"
_DETAIL_API = "https://ehiring-api.vinsmartfuture.tech/api/JobPosting/detailVGC"
_API_HEADERS = {"User-Agent": _HEADERS["User-Agent"], "Accept": "application/json",
                "Origin": "https://tuyendung.vingroup.net",
                "Referer": "https://tuyendung.vingroup.net/"}
_MAX_JD_FETCH = 120  # bound per-job detailVGC calls (fast JSON, ~150ms each)


def _jd_detail(jid) -> str:
    """Full JD via detailVGC (found in the SPA bundle next to searchVGC):
    data.jobDescription + jobRequirement + jobBenefit ("" on any miss)."""
    try:
        r = requests.get(_DETAIL_API, params={"id": jid}, headers=_API_HEADERS,
                         timeout=_TIMEOUT)
        if r.status_code != 200:
            return ""
        d = (r.json() or {}).get("data") or {}
    except Exception as e:  # noqa: BLE001
        logger.info(f"[ats] vingroup detail {jid} failed: {str(e)[:60]}")
        return ""
    parts = [d.get("jobDescription"), d.get("jobRequirement"), d.get("jobBenefit")]
    return _full_desc("\n".join(p for p in parts if p))

# Consolidated: every subsidiary on the portal lists under the single "Vingroup"
# entry — no subsidiary is carved out separately, so the umbrella feed keeps all
# of them. (Kept as a hook in case a subsidiary needs splitting out again.)
_FEATURED_SUBSIDIARIES: set[str] = set()


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
                "url": _JOB_URL.format(jid=jid),
                "external_id": str(jid),
                "location": loc[:120],
                "description": _jd_detail(jid) if len(out) < _MAX_JD_FETCH else "",
            })
        if (total and seen >= total) or len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] vingroup → {len(out)} jobs (org={org or 'ALL'})")
    return out


__all__ = ["_is_vingroup", "_vingroup"]
