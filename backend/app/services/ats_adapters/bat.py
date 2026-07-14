"""BAT — British American Tobacco (careers.bat.com) — Radancy/TalentBrew, but the
`/en/search-jobs/...` + `/en/module/postmodule` variant, NOT the `/api/jobs?woe=`
one the generic `radancy` adapter speaks. The Vietnam search-jobs page
server-renders each opening as an
`<a href="/en/job/{location}/{slug}/1045/{reqId}">` whose text is
"<title> Location: <city>, …, Vietnam". A plain GET reads them all — VN has one
page of openings, no anti-bot.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

# 1045 = BAT's TalentBrew company id; 1562822 = Radancy's Vietnam geo id; the
# trailing 50/1 = 50 results per page, page 1 (VN has < 50 openings → one page).
_VN_URL = "https://careers.bat.com/en/search-jobs/Vietnam/1045/2/1562822/16x16667/107x83333/50/1"
_ORIGIN = "https://careers.bat.com"
_JOB_RX = re.compile(r"/en/job/.+/\d+/\d+")


def _is_bat(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() == "careers.bat.com"


def _bat(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    import time
    # careers.bat.com intermittently drops the connection (times out) on rapid or
    # cold requests, so retry a couple of times before giving up — a single
    # timeout must not read as "0 jobs / adapter broken".
    html = None
    for attempt in range(3):
        try:
            r = requests.get(_VN_URL, headers=_HTML_HEADERS, timeout=_TIMEOUT)
            if r.status_code == 200:
                html = r.text
                break
            logger.info(f"[ats] bat → HTTP {r.status_code}")
        except Exception as e:
            logger.info(f"[ats] bat attempt {attempt + 1} failed: {str(e)[:60]}")
        time.sleep(1.5)
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")

    out, seen = [], set()
    for a in soup.select('a[href*="/en/job/"]'):
        href = (a.get("href") or "").split("?")[0]
        if not _JOB_RX.search(href):
            continue
        url = urljoin(_ORIGIN, href)
        if url in seen:
            continue
        # Anchor text = "<title> Location: <city>, <region>, Vietnam".
        raw = a.get_text(" ", strip=True)
        title, _sep, loc = raw.partition("Location:")
        title = title.strip()
        if not title:
            continue
        seen.add(url)
        out.append({"title": title[:200], "url": url, "location": loc.strip()[:120], "description": ""})
    logger.info(f"[ats] bat → {len(out)} VN jobs")
    return out


__all__ = ["_is_bat", "_bat"]
