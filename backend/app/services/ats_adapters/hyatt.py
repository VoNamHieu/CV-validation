"""Hyatt (careers.hyatt.com) — InFlight-wrapped Oracle Taleo (hyatt.taleo.net).

The branded careers.hyatt.com front is a Cloudflare/anti-bot Angular SPA (403 to
a headless browser, only a 4 KB shell to plain HTTP). But the underlying Taleo
careersection REST job board is open over plain HTTP — it just needs a session
cookie (GET the jobsearch page first) and a `tz` header (Taleo 500s "An Error
Occurred in TEE" without it). Filter to Vietnam with the LOCATION facet id
200001992 (Taleo's own OLF location node — the same id the front-end URL uses).

Response: `requisitionList[].column` = [title, property, job_field,
location_json, posting_date]; detail is jobdetail.ftl?job={jobId}. The full
`searchFilterSelections` (all 6 facet ids) must be present or Taleo 500s.
"""
from __future__ import annotations

import json as _json

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_CS = "https://hyatt.taleo.net/careersection"
_SEARCH = f"{_CS}/rest/jobboard/searchjobs?lang=en&portal=460210089"
_PAGE_URL = f"{_CS}/1/jobsearch.ftl?lang=en"
_VN_LOCATION = "200001992"
_FILTERS = ("ORGANIZATION", "POSTING_DATE", "LOCATION", "JOB_FIELD", "JOB_SCHEDULE", "JOB_LEVEL")
_ADV_FILTERS = ("ORGANIZATION", "LOCATION", "JOB_FIELD", "JOB_SCHEDULE", "JOB_LEVEL", "JOB_NUMBER")


def _is_hyatt(career_url: str) -> bool:
    host = (urlparse(career_url or "").netloc or "").lower().removeprefix("www.")
    return host in ("careers.hyatt.com", "hyatt.taleo.net")


def _sel(ids):
    return [{"id": i, "selectedValues": ([_VN_LOCATION] if i == "LOCATION" else [])} for i in ids]


def _body(page_no: int) -> dict:
    return {
        "multilineEnabled": False,
        "sortingSelection": {"sortBySelectionParam": "3", "ascendingSortingOrder": "false"},
        "fieldData": {"fields": {"LOCATION": "", "KEYWORD": ""}, "valid": True},
        "filterSelectionParam": {"searchFilterSelections": _sel(_FILTERS)},
        "advancedSearchFiltersSelectionParam": {"searchFilterSelections": _sel(_ADV_FILTERS)},
        "pageNo": page_no,
    }


def _loc(raw: str) -> str:
    # column location is a JSON array string like ["VN-65-Ho Chi Minh City"]
    try:
        arr = _json.loads(raw) if raw else []
    except Exception:
        arr = []
    cities = [str(x).split("-")[-1].strip() for x in arr if str(x).strip()]
    return ", ".join(dict.fromkeys(cities)) or "Vietnam"


def _hyatt(career_url: str) -> list[dict]:
    s = requests.Session()
    s.headers.update(_HTML_HEADERS)
    try:
        page = s.get(_PAGE_URL, timeout=_TIMEOUT)  # establish the careersection session
    except Exception as e:  # noqa: BLE001
        logger.info(f"[ats] hyatt session failed: {str(e)[:70]}")
        return []
    hdr = {"Content-Type": "application/json", "Accept": "application/json",
           "Referer": page.url, "tz": "GMT+07:00"}
    out: list[dict] = []
    for page_no in range(1, 9):  # 25/page; VN is ~21, cap well above
        try:
            r = s.post(_SEARCH, headers=hdr, json=_body(page_no), timeout=_TIMEOUT)
            if r.status_code != 200:
                break
            j = r.json()
        except Exception as e:  # noqa: BLE001
            logger.info(f"[ats] hyatt page {page_no} failed: {str(e)[:70]}")
            break
        rl = j.get("requisitionList") or []
        if not rl:
            break
        for it in rl:
            col = it.get("column") or []
            title = (col[0] if col else "").strip()
            jid = it.get("jobId")
            if not title or not jid:
                continue
            prop = (col[1].strip() if len(col) > 1 and col[1] else "")
            out.append({
                "title": (f"{title} — {prop}" if prop else title)[:200],
                "url": f"{_CS}/1/jobdetail.ftl?job={jid}&lang=en",
                "external_id": str(jid),
                "location": _loc(col[3] if len(col) > 3 else ""),
                "description": "",
            })
            if len(out) >= _MAX_ATS_JOBS:
                break
        total = (j.get("pagingData") or {}).get("totalCount") or 0
        if len(out) >= total or len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] hyatt → {len(out)} jobs")
    return out


__all__ = ["_is_hyatt", "_hyatt"]
