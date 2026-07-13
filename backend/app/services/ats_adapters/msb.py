"""MSB (jobs.msb.com.vn) — a TalentBrew/Radancy careers skin that server-renders
each opening on the home page as an <a href="/jobs/{slug}-{id}"> card, the title
as its text. A plain GET reads them all; there is NO login wall despite the
nav's "Đăng nhập" link (that link used to trip the compat login-marker into a
false `needs_login`, so the real postings were dropped). It is NOT the Radancy
`/api/jobs` JSON variant (that path 404s here), so we parse the rendered anchors.
VN bank → every posting is domestic, no location filter.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_HOME = "https://jobs.msb.com.vn/"
# Job-detail hrefs end in a numeric id: /jobs/<slug>-<id>. Excludes nav links
# like /jobs/<id>/other-jobs-matching/location-only.
_JOB_RX = re.compile(r"/jobs/.+-\d+$")


def _is_msb(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() == "jobs.msb.com.vn"


def _msb(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get(_HOME, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            logger.info(f"[ats] msb → HTTP {r.status_code}")
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] msb failed: {str(e)[:80]}")
        return []

    out, seen = [], set()
    for a in soup.select('a[href*="/jobs/"]'):
        href = (a.get("href") or "").split("?")[0]
        if not _JOB_RX.search(href):
            continue
        url = urljoin(_HOME, href)
        title = a.get_text(" ", strip=True)
        if not title or url in seen:
            continue
        seen.add(url)
        out.append({"title": title[:200], "url": url, "location": "", "description": ""})
    logger.info(f"[ats] msb → {len(out)} jobs")
    return out


__all__ = ["_is_msb", "_msb"]
