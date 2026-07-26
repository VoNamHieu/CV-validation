"""DSV (dsv.com) — the global careers job-search page, filtered to Vietnam.

The company's default career_url (www.dsv.com/en/careers?q=*) is a marketing
landing page with no real postings, so the generic extractor scraped its chrome
into fake "jobs" (e.g. the cookie-banner's support.microsoft.com IE link, plus
job-area category pages). The real board is the job-search results page, which
IS server-rendered when a location filter is applied:
    /en/careers/job-search?query=&location=Vietnam
Each result is a card with the title in an `<h2>` and a "Read more" link to
    /en/careers/job-search/joboffer/v2/{id}-{locale}
(the DSV job-search API at /nges-portal/api/… is auth-gated, but the SSR list
carries everything we need, so no token is required).
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_SEARCH = "https://www.dsv.com/en/careers/job-search?query=&location=Vietnam"
_H = re.compile(r"h[1-6]")


def _is_dsv(career_url: str) -> bool:
    host = (urlparse(career_url or "").netloc or "").lower()
    return host == "dsv.com" or host.endswith(".dsv.com")


def _dsv(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    # Always drive off the Vietnam-filtered search (the bare career_url is the
    # marketing page). Honour an explicit job-search URL if one is configured.
    url = career_url if "/job-search" in (career_url or "") else _SEARCH
    try:
        r = requests.get(url, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            logger.info(f"[ats] dsv → HTTP {r.status_code}")
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] dsv failed: {str(e)[:80]}")
        return []

    out: list[dict] = []
    seen: set[str] = set()
    for a in soup.select('a[href*="/joboffer/v2/"]'):
        href = a.get("href")
        if not href or href in seen:
            continue
        seen.add(href)
        # tightest ancestor holding exactly this one offer link + a heading
        card = a
        while card.parent is not None:
            card = card.parent
            if len(card.select('a[href*="/joboffer/v2/"]')) == 1 and card.find(_H):
                break
        h = card.find(_H)
        title = h.get_text(" ", strip=True) if h else ""
        if not title:
            continue
        lines = [ln.strip() for ln in card.get_text("\n", strip=True).split("\n") if ln.strip()]
        # the location is the leading line(s) before the date, e.g. "Viet Nam, Hanoi"
        loc = " ".join(lines[:2]) if lines else ""
        loc = re.sub(r"\s*,\s*", ", ", re.sub(r"\s+", " ", loc)).strip().rstrip(",")
        out.append({
            "title": title[:200],
            "url": urljoin(url, href),
            "external_id": href.rstrip("/").split("/")[-1].split("-")[0],  # numeric offer id
            "location": loc,
            "description": "",
        })
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] dsv → {len(out)} jobs")
    return out


__all__ = ["_is_dsv", "_dsv"]
