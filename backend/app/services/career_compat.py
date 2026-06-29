"""Career-page compatibility probe: given a target career URL, decide whether
our current acquisition pipeline can actually pull jobs from it — and if not,
WHY (which rung of the ladder it falls off).

This is a DIAGNOSTIC sibling of link_health. link_health asks "does this one
job-detail URL still render a live posting?"; this asks "would extract_jobs_from
_career_page get anything off this listing page, with the adapters we have?".

It composes the existing ladder in dry-run mode instead of fetching for real:
  1. cheap httpx GET                    (crawler.try_http_fetch)
  2. ATS detection by URL / by HTML     (ats_adapters.detect_ats / _in_html)
  3. ATS feed fetch (custom + generic)  (ats_adapters.fetch_ats_jobs)
  4. SPA sniff (render + watch XHR)     (spa_sniff.sniff_jobs)
  5. classify the failure from signals  (anti-bot / soft-404 / careerish-but-no-extractor)

Output is a structured VERDICT, never jobs. Storage mirrors link_health: one
Redis index list + a graceful no-op when Redis is absent.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from urllib.parse import urlparse

from app.services import cache

logger = logging.getLogger(__name__)

_NS = "compat:probe:v1"
_INDEX_KEY = f"{_NS}:__index__"
_TTL = 30 * 24 * 3600          # keep the log for 30 days
_MAX_INDEX = 1000              # cap stored records

_SAMPLE = 5                    # how many sample titles to keep as evidence

# Anti-bot interstitials — the page is fine, we just can't read it server-side.
# These ARE visible in raw HTML (Cloudflare/PerimeterX shells), so no render
# needed to spot them.
_ANTIBOT_MARKERS = (
    "attention required! | cloudflare", "just a moment...",
    "checking your browser", "cf-browser-verification", "px-captcha", "datadome",
    "/cdn-cgi/challenge-platform",
)
# Login walls — career listing sits behind auth we don't carry.
_LOGIN_MARKERS = (
    "please sign in", "please log in", "vui lòng đăng nhập",
    "you must be logged in", "login required",
)
# Soft-404 / empty — the URL resolves but there is no listing there.
_GONE_MARKERS = (
    "page not found", "404 not found", "không tìm thấy", "trang không tồn tại",
    "no longer available", "page you are looking for",
)
# Career-page keywords (accent-stripped match) — is this even a listing page?
_CAREER_WORDS = (
    "tuyen dung", "viec lam", "co hoi nghe nghiep", "ung tuyen", "vi tri tuyen",
    "career", "careers", "job", "jobs", "vacanc", "opening", "position", "hiring",
    "join us", "join our team", "we are hiring", "work with us",
)
# Job-detail URL shapes — if these anchors exist but nothing extracts, the page
# is a real listing we simply lack an adapter for (mirrors career_finder's set).
_JOB_HREF_RX = re.compile(
    r"""href=["'][^"']*(?:
        /job[s]?/[A-Za-z0-9\-_/]+ |
        /career[s]?/[A-Za-z0-9\-_/]+\d |
        /tuyen-dung/[A-Za-z0-9\-] |
        /viec-lam/[A-Za-z0-9\-] |
        /position[s]?/[A-Za-z0-9\-_/] |
        /recruit(?:ment)?/[A-Za-z0-9\-] |
        /vacanc(?:y|ies)/[A-Za-z0-9\-]
    )""",
    re.I | re.X,
)

# Verdict vocabulary (most → least usable):
#   supported          adapter/feed returned jobs from a plain httpx fetch
#   supported_render   only the SPA-sniff (Playwright) pass returned jobs
#   needs_new_adapter  it IS a listing (careerish / job anchors / ATS signal)
#                      but no rung extracted anything → write a custom adapter
#   needs_capture      anti-bot wall → route through the browser extension
#   needs_login        listing is behind auth
#   unsupported        unreachable, soft-404, or no career content at all
_USABLE = {"supported", "supported_render"}


def _strip_accents(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", s)
                   if not unicodedata.combining(c))


def _host(url: str) -> str:
    return (urlparse(url).netloc or "unknown").lower().removeprefix("www.")


def _has(text_low: str, markers: tuple[str, ...]) -> bool:
    return any(m in text_low for m in markers)


def _is_careerish(html: str) -> bool:
    """≥2 distinct career keywords in the accent-stripped text."""
    flat = _strip_accents(html.lower())
    return sum(1 for w in _CAREER_WORDS if w in flat) >= 2


def _samples(jobs: list[dict]) -> list[str]:
    out = []
    for j in jobs:
        t = (j.get("title") or "").strip()
        if t:
            out.append(t[:120])
        if len(out) >= _SAMPLE:
            break
    return out


async def probe(url: str) -> dict:
    """Run the acquisition ladder in dry-run mode and return a verdict dict:

      {verdict, strategy, ats, job_count, samples, blockers, http_code, detail}

    Cheap rungs first (httpx + ATS feeds, both sync → run in threads); only
    escalates to the Playwright SPA-sniff when the cheap rungs find nothing,
    and only renders at all when the page looks like a career page worth it.
    """
    from app.services import crawler
    from app.services.ats_adapters import core as ats

    # ── Rung 1: cheap fetch ───────────────────────────────────────────────
    try:
        http_ok, payload = await asyncio.to_thread(crawler.try_http_fetch, url)
    except Exception as e:
        http_ok, payload = False, str(e)[:200]
    html = payload if http_ok else ""
    html_low = html.lower()

    # Anti-bot / login walls are visible in the raw shell — catch them before
    # we waste an ATS round-trip or a render on a page we can't read anyway.
    if _has(html_low, _ANTIBOT_MARKERS) or (not http_ok and "403" in payload):
        return _verdict("needs_capture", blockers=["anti_bot"], http_code=403,
                        detail="anti-bot interstitial — route via extension capture")
    if _has(html_low, _LOGIN_MARKERS):
        return _verdict("needs_login", blockers=["login"],
                        detail="listing appears to be behind authentication")

    # ── Rung 2+3: ATS detection + feed fetch (covers custom + generic) ────
    ats_url = ats.detect_ats(url)
    ats_html = ats.detect_ats_in_html(html) if html else None
    ats_sig = (ats_url or ats_html or (None,))[0]
    try:
        jobs = await asyncio.to_thread(ats.fetch_ats_jobs, url, html or None)
    except Exception as e:
        logger.info(f"[compat] fetch_ats_jobs raised for {url}: {str(e)[:80]}")
        jobs = []
    if jobs:
        name = (jobs[0].get("source") or ats_sig or "ats")
        return _verdict("supported", strategy=f"ats:{name}", ats=name,
                        job_count=len(jobs), samples=_samples(jobs),
                        detail=f"{len(jobs)} jobs via ATS feed (no render)")

    # ── Rung 4: SPA sniff — only worth a render if the page looks careerish ──
    careerish = bool(html) and _is_careerish(html)
    job_anchors = bool(_JOB_HREF_RX.search(html))
    rendered = False
    if http_ok and (careerish or job_anchors or ats_sig):
        rendered = True
        try:
            from app.services.spa_sniff import sniff_jobs
            sniffed = await sniff_jobs(url)
        except Exception as e:
            logger.info(f"[compat] sniff_jobs raised for {url}: {str(e)[:80]}")
            sniffed = []
        if sniffed:
            return _verdict("supported_render", strategy="spa_sniff",
                            ats=ats_sig, job_count=len(sniffed),
                            samples=_samples(sniffed),
                            detail=f"{len(sniffed)} jobs via SPA sniff (render)")

    # ── Rung 5: nothing extracted — classify why ─────────────────────────
    if not http_ok:
        return _verdict("unsupported", blockers=["unreachable"],
                        detail=f"fetch failed: {payload[:120]}")
    if _has(html_low, _GONE_MARKERS):
        return _verdict("unsupported", blockers=["soft_404"],
                        detail="page resolves but reads as not-found / empty")
    if ats_sig or careerish or job_anchors:
        reason = ("ATS signal but empty feed" if ats_sig
                  else "career listing with no working extractor")
        return _verdict("needs_new_adapter", ats=ats_sig,
                        blockers=["no_extractor"],
                        detail=f"{reason} (rendered={rendered}) — needs a custom adapter")
    return _verdict("unsupported", blockers=["not_careerish"],
                    detail="no career-page content detected")


def _verdict(verdict: str, *, strategy: str = "", ats: str | None = None,
             job_count: int = 0, samples: list[str] | None = None,
             blockers: list[str] | None = None, http_code: int = 0,
             detail: str = "") -> dict:
    return {
        "verdict": verdict,
        "usable": verdict in _USABLE,
        "strategy": strategy,
        "ats": ats or "",
        "job_count": job_count,
        "samples": samples or [],
        "blockers": blockers or [],
        "http_code": http_code,
        "detail": detail,
    }


# ── Storage (mirrors link_health) ────────────────────────────────────────────

async def _load_index() -> list[dict]:
    return await cache.get_json(_INDEX_KEY) or []


async def _save_index(index: list[dict]) -> None:
    await cache.set_json(_INDEX_KEY, index[:_MAX_INDEX], _TTL)


async def record(url: str, res: dict, *, company: str = "",
                 source: str = "probe") -> dict:
    """Upsert a probe record by URL, preserving first_seen, bumping last_checked."""
    now = int(time.time())
    index = await _load_index()
    existing = next((e for e in index if e.get("url") == url), None)
    rec = {
        "url": url,
        "host": _host(url),
        "company": company or (existing or {}).get("company", ""),
        "source": source,
        "verdict": res.get("verdict", ""),
        "usable": res.get("usable", False),
        "strategy": res.get("strategy", ""),
        "ats": res.get("ats", ""),
        "job_count": res.get("job_count", 0),
        "samples": res.get("samples", []),
        "blockers": res.get("blockers", []),
        "http_code": res.get("http_code", 0),
        "detail": res.get("detail", ""),
        "first_seen": (existing or {}).get("first_seen", now),
        "last_checked": now,
        "hits": (existing or {}).get("hits", 0) + 1,
    }
    index = [e for e in index if e.get("url") != url]
    index.insert(0, rec)
    await _save_index(index)
    return rec


async def list_results() -> list[dict]:
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
