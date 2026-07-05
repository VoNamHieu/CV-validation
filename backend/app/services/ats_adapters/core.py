"""ATS dispatch entrypoint. Detects a career URL's ATS and pulls its jobs via
the public JSON APIs. Implementations live in sibling modules:
  - _shared : shared helpers/constants
  - generic : hosted-ATS fetchers (Lever/Greenhouse/Ashby/Recruitee/SmartRecruiters)
  - vendors : per-company/platform adapters + the `_ADAPTERS` registry

Public surface (unchanged for callers): fetch_ats_jobs, detect_ats,
detect_ats_in_html, is_known_ats_url. Returns plain dicts:
{"title", "url", "location", "description"}.
"""
from __future__ import annotations

from app.services.ats_adapters._shared import *  # noqa: F401,F403  helpers + logger
from app.services.ats_adapters.generic import _FETCHERS  # noqa: F401
from app.services.ats_adapters.vendors import _ADAPTERS, _is_basevn  # noqa: F401

# ── Detection ────────────────────────────────────────────────────────────────
def detect_ats(url: str) -> tuple[str, str] | None:
    """(ats, slug) from an ATS-hosted career URL, else None."""
    try:
        p = urlparse(url)
    except Exception:
        return None
    host = (p.netloc or "").lower()
    segs = [s for s in (p.path or "").split("/") if s]
    seg0 = segs[0] if segs else ""

    if "lever.co" in host and seg0:
        return ("lever", seg0)
    if "greenhouse.io" in host and seg0:
        return ("greenhouse", seg0)
    if "ashbyhq.com" in host and seg0:
        return ("ashby", seg0)
    if "smartrecruiters.com" in host and seg0:
        return ("smartrecruiters", seg0)
    if host.endswith(".recruitee.com"):
        sub = host.split(".")[0]
        if sub not in ("www", "recruitee"):
            return ("recruitee", sub)
    return None


_HTML_SIGNALS = [
    ("greenhouse", re.compile(r"(?:boards|job-boards)\.greenhouse\.io/(?:embed/job_board\?for=)?([a-z0-9_-]+)", re.I)),
    ("greenhouse", re.compile(r"boards-api\.greenhouse\.io/v1/boards/([a-z0-9_-]+)", re.I)),
    ("lever", re.compile(r"(?:jobs|hire)\.lever\.co/([a-z0-9_-]+)", re.I)),
    ("lever", re.compile(r"api\.lever\.co/v0/postings/([a-z0-9_-]+)", re.I)),
    ("ashby", re.compile(r"(?:jobs\.ashbyhq\.com|api\.ashbyhq\.com/posting-api/job-board)/([a-z0-9_-]+)", re.I)),
    ("recruitee", re.compile(r"([a-z0-9_-]+)\.recruitee\.com", re.I)),
    ("smartrecruiters", re.compile(r"(?:careers|jobs)\.smartrecruiters\.com/([a-z0-9_-]+)", re.I)),
    ("smartrecruiters", re.compile(r"api\.smartrecruiters\.com/v1/companies/([a-z0-9_-]+)", re.I)),
]


def detect_ats_in_html(html: str) -> tuple[str, str] | None:
    """Find an ATS the career page embeds (iframe/script/link), with its slug."""
    if not html:
        return None
    for ats, rx in _HTML_SIGNALS:
        m = rx.search(html)
        if m:
            slug = m.group(1)
            if slug.lower() not in ("www", "recruitee", "embed", "v1", "v0"):
                return (ats, slug)
    return None



# ── Dispatch ─────────────────────────────────────────────────────────────────
def is_known_ats_url(career_url: str) -> str | None:
    """Name of the custom adapter whose URL pattern matches `career_url`, by
    pattern alone — regardless of whether the feed currently returns jobs.

    fetch_ats_jobs returning [] is ambiguous: "no adapter recognizes this URL"
    and "the adapter matched but the feed is empty right now" look identical
    from outside. This tells them apart, so callers can flag the second case
    (a known feed going quiet) as a potential regression instead of the
    expected, silent majority of featured companies with no ATS at all."""
    for name, detect, _fetch in _ADAPTERS:
        try:
            if detect(career_url, None):
                return name
        except Exception:
            continue
    return None


def fetch_ats_jobs(career_url: str, html: str | None = None) -> list[dict]:
    """Detect the ATS (from URL, then embedded in HTML) and fetch its jobs.
    Returns [] when no ATS is detected or the API yields nothing. Every
    adapter's output passes through _finalize for consistent dedup /
    nav-filtering / capping."""
    for name, detect, fetch in _ADAPTERS:
        try:
            if not detect(career_url, html):
                continue
            jobs = [j for j in (fetch(career_url, html) or []) if j.get("title") and j.get("url")]
            if jobs:
                for j in jobs:
                    j.setdefault("source", name)
                logger.info(f"[ats] {name} → {len(jobs)} jobs ({career_url})")
                return _finalize(jobs)
        except Exception as e:
            logger.info(f"[ats] {name} failed for {career_url}: {str(e)[:80]}")

    # Generic slug-based ATS (Lever/Greenhouse/Ashby/SmartRecruiters/Recruitee),
    # detected from the URL or embedded in the HTML. These list GLOBAL jobs, so
    # keep only VN postings — unless none are VN-tagged (location-less or
    # VN-domestic data), in which case keep everything rather than drop all.
    hit = detect_ats(career_url) or (detect_ats_in_html(html) if html else None)
    if not hit:
        return []
    ats, slug = hit
    fetcher = _FETCHERS.get(ats)
    if not fetcher:
        return []
    try:
        jobs = [j for j in fetcher(slug) if j.get("title") and j.get("url")]
    except Exception as e:  # never let a quirky ATS response break the pipeline
        logger.info(f"[ats] {ats}:{slug} fetch failed: {str(e)[:80]}")
        return []
    vn = [j for j in jobs if _is_vn_loc(j.get("location") or "")]
    located = [j for j in jobs if (j.get("location") or "").strip()]
    if vn:
        jobs = vn
    elif located and len(located) == len(jobs):
        # Every posting is location-tagged and none is in Vietnam → a global
        # board with no VN roles (e.g. Agoda's Greenhouse). Return nothing rather
        # than flooding the VN store with foreign jobs. (Untagged jobs = likely
        # VN-domestic → keep-all, handled by falling through.)
        jobs = []
    logger.info(f"[ats] {ats}:{slug} → {len(jobs)} jobs ({career_url})")
    return _finalize(jobs)
