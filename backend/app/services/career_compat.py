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

# Regression guard thresholds (see _record_locked). Flag a company whose job
# count collapses to < (1 - ratio) of its high-water baseline — catches an
# adapter breaking to a partial count that the plain verdict still calls
# "supported". Min baseline ignores noise from tiny boards.
_REGRESS_MIN_BASELINE = 5
_REGRESS_DROP_RATIO = 0.6      # ≥60% fewer jobs than the baseline → regressed

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
#   no_vn_jobs         feed/render works, but every job is located outside VN
#                      (e.g. a global tenant with 0 Vietnam openings right now)
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


def _vn_only(jobs: list[dict], is_vn) -> tuple[list[dict], str]:
    """Keep VN-located jobs (same rule the adapters use). Returns (jobs, tag):
      "vn"      → at least one job is in Vietnam (returned)
      "non_vn"  → jobs exist and carry locations, but none is Vietnam ([] returned)
      "unknown" → no job carries a location, so VN can't be judged (all kept)
    This stops a global tenant with 0 VN openings (locations tagged SG/JP/…)
    from reading as "usable N jobs"."""
    vn = [j for j in jobs if is_vn(j.get("location") or "")]
    if vn:
        return vn, "vn"
    if any((j.get("location") or "").strip() for j in jobs):
        return [], "non_vn"
    return jobs, "unknown"


def verdict_from_signals(url: str, *, http_ok: bool, html: str, jobs: list[dict],
                         rendered: bool, ats_sig: str | None = None,
                         fetch_error: str = "") -> dict:
    """Classify a verdict from signals the CALLER already gathered (e.g. the
    ingest pipeline's own render/adapter-fetch/spa-sniff pass) instead of
    fetching/rendering again like probe() does — same vocabulary/shape, no
    duplicate network work. `jobs` is [] when nothing was found; `rendered`
    marks whether a render/spa-sniff pass was attempted (vs. cheap-only)."""
    from app.services.ats_adapters import core as ats

    html_low = (html or "").lower()

    # Jobs in hand beat any wall marker. A page can carry a nav "Đăng nhập" link
    # (MSB) or a stale anti-bot string in a script and STILL have served us real
    # postings — treating those markers as blocking here dropped the jobs and
    # mislabeled the site needs_login/needs_capture. So classify a non-empty
    # `jobs` first; only fall through to the wall markers when we got nothing.
    if jobs:
        name = jobs[0].get("source") or ats_sig or "ats"
        strategy = "spa_sniff" if rendered else f"ats:{name}"
        verdict = "supported_render" if rendered else "supported"
        via = "SPA sniff (render)" if rendered else "ATS feed (no render)"
        vn_jobs, tag = _vn_only(jobs, ats._is_vn_loc)
        if vn_jobs:
            return _verdict(verdict, strategy=strategy, ats=name,
                            job_count=len(vn_jobs), samples=_samples(vn_jobs),
                            detail=f"{len(vn_jobs)} VN jobs via {via}")
        if tag == "non_vn":
            return _verdict("no_vn_jobs", strategy=strategy, ats=name,
                            samples=_samples(jobs), blockers=["no_vn"],
                            detail=f"feed OK ({len(jobs)} jobs) but none located in Vietnam")
        return _verdict(verdict, strategy=strategy, ats=name,
                        job_count=len(jobs), samples=_samples(jobs),
                        detail=f"{len(jobs)} jobs via {via}; location n/a")

    if _has(html_low, _ANTIBOT_MARKERS) or (not http_ok and "403" in fetch_error):
        return _verdict("needs_capture", blockers=["anti_bot"], http_code=403,
                        detail="anti-bot interstitial — route via extension capture")
    if _has(html_low, _LOGIN_MARKERS):
        return _verdict("needs_login", blockers=["login"],
                        detail="listing appears to be behind authentication")

    if not http_ok:
        return _verdict("unsupported", blockers=["unreachable"],
                        detail=f"fetch failed: {fetch_error[:120]}")
    if _has(html_low, _GONE_MARKERS):
        return _verdict("unsupported", blockers=["soft_404"],
                        detail="page resolves but reads as not-found / empty")
    careerish = bool(html) and _is_careerish(html)
    job_anchors = bool(html) and bool(_JOB_HREF_RX.search(html))
    if ats_sig or careerish or job_anchors:
        reason = ("ATS signal but empty feed" if ats_sig
                  else "career listing with no working extractor")
        return _verdict("needs_new_adapter", ats=ats_sig,
                        blockers=["no_extractor"],
                        detail=f"{reason} (rendered={rendered}) — needs a custom adapter")
    return _verdict("unsupported", blockers=["not_careerish"],
                    detail="no career-page content detected")


