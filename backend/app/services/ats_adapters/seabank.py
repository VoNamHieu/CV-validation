"""SeABank (tuyendung.seabank.com.vn) — Next.js careers site. The /jobs listing
server-renders each posting as a `/jobs/<slug>.<id>` link (title is the anchor
text). Each job appears twice (title link + a "Chi tiết"/"Ứng tuyển" button), so
we dedup by URL and skip the button anchors. JD is on the detail page — SSR
too, but in anonymous Tailwind-utility divs, so extraction anchors on the
"Mô tả công việc" heading and climbs to the smallest ancestor that holds the
whole posting (≤12k chars; the page shell is ~150k so the climb can't leak).
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403

_URL = "https://tuyendung.seabank.com.vn/jobs"
_DETAIL_RX = re.compile(r"/jobs/[a-z0-9-]+\.\d+", re.I)
_SKIP = {"chi tiet", "ung tuyen", "chi tiết", "ứng tuyển"}
_MARKER_RX = re.compile(r"Mô tả công việc|Nhiệm vụ|Trách nhiệm", re.I)
_MAX_JD_FETCH = 100  # bound per-job detail GETs (board ~85 jobs)


def _jd_detail(url: str) -> str:
    """Full JD from the SSR detail page ("" on any miss, full-or-blank)."""
    from bs4 import BeautifulSoup
    try:
        r = requests.get(url, headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return ""
        soup = BeautifulSoup(r.text, "html.parser")
        for t in soup(["script", "style", "nav", "header", "footer"]):
            t.decompose()
        mk = soup.find(string=_MARKER_RX)
        if not mk:
            return ""
        el, best = mk.parent, ""
        for _ in range(8):  # climb: largest ancestor still ≤ the JD-sized bound
            if el is None:
                break
            txt = el.get_text("\n", strip=True)
            if len(txt) > 12000:
                break
            best = txt
            el = el.parent
        return _full_desc(best)
    except Exception as e:
        logger.info(f"[ats] seabank detail failed: {str(e)[:60]}")
        return ""


def _is_seabank(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() == "tuyendung.seabank.com.vn"


def _seabank(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    out, seen = [], set()
    for page in range(1, 11):  # ~10/page; stop when a page adds nothing new
        try:
            r = requests.get(_URL, headers=_HTML_HEADERS, timeout=_TIMEOUT,
                             params={"page": page})
            if r.status_code != 200:
                break
            soup = BeautifulSoup(r.text, "html.parser")
        except Exception as e:
            logger.info(f"[ats] seabank page {page} failed: {str(e)[:80]}")
            break
        added = 0
        for a in soup.select('a[href*="/jobs/"]'):
            href = a.get("href") or ""
            title = a.get_text(" ", strip=True)
            if not _DETAIL_RX.search(href) or not title or _norm_title(title) in _SKIP:
                continue
            url = urljoin(_URL, href)
            if url in seen:
                continue
            seen.add(url)
            added += 1
            out.append({"title": title[:200], "url": url, "location": "",
                        "description": _jd_detail(url) if len(out) < _MAX_JD_FETCH else ""})
        if not added or len(out) >= _MAX_ATS_JOBS:  # last page (or the SPA ignores ?page)
            break
    logger.info(f"[ats] seabank → {len(out)} jobs")
    return out


__all__ = ["_is_seabank", "_seabank"]
