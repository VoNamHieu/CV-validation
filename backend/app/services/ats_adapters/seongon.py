"""SEONGON (seongon.com) — WordPress `tuyen_dung` custom post type.

The careers listing is JS-rendered, so the generic scraper minted stale
/tuyen-dung/{slug} links that 404. The stable source is the WP REST collection
for the `tuyen_dung` post type (confirmed via /wp-json/wp/v2/types): each item
carries `title.rendered` + the canonical permalink in `link`. Hanoi agency → VN.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_API = "https://seongon.com/wp-json/wp/v2/tuyen_dung"


def _is_seongon(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "seongon.com"


def _seongon(career_url: str) -> list[dict]:
    hdr = {**_HTML_HEADERS, "Accept": "application/json"}
    out: list[dict] = []
    try:
        r = requests.get(f"{_API}?per_page=100&_fields=id,link,title,status", headers=hdr, timeout=_TIMEOUT)
        if r.status_code != 200:
            logger.info(f"[ats] seongon → HTTP {r.status_code}")
            return []
        items = r.json()
    except Exception as e:  # noqa: BLE001
        logger.info(f"[ats] seongon failed: {str(e)[:70]}")
        return []
    if not isinstance(items, list):
        return []
    for it in items:
        if it.get("status") not in (None, "publish"):
            continue
        t = it.get("title")
        title = _html.unescape((t.get("rendered") if isinstance(t, dict) else t) or "").strip()
        url = it.get("link") or ""
        if not title or not url:
            continue
        out.append({"title": title[:200], "url": url,
                    "external_id": str(it.get("id") or url),
                    "location": "Hà Nội", "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] seongon → {len(out)} jobs")
    return out


__all__ = ["_is_seongon", "_seongon"]
