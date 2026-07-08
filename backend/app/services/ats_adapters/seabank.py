"""SeABank (tuyendung.seabank.com.vn) — Next.js careers site. The /jobs listing
server-renders each posting as a `/jobs/<slug>.<id>` link (title is the anchor
text). Each job appears twice (title link + a "Chi tiết"/"Ứng tuyển" button), so
we dedup by URL and skip the button anchors. JD is on the detail page.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_URL = "https://tuyendung.seabank.com.vn/jobs"
_DETAIL_RX = re.compile(r"/jobs/[a-z0-9-]+\.\d+", re.I)
_SKIP = {"chi tiet", "ung tuyen", "chi tiết", "ứng tuyển"}


def _is_seabank(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() == "tuyendung.seabank.com.vn"


def _seabank(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get(_URL, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] seabank failed: {str(e)[:80]}")
        return []
    out, seen = [], set()
    for a in soup.select('a[href*="/jobs/"]'):
        href = a.get("href") or ""
        title = a.get_text(" ", strip=True)
        if not _DETAIL_RX.search(href) or not title or _norm_title(title) in _SKIP:
            continue
        url = urljoin(_URL, href)
        if url in seen:
            continue
        seen.add(url)
        out.append({"title": title[:200], "url": url, "location": "", "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] seabank → {len(out)} jobs")
    return out


__all__ = ["_is_seabank", "_seabank"]
