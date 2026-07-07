"""Biti's (tuyendung.bitis.com.vn) — JS SPA over a same-origin JSON API. Jobs
are split across a handful of `unit`s (Biti's business entities: factory, sales
HQ, …); each is paged independently via /api/job/paging. The JD ships inline in
the listing `description`, so no per-job detail fetch is needed.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_BASE = "https://tuyendung.bitis.com.vn"
_UNITS = (1, 2, 3, 4)          # business entities; empty ones return []
_PAGE_SIZE = 50


def _is_bitis(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() == "tuyendung.bitis.com.vn"


def _bitis(career_url: str) -> list[dict]:
    out = []
    for unit in _UNITS:
        for page in range(1, 6):
            try:
                d = _get_json(f"{_BASE}/api/job/paging?tabType=1&page={page}"
                              f"&pageSize={_PAGE_SIZE}&unit={unit}")
            except Exception:
                break
            rows = (d or {}).get("data") or []
            if not rows:
                break
            for j in rows:
                jid = j.get("id")
                title = (j.get("name") or "").strip()
                if not jid or not title:
                    continue
                deps = j.get("departments") or []
                loc = deps[0].get("name", "") if deps else ""
                if not loc:
                    # fall back to region-like tags in `kinds`
                    loc = next((k for k in (j.get("kinds") or []) if "Miền" in k or "HCM" in k), "")
                out.append({
                    "title": title[:200],
                    "url": f"{_BASE}/viec-lam/chi-tiet/{jid}",
                    "location": loc,
                    "description": _strip_html(j.get("description", "")),
                })
            if len(rows) < _PAGE_SIZE or len(out) >= _MAX_ATS_JOBS:
                break
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] bitis → {len(out)} jobs")
    return out


__all__ = ["_is_bitis", "_bitis"]
