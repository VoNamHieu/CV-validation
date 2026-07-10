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


def _slug(s: str) -> str:
    """VN-safe slug for the detail URL. The SPA only reads the trailing id, so the
    slug is cosmetic — but keeping one makes the URL match the real site."""
    import unicodedata
    s = (s or "").replace("đ", "d").replace("Đ", "D")
    s = "".join(c for c in unicodedata.normalize("NFD", s)
                if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:80] or "viec-lam"


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
                    # Detail route is /chi-tiet-viec-lam/<unit>/<slug>-<id> (the SPA
                    # keys off the trailing id). The old /viec-lam/chi-tiet/<id>
                    # rendered the SPA's error page ("Có lỗi xảy ra").
                    "url": f"{_BASE}/chi-tiet-viec-lam/{j.get('unit', unit)}/{_slug(title)}-{jid}",
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
