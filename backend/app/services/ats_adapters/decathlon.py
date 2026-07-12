"""Decathlon Vietnam (careersdecathlonvn.com) — eHiring portal.

Jobs come from a clean JSON API (no JS gate, no auth):
    GET /api/portals/recruitments?page=N&limit=100
→ {"data": [...], "total": N, "page": P, "pageCount": P}. Each item carries
id / name / description / require; the public detail route is
/en/recruitment/<id> — an SPA shell that resolves the job by id via
/api/portals/recruitments/<id> (verified 200 + correct job), so the link is
live, not a dead codename shell. City is a prefix inside the title
("HCMC - …", "Hanoi - …"), not a separate field, and the whole portal is VN, so
no location filter is needed.

Paginated defensively even though the board is small today (total ~25): the
page loop stops at pageCount so a future growth past one page is picked up
automatically, unlike the render/spa-sniff path this replaces (which only ever
saw page 1 and was flaky between 25 and 0).
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_HOSTS = ("careersdecathlonvn.com", "www.careersdecathlonvn.com")
_API = "https://careersdecathlonvn.com/api/portals/recruitments"
_DETAIL = "https://careersdecathlonvn.com/en/recruitment/{jid}"


def _is_decathlon(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in _HOSTS


def _section_text(v) -> str:
    """Flatten an eHiring rich-text field to plain text. ``description`` is a
    list of ``{"name", "content"}`` sections (content is HTML); ``require`` is a
    plain (often empty) string. Either may be missing."""
    if not v:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        parts = []
        for s in v:
            if isinstance(s, dict):
                parts.append(f"{s.get('name', '')} {s.get('content', '')}".strip())
            elif isinstance(s, str):
                parts.append(s)
        return " ".join(p for p in parts if p)
    return ""


def _decathlon(career_url: str) -> list[dict]:
    out: list[dict] = []
    for page in range(1, 21):  # 20 * 100 = hard bound; loop really ends at pageCount
        try:
            r = requests.get(_API, params={"page": page, "limit": 100},
                             headers=_HEADERS, timeout=_TIMEOUT)
            if r.status_code != 200:
                break
            d = r.json()
        except Exception as e:  # noqa: BLE001
            logger.info(f"[ats] decathlon page {page} failed: {str(e)[:80]}")
            break
        data = d.get("data") or []
        if not data:
            break
        for j in data:
            jid = j.get("id")
            title = (j.get("name") or "").strip()
            if not jid or not title:
                continue
            desc = f"{_section_text(j.get('description'))} {_section_text(j.get('require'))}".strip()
            out.append({
                "title": title[:200],
                "url": _DETAIL.format(jid=jid),
                "location": "",
                "description": _strip_html(desc)[:4000] if desc else "",
            })
        if page >= (d.get("pageCount") or 1) or len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] decathlon → {len(out)} jobs")
    return out


__all__ = ["_is_decathlon", "_decathlon"]
