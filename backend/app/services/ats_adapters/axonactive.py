"""Axon Active (careers.axonactive.com) — a Wix site whose job postings are
Wix **Blog** posts at /post/{slug}, NOT a normal careers list.

Pitfall this replaces: the company's featured career_url used to be
www.axonactive.com/careers, which 302s to the marketing homepage
www.axonactive.com/ — so the generic extractor scraped Wix widget names
("Google Analytics", "Chat Bot", "usersCookieBanner", …) as "jobs" and minted
bogus /job/{uuid} URLs. The real board lives on the separate `careers.` host.

The Wix Blog data API (/_api/communities-blog-node-api/…) is 403 without an app
`instance` token, and the SSR HTML only carries ~3 of the posts. The public
RSS feed at /blog-feed.xml is the clean, complete, token-free source — one
`<item>` per opening with title, the correct /post/{slug} link, the location in
`<category>`, and the JD in `<description>`.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_FEED = "https://www.careers.axonactive.com/blog-feed.xml"

# Titles are prefixed with an opening count, e.g. "03 Java Developers",
# "01 Product Owner" — strip it so taxonomy/seniority classify the real title.
_COUNT_PREFIX = re.compile(r"^\d{1,2}\s+")


def _is_axonactive(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "careers.axonactive.com", "www.careers.axonactive.com")


def _axonactive(career_url: str) -> list[dict]:
    import xml.etree.ElementTree as ET
    out: list[dict] = []
    try:
        r = requests.get(_FEED, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            logger.info(f"[ats] axonactive feed → HTTP {r.status_code}")
            return out
        root = ET.fromstring(r.content)
    except Exception as e:
        logger.info(f"[ats] axonactive feed failed: {str(e)[:80]}")
        return out

    def _txt(el, tag):
        x = el.find(tag)
        return (x.text or "").strip() if x is not None and x.text else ""

    for it in root.findall(".//item"):
        title = _COUNT_PREFIX.sub("", _txt(it, "title")).strip()
        link = _txt(it, "link")
        if not title or not link:
            continue
        cats = [c.text.strip() for c in it.findall("category") if c is not None and c.text]
        out.append({
            "title": title[:200],
            "url": link,
            "location": ", ".join(cats),
            "description": _strip_html(_txt(it, "description"))[:2000],
        })
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] axonactive → {len(out)} jobs")
    return out


__all__ = ["_is_axonactive", "_axonactive"]
