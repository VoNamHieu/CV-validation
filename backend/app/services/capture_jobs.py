"""Serve jobs from extension DOM captures.

A few featured sites have no server-reachable job source — their career pages
sit behind Cloudflare / bot-detection that 403s datacenter IPs (Maersk,
McKinsey, Rikkeisoft, Standard Chartered). The only place their jobs exist for
us is the rendered DOM the browser extension captures (see debug_capture.py).

This module reads the latest stored capture for such a host and extracts its
job postings from the captured anchors, so the featured pipeline can serve
them when the live crawl yields nothing. Captures are refreshed by the
extension's batch-scan button.
"""
from __future__ import annotations

import logging
import re
from urllib.parse import urlparse

from app.services import cache

logger = logging.getLogger(__name__)

_NS = "debug:cap:v1"  # must match debug_capture._NS

_NAV_RX = re.compile(
    r"sign in|log in|login|cookie|skip to|^menu$|view all|see all|saved job|"
    r"talent pool|drop cv|opens in a new tab|privacy|terms|home page|english|"
    r"한국|日本|中文", re.I)


def _deslug(s: str) -> str:
    return " ".join(w for w in re.split(r"[-_]+", s) if w).strip()


# Per-host extraction rules:
#   href   — regex an anchor's href must match to count as a job posting
#   title  — "text" (use the anchor's own text) or "slug" (derive from the URL)
#   slug   — (slug mode) regex with one group capturing the title-bearing slug
_RULES = {
    "mckinsey.com": {
        "href": re.compile(r"/careers/search-jobs/jobs/[a-z0-9-]+", re.I),
        "title": "text",
    },
    "tuyendung.rikkeisoft.com": {
        "href": re.compile(r"/recruitment/detail/[a-z0-9]", re.I),
        "title": "text",
    },
    "jobs.standardchartered.com": {
        "href": re.compile(r"/job/[^/]+/\d+", re.I),
        "title": "text",
    },
    "maersk.com": {
        "href": re.compile(r"/vacancies/.+/jt-", re.I),
        "title": "slug",
        "slug": re.compile(r"/vacancies/(?:[a-z-]+/)?([^/?]+?)(?:_R\d+[\w-]*)?/jt-", re.I),
    },
}


def _host(career_url: str) -> str:
    # Match debug_capture._host: strip www. so keys/rules line up.
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.")


def is_capture_host(career_url: str) -> bool:
    return _host(career_url) in _RULES


async def jobs_from_capture(career_url: str) -> list[dict]:
    host = _host(career_url)
    rule = _RULES.get(host)
    if not rule:
        return []
    snap = await cache.get_json(f"{_NS}:{host}")
    if not snap:
        return []
    out, seen = [], set()
    for a in snap.get("anchors", []):
        href = a.get("href") or ""
        if not rule["href"].search(href):
            continue
        if rule["title"] == "slug":
            m = rule["slug"].search(href)
            title = _deslug(re.sub(r"_R\d+.*$", "", m.group(1))) if m else ""
        else:
            title = (a.get("text") or "").strip()
        if not title or len(title) < 4 or _NAV_RX.search(title):
            continue
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({"title": title[:200], "url": href, "location": "Vietnam", "description": ""})
        if len(out) >= 50:
            break
    if out:
        logger.info(f"[capture-jobs] {host} → {len(out)} jobs from DOM capture")
    return out
