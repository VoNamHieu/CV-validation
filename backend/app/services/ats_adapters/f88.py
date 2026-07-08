"""F88 (vieclam.f88.vn) — SPA over a public JSON gateway. All calls POST to one
endpoint with a `path` router:
  api2.f88.vn/vieclam/base/post-api  {"path": "<endpoint>", "params": {...}}
    /pool/list                       → talent pools (departments)
    /opening/list {talent_pool_id}   → active openings in a pool
    /system/offices                  → dept_id → region name (location)
Jobs are spread across pools, so we walk every pool. Detail URL is
/tin-tuyen-dung/<slug>/<id>.
"""
from __future__ import annotations

import unicodedata

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_API = "https://api2.f88.vn/vieclam/base/post-api"
_SITE = "https://vieclam.f88.vn"


def _is_f88(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() == "vieclam.f88.vn"


def _slug(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("đ", "d").replace("Đ", "d").lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def _call(path: str, params: dict) -> dict:
    try:
        r = requests.post(_API, json={"path": path, "params": params},
                          headers=_JSON_POST, timeout=_TIMEOUT)
        if r.status_code // 100 == 2:
            return r.json() or {}
    except Exception as e:
        logger.info(f"[ats] f88 {path} failed: {str(e)[:80]}")
    return {}


def _f88(career_url: str) -> list[dict]:
    offices = {str(o.get("id")): o.get("name", "")
               for o in _call("/system/offices", {}).get("depts", []) if o.get("id")}
    pools = _call("/pool/list", {}).get("pools", []) or []
    out, seen = [], set()
    for p in pools:
        pid = p.get("id")
        if not pid:
            continue
        openings = _call("/opening/list", {
            "talent_pool_id": pid, "status": "active", "order_by": "since_desc"
        }).get("openings", []) or []
        for o in openings:
            oid, name = o.get("id"), (o.get("name") or "").strip()
            if not oid or not name or oid in seen:
                continue
            seen.add(oid)
            out.append({
                "title": name[:200],
                "url": f"{_SITE}/tin-tuyen-dung/{_slug(name)}/{oid}",
                "location": offices.get(str(o.get("dept_id")), ""),
                "description": _strip_html(o.get("content", "")),
                "salary": (o.get("salary") or "").strip(),
            })
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] f88 → {len(out)} jobs")
    return out


__all__ = ["_is_f88", "_f88"]
