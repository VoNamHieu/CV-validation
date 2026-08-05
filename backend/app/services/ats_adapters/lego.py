"""LEGO (lego.wd103.myworkdayjobs.com / site `LEGO_External`) — a global
Workday tenant whose Vietnam board is the LEGO Manufacturing Vietnam factory in
Tân Uyên, Bình Dương.

Why this can't ride the generic `_workday` adapter: this tenant's cxs LIST
response omits `locationsText` entirely (every other Workday tenant we ingest
returns it). `_workday` keeps a posting only when `_is_vn_loc(locationsText)`
passes, so LEGO collapses to **0 jobs** — the board looks empty, not broken.
Location here lives in `bulletFields[0]` ("Tan Uyen, Binh Duong") instead.

So we narrow server-side by the location FACET rather than `_workday`'s
`searchText: "Vietnam"` — exact instead of a title/JD word match — and read the
location out of `bulletFields`. The facet value is Workday's global Vietnam
country id, the same GUID already pinned in several career URLs (Visa, DBS,
Marvell, Air Liquide); only the facet *parameter* name is per-tenant, and LEGO
calls it `Location` where others use `Location_Country`/`Country`.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_TENANT = "lego"
_WD = "wd103"
_SITE = "LEGO_External"
_BASE = f"https://{_TENANT}.{_WD}.myworkdayjobs.com"
_CXS = f"{_BASE}/wday/cxs/{_TENANT}/{_SITE}"

_VN_COUNTRY_ID = "db69e8c8446c11de98360015c5e6daf6"  # Workday's global Vietnam id
_FACET_PARAM = "Location"       # this tenant's country facet (see module docstring)
_PAGE = 20                      # cxs 400s above limit=20
_JD_LIMIT = 30                  # covers the whole VN board (~23) with a hard bound


def _is_lego(career_url: str) -> bool:
    p = urlparse(career_url or "")
    if (p.netloc or "").lower() != f"{_TENANT}.{_WD}.myworkdayjobs.com":
        return False
    # Bare tenant root, or the LEGO_External site — matched case-insensitively and
    # anywhere in the path so locale prefixes (/en-US/LEGO_External) and per-job
    # URLs (/LEGO_External/job/…, used by the JD resolver) both hit.
    path = (p.path or "").lower()
    return not path.strip("/") or _SITE.lower() in path


def _discover_facet_param() -> str | None:
    """The tenant's country-facet parameter name, read off its own facet list.

    Only used when the pinned `_FACET_PARAM` stops matching — Workday lets each
    tenant name this facet itself, so a rename would otherwise silently zero the
    board.
    """
    try:
        r = requests.post(f"{_CXS}/jobs", headers=_JSON_POST, timeout=_TIMEOUT,
                          json={"limit": 1, "offset": 0, "searchText": "", "appliedFacets": {}})
        if r.status_code != 200:
            return None
        for facet in (r.json() or {}).get("facets", []) or []:
            for v in facet.get("values", []) or []:
                if v.get("id") == _VN_COUNTRY_ID:
                    return facet.get("facetParameter")
    except Exception as e:
        logger.info(f"[ats] lego facet discovery failed: {str(e)[:80]}")
    return None


def _page(param: str, offset: int) -> list[dict]:
    r = requests.post(f"{_CXS}/jobs", headers=_JSON_POST, timeout=_TIMEOUT,
                      json={"limit": _PAGE, "offset": offset, "searchText": "",
                            "appliedFacets": {param: [_VN_COUNTRY_ID]}})
    if r.status_code != 200:
        logger.info(f"[ats] lego offset {offset} → HTTP {r.status_code}")
        return []
    return (r.json() or {}).get("jobPostings", []) or []


def _list_loc(posting: dict, ext: str) -> str:
    """Location for a list row. This tenant sends no `locationsText`; bulletFields
    is [location, jobReqId]. Fall back to the city slug Workday puts in the path
    ("/job/Tan-Uyen-Binh-Duong/…") if even that is missing."""
    bullets = posting.get("bulletFields") or []
    if bullets and str(bullets[0]).strip():
        return str(bullets[0]).strip()
    segs = [s for s in (ext or "").split("/") if s]
    return segs[1].replace("-", " ") if len(segs) > 1 else ""


def _lego(career_url: str) -> list[dict]:
    param = _FACET_PARAM
    out: list[dict] = []
    for offset in range(0, _MAX_ATS_JOBS, _PAGE):
        try:
            postings = _page(param, offset)
        except Exception as e:
            logger.info(f"[ats] lego offset {offset} failed: {str(e)[:80]}")
            break
        if not postings and offset == 0 and param == _FACET_PARAM:
            # Facet renamed (or dropped) upstream — re-read it from the tenant and
            # retry once, rather than reporting an empty board.
            found = _discover_facet_param()
            if found and found != param:
                logger.info(f"[ats] lego facet {param!r} → {found!r}")
                param = found
                try:
                    postings = _page(param, offset)
                except Exception:
                    postings = []
        if not postings:
            break
        for j in postings:
            ext = j.get("externalPath", "") or ""
            out.append({
                "title": j.get("title", "") or "",
                # externalPath is relative to the SITE ("/job/…"); the public URL
                # needs the site segment, else Workday 404s.
                "url": f"{_BASE}/{_SITE}{ext}" if ext else f"{_BASE}/{_SITE}",
                "location": _list_loc(j, ext),
                "description": "",
                "_ext": ext,
            })
        # `total` is unreliable here (it comes back 0 on later pages), so page
        # until a short page arrives.
        if len(postings) < _PAGE or len(out) >= _MAX_ATS_JOBS:
            break

    # Enrich from the cxs detail endpoint: the full JD, and — for multi-country
    # postings — the VN location. A req based abroad but also open in Vietnam
    # (e.g. a Shanghai role with Tân Uyên in `additionalLocations`) legitimately
    # matches the facet, but must not be stored under its foreign primary city.
    kept = []
    for job in out[:_JD_LIMIT]:
        ext = job.pop("_ext", "")
        vn_loc = _is_vn_loc(job["location"])
        info = {}
        if ext:
            try:
                dr = requests.get(f"{_CXS}{ext}", headers=_JSON_POST, timeout=_TIMEOUT)
                if dr.status_code == 200:
                    info = (dr.json() or {}).get("jobPostingInfo", {}) or {}
            except Exception as e:
                logger.info(f"[ats] lego detail {ext} failed: {str(e)[:80]}")
        job["description"] = _strip_html(info.get("jobDescription", ""))
        if not vn_loc:
            alt = next((c for c in ([info.get("location")] + (info.get("additionalLocations") or []))
                        if c and _is_vn_loc(str(c))), None)
            if not alt:
                # No VN location on the posting at all → the facet matched for a
                # reason we can't confirm; drop it rather than store a foreign job.
                logger.info(f"[ats] lego dropped non-VN posting: {job['title'][:60]}")
                continue
            job["location"] = str(alt)
        kept.append(job)
    for job in out[_JD_LIMIT:]:
        job.pop("_ext", None)
        if _is_vn_loc(job["location"]):
            kept.append(job)

    logger.info(f"[ats] lego → {len(kept)} VN jobs")
    return kept


__all__ = ["_is_lego", "_lego"]
