"""Vietcetera (vietcetera.com/careers) — a Next.js site with no separate ATS and
no public jobs API: the careers list is server-rendered into the page's
`__NEXT_DATA__` blob at `props.pageProps.jobList`. Each item carries
position/location/department/type + `uniqueSlug`; the detail page is
`/careers/{uniqueSlug}` (the plain `slug` 404s). VN-only publisher.
"""
from __future__ import annotations

import json

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_URL = "https://vietcetera.com/careers"
_NEXT_RX = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)


def _is_vietcetera(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "vietcetera.com"


def _vietcetera(career_url: str) -> list[dict]:
    try:
        r = requests.get(_URL, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            logger.info(f"[ats] vietcetera → HTTP {r.status_code}")
            return []
        m = _NEXT_RX.search(r.text)
        if not m:
            logger.info("[ats] vietcetera → no __NEXT_DATA__")
            return []
        job_list = (json.loads(m.group(1)).get("props", {})
                    .get("pageProps", {}).get("jobList") or [])
    except Exception as e:
        logger.info(f"[ats] vietcetera failed: {str(e)[:80]}")
        return []

    out = []
    for j in job_list:
        if (j.get("visibility") or "public").lower() != "public":
            continue
        title = (j.get("position") or "").strip()
        uslug = (j.get("uniqueSlug") or "").strip()
        if not title or not uslug:
            continue
        out.append({
            "title": title[:200],
            "url": f"https://vietcetera.com/careers/{uslug}",
            "location": (j.get("location") or "").strip()[:120],
            "description": _strip_html(j.get("description") or "")[:600],
            "category": (j.get("department") or "").strip(),
            "employment_type": (j.get("type") or "").strip(),
        })
    logger.info(f"[ats] vietcetera → {len(out)} jobs")
    return out


__all__ = ["_is_vietcetera", "_vietcetera"]
