"""VNG (career.vng.com.vn) — a Next.js SSR careers site with no client-side job
API: the listing is embedded in `__NEXT_DATA__` (props.pageProps.jobs) and
paginated with `?page=N`. Every job object already carries its full HTML
description, so we parse the embedded JSON per page — no per-job fetch.
"""
from __future__ import annotations

import json

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_LIST = "https://career.vng.com.vn/vi/tim-kiem-viec-lam"
_DETAIL = "https://career.vng.com.vn/vi/co-hoi-nghe-nghiep"  # /{slug}
_NEXT_RX = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def _is_vng(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() == "career.vng.com.vn"


def _page_props(page: int) -> dict | None:
    try:
        r = requests.get(f"{_LIST}?page={page}", headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return None
        m = _NEXT_RX.search(r.text)
        if not m:
            return None
        return json.loads(m.group(1)).get("props", {}).get("pageProps", {})
    except Exception as e:
        logger.info(f"[ats] vng page {page} failed: {str(e)[:80]}")
        return None


def _vng(career_url: str) -> list[dict]:
    out = []
    first = _page_props(1)
    if not first:
        return []
    pages = int(first.get("pages") or 1)
    for page in range(1, pages + 1):
        pp = first if page == 1 else _page_props(page)
        jobs = (pp or {}).get("jobs") or []
        if not jobs:
            break
        for j in jobs:
            slug = j.get("slug")
            title = (j.get("title") or "").strip()
            if not slug or not title:
                continue
            out.append({
                "title": title,
                "url": f"{_DETAIL}/{slug}",
                "location": j.get("location", "") or "",
                "description": _strip_html(j.get("description") or j.get("summary") or ""),
                "category": j.get("job_family", "") or "",
                "employment_type": j.get("workingType", "") or "",
            })
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] vng → {len(out)} jobs")
    return out


__all__ = ["_is_vng", "_vng"]
