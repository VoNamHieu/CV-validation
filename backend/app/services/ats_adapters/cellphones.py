"""CellphoneS (tuyendung.cellphones.com.vn) — plain JSON API, no anti-bot.

The career site is an SPA (every path 200s with the same shell, so its own
static HTML can't be scraped), but the API it calls itself is public and
directly callable:
    GET /api/job/paging?tabType=1&page=&pageSize=  → {"data":[...], "totalCount"}
Each item already carries the full JD (`description`, HTML). Omitting the
`unit` param returns every unit's jobs (verified: unit=1 + unit=2 counts sum
to the no-unit total; unit=3/4 are currently empty).

Detail URL is /ung-tuyen-viec-lam/{unit}/{slug}-{id} — confirmed (via a
captured real detail page + a same-id/wrong-slug probe) that only `unit` and
the trailing `{id}` are load-bearing; the slug is cosmetic (SSR'd from the
id regardless of what text precedes it), so we synthesize it by slugifying
the title rather than needing to reverse-engineer their exact slug function.
"""
from __future__ import annotations

import re
import unicodedata

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_API = "https://tuyendung.cellphones.com.vn/api/job/paging"
_DETAIL_BASE = "https://tuyendung.cellphones.com.vn/ung-tuyen-viec-lam"


def _is_cellphones(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "tuyendung.cellphones.com.vn", "www.tuyendung.cellphones.com.vn")


def _slugify(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("đ", "d").replace("Đ", "D").lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def _cellphones(career_url: str) -> list[dict]:
    out = []
    for page in range(1, 5):
        try:
            r = requests.get(_API, headers=_JSON_POST, timeout=_TIMEOUT,
                             params={"tabType": 1, "page": page, "pageSize": 50})
            if r.status_code != 200:
                break
            body = r.json() or {}
            items = body.get("data") or []
            if not items:
                break
            for it in items:
                title = (it.get("name") or "").strip()
                jid = it.get("id")
                unit = it.get("unit")
                if not title or not jid or unit is None:
                    continue
                slug = _slugify(title) or "viec-lam"
                locs = it.get("locations") or []
                location = ", ".join(l.get("name", "") for l in locs if l.get("name"))
                out.append({
                    "title": title[:200],
                    "url": f"{_DETAIL_BASE}/{unit}/{slug}-{jid}",
                    "location": location,
                    "description": _strip_html(it.get("description", "")),
                })
            if len(items) < 50 or len(out) >= body.get("totalCount", 0):
                break
        except Exception as e:
            logger.info(f"[ats] cellphones page {page} failed: {str(e)[:80]}")
            break
    logger.info(f"[ats] cellphones → {len(out)} jobs")
    return out


__all__ = ["_is_cellphones", "_cellphones"]
