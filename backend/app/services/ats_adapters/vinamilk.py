"""Vinamilk (vinamilk.com.vn) — careers are a Strapi 5 SPA: the listing renders
client-side, so a headless GET sees zero jobs. The page's own `GetHrJobs` query
POSTs to open-p04-vn.vinamilk.com.vn/api/vnm-strapi5-graphql/ and returns
`hrJobDetails_connection` (title, slug, workspaces=location, levels). We replay
that query server-side (no auth/CSRF) → every opening without a render.

VN gate: workspaces are city names ("Ho Chi Minh", "Ha Noi", …) plus the
nationwide "Toàn Quốc"; Cambodia ("Campuchia") is the only non-VN one, so a job
is dropped only when NONE of its workspaces is VN/nationwide.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_GQL = "https://open-p04-vn.vinamilk.com.vn/api/vnm-strapi5-graphql/"
_DETAIL = "https://www.vinamilk.com.vn/vi/recruitment/career-opportunities/"
_QUERY = (
    "query GetHrJobs($pagination: PaginationArg, $status: PublicationStatus, "
    "$locale: I18NLocaleCode) { hrJobDetails_connection(pagination: $pagination, "
    "status: $status, locale: $locale) { pageInfo { total } nodes { name slug "
    "workspaces { name } levels { name } } } }"
)


def _is_vinamilk(career_url: str) -> bool:
    host = (urlparse(career_url or "").netloc or "").lower().removeprefix("www.")
    # vinamilk.com.vn also serves the e-shop — require the recruitment path so we
    # only claim the careers URL, not the storefront.
    return host == "vinamilk.com.vn" and "recruit" in (urlparse(career_url or "").path or "").lower()


def _vinamilk(career_url: str) -> list[dict]:
    payload = {
        "operationName": "GetHrJobs",
        "variables": {"status": "PUBLISHED", "locale": "vi", "pagination": {"limit": _MAX_ATS_JOBS}},
        "query": _QUERY,
    }
    try:
        r = requests.post(_GQL, json=payload, timeout=_TIMEOUT, headers={
            **_JSON_POST, "Origin": "https://www.vinamilk.com.vn",
            "Referer": "https://www.vinamilk.com.vn/",
        })
        if r.status_code != 200:
            logger.info(f"[ats] vinamilk → HTTP {r.status_code}")
            return []
        nodes = ((r.json() or {}).get("data") or {}).get("hrJobDetails_connection", {}).get("nodes") or []
    except Exception as e:
        logger.info(f"[ats] vinamilk failed: {str(e)[:80]}")
        return []

    out = []
    for n in nodes:
        name = (n.get("name") or "").strip()
        slug = (n.get("slug") or "").strip()
        if not name or not slug:
            continue
        ws = [w.get("name", "") for w in (n.get("workspaces") or []) if w.get("name")]
        # Drop Cambodia-only postings; VN cities + "Toàn Quốc" (nationwide) stay.
        if ws and not any(_is_vn_loc(w) or _norm_title(w).startswith("toan quoc") for w in ws):
            continue
        out.append({
            "title": name[:200],
            "url": _DETAIL + slug,
            "location": ", ".join(ws),
            "description": "",
            "category": ", ".join(l.get("name", "") for l in (n.get("levels") or []) if l.get("name")),
        })
    logger.info(f"[ats] vinamilk → {len(out)} VN jobs")
    return out


__all__ = ["_is_vinamilk", "_vinamilk"]
