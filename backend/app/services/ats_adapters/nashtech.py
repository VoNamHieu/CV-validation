"""NashTech (careers.nashtechglobal.com) — WordPress + a custom `nt-careers-core`
plugin, so the job list loads client-side (server HTML has none) via a REST call
the minified JS builds at runtime: `POST /wp-json/ntc/job/get/v2`. An empty body
returns the site's full list; each item carries post_title / post_permalink and a
taxonomy[] whose `location` terms are the cities. This is NashTech's Vietnam
careers site, so every posting is VN-based (language-specific roles like "Data
Rater - Chinese" are HCM jobs).
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_EP = "https://careers.nashtechglobal.com/wp-json/ntc/job/get/v2"
_ORIGIN = "https://careers.nashtechglobal.com"


def _is_nashtech(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() == "careers.nashtechglobal.com"


def _nashtech(career_url: str) -> list[dict]:
    try:
        r = requests.post(_EP, json={}, timeout=_TIMEOUT,
                          headers={**_JSON_POST, "Referer": f"{_ORIGIN}/jobs-finder/"})
        if r.status_code != 200:
            logger.info(f"[ats] nashtech → HTTP {r.status_code}")
            return []
        items = r.json()
        if not isinstance(items, list):
            return []
    except Exception as e:
        logger.info(f"[ats] nashtech failed: {str(e)[:80]}")
        return []

    out = []
    for j in items:
        title = (j.get("post_title") or "").strip()
        url = (j.get("post_permalink") or "").strip()
        if not title or not url:
            continue
        locs = [t.get("name", "") for t in (j.get("taxonomy") or [])
                if t.get("taxonomy") == "location" and t.get("name")]
        # It's the VN site, but keep the guard: drop any non-VN-located row.
        if locs and not any(_is_vn_loc(l) for l in locs):
            continue
        out.append({
            "title": title[:200],
            "url": url,
            "location": ", ".join(locs)[:120],
            "description": "",
        })
    logger.info(f"[ats] nashtech → {len(out)} VN jobs")
    return out


__all__ = ["_is_nashtech", "_nashtech"]
