"""VietJet Air (careers.vietjetair.com) — an Angular SPA; jobs come from the iHRP
backend, found by rendering + sniffing the network:
  POST https://ihrp-api.vietjetair.com/CVT_VietJet/api/v1/job/search
  body {"DataHeader":[{"P1":"","P2":"","P3":"","P4":null,"P5":"","P6":"","P7":"",
        "P10":"","P11":""}],"LangID":"236"}   (236 = Vietnamese)
  → {"countItem":N,"dataItem":[{id, jobtitlename, workplacename, locationname, …}]}
Detail page = careers.vietjetair.com/jobvacancies/{id}. VN airline → all VN.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_EP = "https://ihrp-api.vietjetair.com/CVT_VietJet/api/v1/job/search"
_DETAIL = "https://careers.vietjetair.com/jobvacancies/"
_BODY = {"DataHeader": [{"P1": "", "P2": "", "P3": "", "P4": None, "P5": "",
                         "P6": "", "P7": "", "P10": "", "P11": ""}], "LangID": "236"}


def _is_vietjet(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() == "careers.vietjetair.com"


def _vietjet(career_url: str) -> list[dict]:
    try:
        r = requests.post(_EP, json=_BODY, timeout=_TIMEOUT, headers={
            **_JSON_POST, "Origin": "https://careers.vietjetair.com",
            "Referer": "https://careers.vietjetair.com/jobvacancies"})
        if r.status_code != 200:
            logger.info(f"[ats] vietjet → HTTP {r.status_code}")
            return []
        rows = (r.json() or {}).get("dataItem") or []
    except Exception as e:
        logger.info(f"[ats] vietjet failed: {str(e)[:80]}")
        return []

    out = []
    for j in rows:
        title = (j.get("jobtitlename") or j.get("carreername") or "").strip()
        jid = j.get("id")
        if not title or not jid:
            continue
        loc = (j.get("workplacename") or j.get("locationname") or "").strip()
        out.append({
            "title": title[:200],
            "url": f"{_DETAIL}{jid}",
            "location": loc[:120],
            "description": "",
        })
    logger.info(f"[ats] vietjet → {len(out)} jobs")
    return out


__all__ = ["_is_vietjet", "_vietjet"]
