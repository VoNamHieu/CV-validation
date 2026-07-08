"""Unilever Vietnam — "Uniquely U" employer-brand site (uniquelyuvn.com). A
GraphQL SPA; the /job route redirects to home on a direct hit, but the API is
public and unauthenticated:
  POST /graphql  publicJobInfoOffsetPaginated(filter: {}, pagination: {take})
An empty filter returns the live openings (UFLP / UFresh / intern programmes);
type=JOB etc. return nothing — jobs carry no `type`, only subType=INDIVIDUAL.
Detail page is /job/{alias}; some postings set redirectUrl to an external ATS.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_GQL = "https://uniquelyuvn.com/graphql"
_SITE = "https://uniquelyuvn.com"
_QUERY = (
    "query getJobs($filter: JobInfoPublicFilterArgs, $pagination: OffsetPaginationArgs) {"
    "  result: publicJobInfoOffsetPaginated(filter: $filter, pagination: $pagination) {"
    "    edges { node { id alias jobTitle jobDescription yearsOfExperience redirectUrl } }"
    "  } }"
)


def _is_unilever(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "uniquelyuvn.com", "www.uniquelyuvn.com")


def _unilever(career_url: str) -> list[dict]:
    try:
        r = requests.post(_GQL, timeout=_TIMEOUT,
                          headers={**_JSON_POST, "Referer": f"{_SITE}/"},
                          json={"operationName": "getJobs",
                                "variables": {"filter": {}, "pagination": {"take": 100}},
                                "query": _QUERY})
        if r.status_code != 200:
            logger.info(f"[ats] unilever HTTP {r.status_code}")
            return []
        edges = (((r.json() or {}).get("data") or {}).get("result") or {}).get("edges", []) or []
    except Exception as e:
        logger.info(f"[ats] unilever failed: {str(e)[:80]}")
        return []
    out = []
    for e in edges:
        n = e.get("node") or {}
        title = (n.get("jobTitle") or "").strip()
        alias = (n.get("alias") or "").strip()
        if not title or not alias:
            continue
        redirect = (n.get("redirectUrl") or "").strip()
        out.append({
            "title": title[:200],
            "url": redirect or f"{_SITE}/job/{alias}",
            "location": "Vietnam",
            "description": _strip_html(n.get("jobDescription") or ""),
        })
    logger.info(f"[ats] unilever → {len(out)} jobs")
    return out


__all__ = ["_is_unilever", "_unilever"]
