"""Link-health monitoring: validate job-detail URLs and keep a log of broken
ones so they can be watched + fixed.

Two feeds populate the log:
  1. PASSIVE — the frontend pipeline reports jobs it already failed on
     (no JD / page wouldn't load) via /monitor/report.
  2. ACTIVE — /monitor/scan walks the featured-job pool and validates that each
     URL actually RENDERS a real posting, not just that it returns 200. This is
     what catches the base.vn class (a closed/wrong posting still 200s with an
     empty SPA shell — see project_basevn_url_id_bug).

Storage mirrors debug_capture: one Redis index list + a graceful no-op when
Redis is absent (the log just won't persist across restarts in that case).
"""
from __future__ import annotations

import logging
import re
import time
from urllib.parse import urlparse

import httpx

from app.services import cache

logger = logging.getLogger(__name__)

_NS = "monitor:link:v1"
_INDEX_KEY = f"{_NS}:__index__"
_TTL = 30 * 24 * 3600          # keep the log for 30 days
_MAX_INDEX = 1000              # cap stored records

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
_HEADERS = {"User-Agent": _UA, "Accept": "text/html,application/xhtml+xml,*/*"}

# Explicit "this posting is gone" markers (status can still be 200).
_GONE_MARKERS = (
    "không tìm thấy", "hết hạn", "đã đóng", "đã hết", "tin tuyển dụng không tồn tại",
    "job not found", "no longer available", "position has been filled",
    "this job is no longer", "page not found", "404 not found",
)
# Anti-bot interstitials — the URL may be fine, we just can't see it server-side.
_ANTIBOT_MARKERS = (
    "attention required! | cloudflare", "just a moment...",
    "checking your browser", "cf-browser-verification", "px-captcha", "datado.me",
)
# A real posting page is rarely this small; a bare SPA shell usually is.
_THIN_BYTES = 16_000

_WORD_RE = re.compile(r"[a-zà-ỹ0-9]{4,}", re.IGNORECASE)
# Strip leading bracket tags like "[Vinpearl Head Office]" and punctuation so we
# compare on the meaningful role words.
_BRACKET_RE = re.compile(r"\[[^\]]*\]")


def _title_words(title: str) -> list[str]:
    t = _BRACKET_RE.sub(" ", title or "").lower()
    return _WORD_RE.findall(t)


def _host(url: str) -> str:
    return (urlparse(url).netloc or "unknown").lower().removeprefix("www.")


async def validate_job_url(url: str, expected_title: str = "") -> dict:
    """Fetch `url` and judge whether it renders a real job posting.

    Returns {status, http_code, reason, detail} where status is one of:
      ok       — looks like a live posting
      broken   — bad HTTP, an explicit "gone" page, or a thin shell missing the
                 expected title (the base.vn dead-link signature)
      unknown  — couldn't tell (anti-bot wall, network error, or a large body
                 that just didn't echo the title) — surfaced for manual review
    """
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=25,
                                     headers=_HEADERS) as client:
            r = await client.get(url)
    except Exception as e:
        return {"status": "unknown", "http_code": 0,
                "reason": "fetch_failed", "detail": str(e)[:200]}

    code = r.status_code
    body = r.text or ""
    low = body.lower()

    if code >= 400:
        return {"status": "broken", "http_code": code,
                "reason": f"http_{code}", "detail": ""}

    if any(m in low for m in _ANTIBOT_MARKERS):
        return {"status": "unknown", "http_code": code,
                "reason": "anti_bot", "detail": "blocked by anti-bot wall"}

    if any(m in low for m in _GONE_MARKERS):
        return {"status": "broken", "http_code": code,
                "reason": "posting_gone", "detail": "page says the posting is gone"}

    # Content check: does the page actually contain the role? When we know the
    # expected title, require a decent fraction of its words to appear in the
    # body. A dead SPA shell (generic "Tuyển dụng" page) fails this even at 200.
    words = _title_words(expected_title)
    if words:
        hits = sum(1 for w in set(words) if w in low)
        ratio = hits / len(set(words))
        if ratio >= 0.5:
            return {"status": "ok", "http_code": code, "reason": "title_present",
                    "detail": f"{hits}/{len(set(words))} title words"}
        if len(body) < _THIN_BYTES:
            return {"status": "broken", "http_code": code, "reason": "empty_shell",
                    "detail": f"{len(body)}B, only {hits}/{len(set(words))} title words"}
        return {"status": "unknown", "http_code": code, "reason": "title_absent",
                "detail": f"{len(body)}B, {hits}/{len(set(words))} title words"}

    # No expected title to match on — fall back to a size heuristic.
    if len(body) < _THIN_BYTES:
        return {"status": "broken", "http_code": code, "reason": "thin_shell",
                "detail": f"{len(body)}B body"}
    return {"status": "ok", "http_code": code, "reason": "has_content",
            "detail": f"{len(body)}B body"}


async def _load_index() -> list[dict]:
    return await cache.get_json(_INDEX_KEY) or []


async def _save_index(index: list[dict]) -> None:
    await cache.set_json(_INDEX_KEY, index[:_MAX_INDEX], _TTL)


async def record(url: str, *, company: str = "", title: str = "",
                 source: str = "pipeline", status: str = "broken",
                 reason: str = "", http_code: int = 0, detail: str = "") -> dict:
    """Upsert a link record by URL, preserving first_seen and bumping last_checked."""
    now = int(time.time())
    index = await _load_index()
    existing = next((e for e in index if e.get("url") == url), None)
    rec = {
        "url": url,
        "host": _host(url),
        "company": company or (existing or {}).get("company", ""),
        "title": title or (existing or {}).get("title", ""),
        "source": source,
        "status": status,
        "reason": reason,
        "http_code": http_code,
        "detail": detail,
        "first_seen": (existing or {}).get("first_seen", now),
        "last_checked": now,
        "hits": (existing or {}).get("hits", 0) + 1,
    }
    index = [e for e in index if e.get("url") != url]
    index.insert(0, rec)
    await _save_index(index)
    return rec


async def list_links() -> list[dict]:
    return await _load_index()


async def clear() -> int:
    index = await _load_index()
    await _save_index([])
    return len(index)


async def remove(url: str) -> bool:
    index = await _load_index()
    new = [e for e in index if e.get("url") != url]
    await _save_index(new)
    return len(new) != len(index)
