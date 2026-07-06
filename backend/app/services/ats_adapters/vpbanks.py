"""VPBank Securities (vpbanks.com.vn) — headless CMS API, post_type=tuyen-dung.

Split into its own file (not vn.py) since it needed a real fix, not just a
drive-by addition: the site is a Next.js app whose "career" page
(/co-hoi-nghe-nghiep) renders 0 jobs server-side (client fetches them after
hydration), so a plain GET sees nothing. But the client fetch itself is a
public, unauthenticated JSON API with no anti-bot gate — callable directly,
no render/capture needed:
  GET /api/v1/front/post-type-content?post_type=tuyen-dung&locale=vi&page=&limit=
  → {"data": [{title, slug, long_description, session_tags: {
       session_tags_work_location: [{title}], ...}}], "meta": {total, last_page}}

Job detail lives at /tuyen-dung/{slug} — NOT /co-hoi-nghe-nghiep/{slug} (that
404s; verified directly, the CMS content section and the URL route are
different paths on this site).
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_API = "https://www.vpbanks.com.vn/api/v1/front/post-type-content"


def _is_vpbanks(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "www.vpbanks.com.vn", "vpbanks.com.vn")


def _vpbanks(career_url: str) -> list[dict]:
    out = []
    for page in range(1, 4):
        try:
            r = requests.get(_API, headers=_JSON_POST, timeout=_TIMEOUT,
                             params={"page": page, "limit": 50, "post_type": "tuyen-dung", "locale": "vi"})
            if r.status_code != 200:
                break
            data = (r.json() or {}).get("data", []) or []
            if not data:
                break
            for it in data:
                title = (it.get("title") or "").strip()
                slug = it.get("slug")
                if not title or not slug:
                    continue
                locs = (it.get("session_tags", {}) or {}).get("session_tags_work_location", []) or []
                location = ", ".join(l.get("title", "") for l in locs if l.get("title")) or "Vietnam"
                out.append({"title": title[:200],
                            "url": f"https://www.vpbanks.com.vn/tuyen-dung/{slug}",
                            "location": location,
                            "description": _strip_html(it.get("long_description", ""))})
            if len(data) < 50 or len(out) >= 100:
                break
        except Exception as e:
            logger.info(f"[ats] vpbanks page {page} failed: {str(e)[:80]}")
            break
    logger.info(f"[ats] vpbanks → {len(out)} jobs")
    return out


__all__ = ["_is_vpbanks", "_vpbanks"]
