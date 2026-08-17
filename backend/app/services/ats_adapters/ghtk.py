"""GHTK (ghtk.vn/tuyen-dung) — Next.js SPA over a public portal API.

The category pages carry no jobs server-side (NEXT_DATA is i18n only); the
list loads from
    POST portal-api.ghtk.vn/api/v2/posts/recruitment?page=N
    body {"textSearch":"","aliasSearches":[{"name":"block","values":[]},
          {"name":"rank","values":[]},{"name":"workplace","values":[]}], ...}
→ {data:[{id, title, slug, workplaceAlias:[{name}], blockAlias:[{alias}]}]}

Detail = ghtk.vn/tuyen-dung/{blockAlias}/{slug}/ (SSR — renders the full JD).
Before this adapter the sniff stored the six CATEGORY pages as "jobs".
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_GHTK_API = "https://portal-api.ghtk.vn/api/v2/posts/recruitment"
_GHTK_BODY = {
    "textSearch": "",
    "aliasSearches": [{"name": "block", "values": []},
                      {"name": "rank", "values": []},
                      {"name": "workplace", "values": []}],
    "aliasFilters": [{"name": "block", "values": []},
                     {"name": "rank", "values": []},
                     {"name": "workplace", "values": []}],
}


def _is_ghtk(career_url: str) -> bool:
    host = (urlparse(career_url or "").netloc or "").lower().removeprefix("www.")
    return host == "ghtk.vn"


def _ghtk(career_url: str) -> list[dict]:
    out, seen = [], set()
    try:
        for page in range(0, 10):
            r = requests.post(_GHTK_API, params={"page": page}, json=_GHTK_BODY,
                              headers={**_JSON_POST, "Origin": "https://ghtk.vn",
                                       "Referer": "https://ghtk.vn/tuyen-dung/"},
                              timeout=_TIMEOUT)
            if r.status_code != 200:
                break
            rows = (r.json() or {}).get("data") or []
            if not rows:
                break
            for it in rows:
                title = (it.get("title") or "").strip()
                slug = (it.get("slug") or "").strip()
                jid = it.get("id")
                block = next((b.get("alias") for b in (it.get("blockAlias") or [])
                              if isinstance(b, dict) and b.get("alias")), "")
                if not title or not slug or not jid or jid in seen:
                    continue
                seen.add(jid)
                loc = ", ".join(w.get("name") for w in (it.get("workplaceAlias") or [])
                                if isinstance(w, dict) and w.get("name"))
                path = f"{block}/{slug}" if block else slug
                out.append({"title": title[:200],
                            "url": f"https://ghtk.vn/tuyen-dung/{path}/",
                            "external_id": str(jid),
                            "location": loc[:120], "description": ""})
            if len(out) >= _MAX_ATS_JOBS:
                break
    except Exception as e:
        logger.info(f"[ats] ghtk failed: {str(e)[:80]}")
    logger.info(f"[ats] ghtk → {len(out)} jobs")
    return out


__all__ = ["_is_ghtk", "_ghtk"]