async def probe(url: str) -> dict:
    """Run the acquisition ladder in dry-run mode and return a verdict dict:

      {verdict, strategy, ats, job_count, samples, blockers, http_code, detail}

    Cheap rungs first (httpx + ATS feeds, both sync → run in threads); only
    escalates to the Playwright SPA-sniff when the cheap rungs find nothing,
    and only renders at all when the page looks like a career page worth it.
    Classification itself is delegated to verdict_from_signals() — this
    function's only job is gathering the signals fresh.
    """
    from app.services import crawler
    from app.services.ats_adapters import core as ats
    from app.services.url_validator import is_allowed_url_resolved

    # SSRF backstop: never fetch/render a non-public URL, whatever the caller.
    # Resolved check → also rejects a public host that DNS-resolves internal.
    if not await is_allowed_url_resolved(url):
        return _verdict("unsupported", blockers=["url_disallowed"],
                        detail="blocked by SSRF guard")

    # ── Rung 1: cheap fetch ───────────────────────────────────────────────
    try:
        http_ok, payload = await asyncio.to_thread(crawler.try_http_fetch, url)
    except Exception as e:
        http_ok, payload = False, str(e)[:200]
    html = payload if http_ok else ""

    # Anti-bot / login walls are visible in the raw shell — catch them before
    # we waste an ATS round-trip or a render on a page we can't read anyway.
    early = verdict_from_signals(url, http_ok=http_ok, html=html, jobs=[],
                                 rendered=False, fetch_error=payload if not http_ok else "")
    if early["verdict"] in ("needs_capture", "needs_login"):
        return early

    # ── Rung 2+3: ATS detection + feed fetch (covers custom + generic) ────
    ats_url = ats.detect_ats(url)
    ats_html = ats.detect_ats_in_html(html) if html else None
    custom_ats = ats.is_known_ats_url(url)
    ats_sig = (ats_url or ats_html or ((custom_ats,) if custom_ats else (None,)))[0]
    try:
        jobs = await asyncio.to_thread(ats.fetch_ats_jobs, url, html or None)
    except Exception as e:
        logger.info(f"[compat] fetch_ats_jobs raised for {url}: {str(e)[:80]}")
        jobs = []
    if jobs:
        return verdict_from_signals(url, http_ok=http_ok, html=html, jobs=jobs,
                                    rendered=False, ats_sig=ats_sig)

    # ── Rung 4: SPA sniff — only worth a render if the page looks careerish ──
    careerish = bool(html) and _is_careerish(html)
    job_anchors = bool(_JOB_HREF_RX.search(html))
    rendered = False
    sniffed: list[dict] = []
    if http_ok and (careerish or job_anchors or ats_sig):
        rendered = True
        try:
            from app.services.spa_sniff import sniff_jobs
            sniffed = await sniff_jobs(url)
        except Exception as e:
            logger.info(f"[compat] sniff_jobs raised for {url}: {str(e)[:80]}")
            sniffed = []

    # ── Rung 5 (inside verdict_from_signals): classify why, if still nothing ──
    return verdict_from_signals(url, http_ok=http_ok, html=html, jobs=sniffed,
                                rendered=rendered, ats_sig=ats_sig,
                                fetch_error=payload if not http_ok else "")


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


# The index is one Redis key updated read-modify-write. The cron ingest records
# a verdict per company at concurrency 8, so unsynchronised writes lose updates
# (two coroutines load the same list, each drops the other's new row). Serialize
# the mutate within the process — cron and the admin scan are each single-process
# so this is sufficient; cross-process races (admin scanning mid-cron) are rare
# and self-heal next cycle.
_write_lock = asyncio.Lock()


async def record(url: str, res: dict, *, company: str = "",
                 source: str = "probe") -> dict:
    """Upsert a probe record, keyed by company (fallback URL), preserving
    first_seen and bumping last_checked."""
    now = int(time.time())
    async with _write_lock:
        return await _record_locked(url, res, company=company, source=source, now=now)


async def _record_locked(url: str, res: dict, *, company: str, source: str, now: int) -> dict:
    index = await _load_index()
    # Identity is the COMPANY, not the URL: the same employer surfaces under
    # several career_url variants across runs (marketing shell vs ATS tenant, a
    # detail page captured once, a manual probe of a different path). Keying on
    # URL kept a stale duplicate row per variant — the cron would add a fresh
    # "supported" while the old scan's "needs_adapter" lingered. Dedupe by
    # company so there's exactly one row per employer; fall back to URL only for
    # ad-hoc probes with no company attached.
    if company:
        existing = next((e for e in index if e.get("company") == company), None)
        index = [e for e in index if e.get("company") != company]
    else:
        existing = next((e for e in index if e.get("url") == url), None)
        index = [e for e in index if e.get("url") != url]

    # ── Regression guard ──────────────────────────────────────────────────
    # The plain verdict can't see a PARTIAL collapse: an adapter that breaks and
    # returns 12 of its usual 94 jobs still reads "supported" (green). We track a
    # high-water baseline per company and flag when the current count falls far
    # below it — catching e.g. momo's signed-API key rotating (94 → 12) or any
    # feed silently shrinking. Baseline is a max (sticky), so the flag persists
    # every run while degraded, not just the run the drop happened. A genuine,
    # permanent shrink needs a manual re-baseline (clear) — rare and acceptable.
    prev_count = int((existing or {}).get("job_count", 0) or 0)
    cur_count = int(res.get("job_count", 0) or 0)
    baseline = max(int((existing or {}).get("baseline_job_count", 0) or 0),
                   prev_count, cur_count)
    # Ignore noise from tiny boards; flag a ≥60% drop off the baseline.
    regressed = baseline >= _REGRESS_MIN_BASELINE and cur_count < baseline * (1 - _REGRESS_DROP_RATIO)
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
        "prev_job_count": prev_count,
        "baseline_job_count": baseline,
        "regressed": regressed,
    }
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
