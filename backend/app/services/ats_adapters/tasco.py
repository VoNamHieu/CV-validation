"""Tasco (tasco.com.vn) — WordPress site whose careers list is JS-rendered from
a WPGraphQL endpoint (the page HTML has no job links server-side). The feed is a
public GraphQL query over the "tuyen-dung" post category; detail pages live at
/career-detail/<slug>. ACF fields carry city/location.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_GQL = "https://dash.tasco.com.vn/graphql"
_SITE = "https://www.tasco.com.vn"
_QUERY = (
    'query($after: String) { posts(first: 50, after: $after, '
    'where: {categoryName: "tuyen-dung"}) { '
    'nodes { id title slug thongTinTuyenDungAcf { city location position } } '
    'pageInfo { hasNextPage endCursor } } }'
)


def _is_tasco(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "tasco.com.vn", "www.tasco.com.vn")


def _tasco(career_url: str) -> list[dict]:
    out, after = [], None
    for _ in range(5):  # cursor-paginated; 50/page, stops on hasNextPage=false
        try:
            r = requests.post(_GQL, timeout=_TIMEOUT, headers=_JSON_POST,
                              json={"query": _QUERY, "variables": {"after": after}})
            if r.status_code != 200:
                break
            posts = (((r.json() or {}).get("data") or {}).get("posts") or {})
        except Exception as e:
            logger.info(f"[ats] tasco failed: {str(e)[:80]}")
            break
        for n in posts.get("nodes", []) or []:
            title = (n.get("title") or "").strip()
            slug = (n.get("slug") or "").strip()
            if not title or not slug:
                continue
            acf = n.get("thongTinTuyenDungAcf") or {}
            out.append({
                "title": title[:200],
                "url": f"{_SITE}/career-detail/{slug}",
                "location": (acf.get("city") or acf.get("location") or "").strip(),
                "description": "",
            })
        info = posts.get("pageInfo") or {}
        if not info.get("hasNextPage") or len(out) >= _MAX_ATS_JOBS:
            break
        after = info.get("endCursor")
    logger.info(f"[ats] tasco → {len(out)} jobs")
    return out


__all__ = ["_is_tasco", "_tasco"]
