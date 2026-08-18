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
    # The HOME page only shows the ~5-10 NEWEST cards, rotating daily — reading
    # it alone made the store accumulate stale rows the anti-flap prune could
    # never reconcile (feed 5 vs 59 active → perpetual url_scheme_changed
    # noise). The full board is /latest-jobs, server-rendered at 10 rows/page
    # and paged by ?page_num=N (jNumPagesInit in page 1 carries the page count).
    from bs4 import BeautifulSoup
    out, seen = [], set()
    pages = 1
    try:
        for page in range(1, 31):
            r = requests.get(f"{_HOME}latest-jobs", headers=_HTML_HEADERS,
                             timeout=_TIMEOUT, params={"page_num": page})
            if r.status_code != 200:
                break
            if page == 1:
                m = re.search(r'id="jNumPagesInit"\s+value="(\d+)"', r.text)
                pages = int(m.group(1)) if m else 1
            soup = BeautifulSoup(r.text, "html.parser")
            added = 0
            for a in soup.select('a[href*="/jobs/"]'):
                href = (a.get("href") or "").split("?")[0]
                if not _JOB_RX.search(href):
                    continue
                url = urljoin(_HOME, href)
                title = a.get_text(" ", strip=True)
                if not title or url in seen:
                    continue
                seen.add(url)
                added += 1
                jid = re.search(r"-(\d+)$", href)
                out.append({"title": title[:200], "url": url,
                            "external_id": jid.group(1) if jid else url,
                            "location": "", "description": ""})
            if added == 0 or page >= pages or len(out) >= _MAX_ATS_JOBS:
                break
    except Exception as e:
        logger.info(f"[ats] msb failed: {str(e)[:80]}")
    logger.info(f"[ats] msb → {len(out)} jobs ({pages} pages)")
    return out


__all__ = ["_is_msb", "_msb"]
