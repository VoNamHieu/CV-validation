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

import asyncio
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

# Browser renders are far heavier than the httpx pass, so cap how many run at
# once even when the scan fans out wider.
_RENDER_SEM = asyncio.Semaphore(4)

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
_HEADERS = {"User-Agent": _UA, "Accept": "text/html,application/xhtml+xml,*/*"}

# Explicit "this posting is gone" markers (status can still be 200). Only
# trusted on a RENDERED DOM — in raw server HTML of a JS app these strings are
# often bundled 404-route boilerplate, not the actual page state.
_GONE_MARKERS = (
    "không tìm thấy", "hết hạn", "đã đóng", "đã hết", "tin tuyển dụng không tồn tại",
    "job not found", "no longer available", "position has been filled",
    "this job is no longer", "page not found", "404 not found",
    "page is missing", "looking for is missing", "page you are looking for",
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


def _title_ratio(body_low: str, words: set[str]) -> tuple[int, float]:
    if not words:
        return 0, 0.0
    hits = sum(1 for w in words if w in body_low)
    return hits, hits / len(words)


async def _block_noise(route):
    if route.request.resource_type in ("image", "media", "font"):
        await route.abort()
    else:
        await route.continue_()


async def _render_text(url: str) -> tuple[bool, str]:
    """Headless-render `url` and return (ok, visible body text).

    Tuned for job-detail SPAs: wait for network to settle (not a fixed content
    selector — those vary per site and made shells look empty), then read the
    body's inner_text. Uses the shared browser pool, capped by _RENDER_SEM.
    """
    try:
        from app.services.browser_pool import get_browser
    except Exception as e:  # Playwright not available in this env
        return False, str(e)[:120]

    async with _RENDER_SEM:
        context = None
        try:
            browser = await get_browser()
            context = await browser.new_context(
                user_agent=_UA, viewport={"width": 1280, "height": 800}, locale="vi-VN",
            )
            await context.route("**/*", _block_noise)
            page = await context.new_page()
            await page.goto(url, timeout=40000, wait_until="domcontentloaded")
            try:
                await page.wait_for_load_state("networkidle", timeout=12000)
            except Exception:
                pass
            await page.wait_for_timeout(1500)
            text = await page.inner_text("body")
            return True, text or ""
        except Exception as e:
            return False, str(e)[:160]
        finally:
            if context is not None:
                try:
                    await context.close()
                except Exception:
                    pass


def _content_verdict(text: str, words: set[str], code: int, *, rendered: bool) -> dict:
    """Judge a body of text (raw HTML or rendered DOM) against the role title.

    On a RENDERED DOM the verdict is authoritative: the title is either there or
    it isn't. On raw server HTML we only ever return a confident `ok` (the page
    is server-rendered) — anything else is left for the render pass to settle.
    """
    low = text.lower()
    method = "rendered" if rendered else "http"

    if rendered and any(m in low for m in _GONE_MARKERS):
        return {"status": "broken", "http_code": code, "reason": "posting_gone",
                "detail": "rendered page says the posting is gone", "method": method}

    if words:
        hits, ratio = _title_ratio(low, words)
        if ratio >= 0.5:
            return {"status": "ok", "http_code": code, "reason": "title_present",
                    "detail": f"{hits}/{len(words)} title words", "method": method}
        if rendered:
            return {"status": "broken", "http_code": code, "reason": "content_missing",
                    "detail": f"rendered {len(text)} chars, only {hits}/{len(words)} title words",
                    "method": method}
        return {"status": "inconclusive", "http_code": code, "reason": "title_absent",
                "detail": f"{len(text)}B, {hits}/{len(words)} title words", "method": method}

    # No title to match on — fall back to a size heuristic.
    if rendered:
        if len(text) < _THIN_BYTES:
            return {"status": "broken", "http_code": code, "reason": "thin_shell",
                    "detail": f"rendered {len(text)} chars", "method": method}
        return {"status": "ok", "http_code": code, "reason": "has_content",
                "detail": f"rendered {len(text)} chars", "method": method}
    return {"status": "inconclusive", "http_code": code, "reason": "no_title",
            "detail": f"{len(text)}B body", "method": method}


async def validate_job_url(url: str, expected_title: str = "", allow_render: bool = True) -> dict:
    """Fetch `url` and judge whether it renders a real job posting.

    Two-pass to avoid false positives on JS-rendered pages:
      1. Cheap httpx GET — settles only the certain cases (bad HTTP, or the role
         title already present in server HTML = SSR page that works).
      2. For everything else (SPA shells, bundled 404 boilerplate, gone-markers
         that might be boilerplate), headless-render the URL and judge the real
         DOM. A rendered DOM is authoritative.

    Returns {status, http_code, reason, detail, method} where status is one of:
      ok       — a live posting (title present, server-side or rendered)
      broken   — bad HTTP, or the rendered DOM has no posting / says it's gone
      unknown  — couldn't decide (network/anti-bot, or render unavailable)
    """
    words = set(_title_words(expected_title))

    async def _render_verdict(code: int, fallback: dict) -> dict:
        """Render the real DOM and judge it; fall back if rendering is off/fails."""
        if allow_render:
            ok, text = await _render_text(url)
            if ok:
                return _content_verdict(text, words, code, rendered=True)
        return fallback

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=25,
                                     headers=_HEADERS) as client:
            r = await client.get(url)
    except Exception as e:
        # The cheap fetch died — a render might still succeed (anti-bot / SPA).
        return await _render_verdict(0, {
            "status": "unknown", "http_code": 0, "reason": "fetch_failed",
            "detail": str(e)[:200], "method": "http"})

    code = r.status_code
    body = r.text or ""

    if code >= 400:
        return {"status": "broken", "http_code": code, "reason": f"http_{code}",
                "detail": "", "method": "http"}

    # Confident server-side verdict? (title present in raw HTML = real SSR page.)
    cheap = _content_verdict(body, words, code, rendered=False)
    if cheap["status"] == "ok":
        return cheap

    # Inconclusive (SPA shell / boilerplate / anti-bot) → render the real DOM.
    antibot = any(m in body.lower() for m in _ANTIBOT_MARKERS)
    return await _render_verdict(code, {
        "status": "unknown", "http_code": code,
        "reason": "anti_bot" if antibot else f"{cheap['reason']}_unrendered",
        "detail": cheap["detail"] + " (no render)", "method": "http"})


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
