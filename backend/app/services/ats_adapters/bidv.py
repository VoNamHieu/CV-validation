"""BIDV (tuyendung.bidv.com.vn) — SPA over a plain JSON list endpoint.

The careers site is JS-rendered (the generic scraper minted /job/{id} URLs that
404). Jobs come from GET /GetAllTinTuyenDung → {"rows":[{id, title,
dstenchinhanh (branch names), ...}]}. The real detail deep-link is
/tin-tuyen-dung/{id}/{slug}.html where {slug} is the accent-stripped, hyphenated
title (verified 200).
"""
from __future__ import annotations

import unicodedata

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_API = "https://tuyendung.bidv.com.vn/GetAllTinTuyenDung"
_BASE = "https://tuyendung.bidv.com.vn/tin-tuyen-dung"


def _is_bidv(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "tuyendung.bidv.com.vn"


def _slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s)).strip("-")


def _bidv(career_url: str) -> list[dict]:
    try:
        r = requests.get(_API, headers={**_HTML_HEADERS, "Accept": "application/json"}, timeout=_TIMEOUT)
        if r.status_code != 200:
            logger.info(f"[ats] bidv → HTTP {r.status_code}")
            return []
        rows = (r.json() or {}).get("rows") or []
    except Exception as e:  # noqa: BLE001
        logger.info(f"[ats] bidv failed: {str(e)[:70]}")
        return []
    out: list[dict] = []
    for it in rows:
        title = (it.get("title") or "").strip()
        jid = it.get("id")
        slug = _slug(title)
        if not title or not jid or not slug:
            continue
        branches = re.findall(r'"([^"]+)"', str(it.get("dstenchinhanh") or ""))
        loc = ", ".join(branches) or "Việt Nam"
        out.append({
            "title": title[:200],
            "url": f"{_BASE}/{jid}/{slug}.html",
            "external_id": str(jid),
            "location": loc[:120],
            "description": _full_desc(it.get("descriptionjob")),
        })
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] bidv → {len(out)} jobs")
    return out


__all__ = ["_is_bidv", "_bidv"]
