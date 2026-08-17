"""Viettel Software (career.viettelsoftware.com) — public recruitment API.

The SPA lists jobs from
    POST api-recruitment.viettelsoftware.com/api/v1/recruitment/job-ad/
         search-custom?page=N&size=50   (body: {} — a plain GET system.errors)
→ {data:{content:[{id, code, title, positionName, locationName, dueDate,
                   uid, …}]}}

Detail route is /jobDetail/{uid} — the UUID, NOT the numeric id: the site's
card click navigates there (verified live). The /job/{id} URLs the generic
sniff once stored 404, and /jobDetail/{numeric-id} renders "Job not found".
dueDate is an epoch-ms deadline and expired ads stay in the API, so filter.
JD stays empty on purpose (clean-API pattern — the detail page carries it).
"""
from __future__ import annotations

import datetime as _dt

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_VTSW_API = ("https://api-recruitment.viettelsoftware.com/"
             "api/v1/recruitment/job-ad/search-custom")
_VTSW_DETAIL = "https://career.viettelsoftware.com/jobDetail/{uid}"


def _is_viettelsw(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() == "career.viettelsoftware.com"


def _viettelsw(career_url: str) -> list[dict]:
    out, seen = [], set()
    now_ms = int(_dt.datetime.now(_dt.timezone.utc).timestamp() * 1000)
    try:
        for page in range(1, 9):
            r = requests.post(_VTSW_API, params={"page": page, "size": 50},
                              json={}, headers=_JSON_POST, timeout=_TIMEOUT)
            if r.status_code != 200:
                break
            data = ((r.json() or {}).get("data") or {})
            content = data.get("content") or []
            if not content:
                break
            for it in content:
                title = (it.get("title") or it.get("code") or "").strip()
                uid = (it.get("uid") or "").strip()
                if not title or not uid or uid in seen:
                    continue
                due = it.get("dueDate")
                if isinstance(due, (int, float)) and due < now_ms:
                    continue
                seen.add(uid)
                out.append({"title": title[:200],
                            "url": _VTSW_DETAIL.format(uid=uid),
                            "external_id": uid,
                            "location": str(it.get("locationName") or "")[:120],
                            "description": ""})
            if len(content) < 50 or len(out) >= _MAX_ATS_JOBS:
                break
    except Exception as e:
        logger.info(f"[ats] viettelsw failed: {str(e)[:80]}")
    logger.info(f"[ats] viettelsw → {len(out)} jobs")
    return out


__all__ = ["_is_viettelsw", "_viettelsw"]
