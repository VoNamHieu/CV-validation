"""
Resolve a single JD page via the existing ATS adapters (crawl-side reuse).

Many career sites are SPAs whose JD text never renders for a server-side crawler
(empty/thin HTML from a datacenter IP). But the search-layer ATS adapters
(`app.services.ats_adapters`) already speak each platform's public API, and many
return the full description per job. This module reuses them on the *crawl* side:
given a JD URL, fetch the platform's job list and return the description of the
job whose URL matches the request.

It is READ-ONLY over the ATS package — it adds no platform code, it just routes
crawl misses through `fetch_ats_jobs`. Best-effort: any failure returns None and
the caller falls back to Playwright/extension.
"""
import html as _html
import logging
import re
from urllib.parse import urlparse

import requests

from app.services.ats_adapters import fetch_ats_jobs

logger = logging.getLogger(__name__)

_MIN_DESC = 100
_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
_TIMEOUT = 12


def _strip_html(s: str) -> str:
    """HTML fragment → plain text (unescape entities, drop tags, collapse space)."""
    if not s:
        return ""
    s = _html.unescape(s)
    s = re.sub(r"<\s*(br|/p|/div|/li|/h[1-6])\s*>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"[ \t]+", " ", s)
    return re.sub(r"\n\s*\n\s*\n+", "\n\n", s).strip()


# ── By-URL detail adapters ────────────────────────────────────────────────────
# Each takes a single JD URL and returns its full text via the platform's API /
# detail page, or None. These cover ATS platforms whose LISTING omits the JD
# (so search-side description-preservation can't help): MB Bank lists without
# descriptions, Greenhouse on a custom domain isn't detected by the search
# adapters, and SuccessFactors detail lives on the per-job page.

def _mbbank_detail(jd_url: str) -> str | None:
    m = re.search(r"mbbank\.com\.vn/job/([0-9a-f]{12,})", jd_url, re.I)
    if not m:
        return None
    try:
        r = requests.get(
            f"https://careers.mbbank.com.vn/libra-job-management/public/recruitment-news/{m.group(1)}",
            headers={"User-Agent": _UA, "Accept": "application/json"}, timeout=_TIMEOUT,
        )
        if r.status_code != 200:
            return None
        d = r.json()
    except Exception:
        return None
    if not isinstance(d, dict):
        return None
    fields = [d.get("name"), d.get("missionContent"),
              d.get("jobDescriptionVn") or d.get("jobDescriptionEn"),
              d.get("experienceDescription"), d.get("languageDescription")]
    txt = "\n".join(_strip_html(str(f)) for f in fields if f).strip()
    return txt or None


def _greenhouse_detail(jd_url: str) -> str | None:
    jm = (re.search(r"[?&]gh_jid=(\d+)", jd_url)
          or re.search(r"greenhouse\.io/[^/]+/jobs/(\d+)", jd_url))
    if not jm:
        return None
    jid = jm.group(1)
    bm = re.search(r"greenhouse\.io/(?:embed/job_app\?for=)?([^/?&]+)", jd_url)
    board = bm.group(1) if bm else None
    if not board:  # custom domain (e.g. ogilvy.com?gh_jid=…) → board := host label
        hm = re.search(r"https?://(?:www\.)?([a-z0-9-]+)\.", jd_url)
        board = hm.group(1) if hm else None
    if not board:
        return None
    try:
        r = requests.get(
            f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{jid}",
            headers={"User-Agent": _UA, "Accept": "application/json"}, timeout=_TIMEOUT,
        )
        if r.status_code != 200:
            return None
        d = r.json()
    except Exception:
        return None
    body = _strip_html((d or {}).get("content", ""))
    if len(body) < _MIN_DESC:
        return None
    return f"Job Title: {d.get('title', '')}\n\n{body}".strip()


def _successfactors_detail(jd_url: str) -> str | None:
    if "/job/" not in jd_url:
        return None
    try:
        r = requests.get(jd_url, headers={"User-Agent": _UA}, timeout=_TIMEOUT)
        if r.status_code != 200:
            return None
        h = r.text
    except Exception:
        return None
    # Gate to SuccessFactors pages so we never mis-parse an unrelated /job/ URL.
    if not any(m in h.lower() for m in ("successfactors", "sapsf", "jobdescription", "data-careersite")):
        return None
    m = re.search(r'class="[^"]*jobdescription[^"]*"[^>]*>(.*?)</div>\s*</div>', h, re.S | re.I)
    if not m:
        return None
    body = _strip_html(m.group(1))
    return body or None


_DETAIL_ADAPTERS = (
    ("mbbank", _mbbank_detail),
    ("greenhouse", _greenhouse_detail),
    ("successfactors", _successfactors_detail),
)


def _norm(u: str) -> str:
    """Normalize a URL for matching: host+path, no scheme/query, lowercased."""
    try:
        p = urlparse(u)
        return f"{p.netloc}{p.path}".rstrip("/").lower()
    except Exception:
        return (u or "").rstrip("/").lower()


def _career_root(jd_url: str) -> str | None:
    """The company's career root — some adapters need the listing page, not a JD URL."""
    try:
        p = urlparse(jd_url)
        if p.scheme and p.netloc:
            return f"{p.scheme}://{p.netloc}/"
    except Exception:
        pass
    return None


def _urls_match(target: str, candidate: str) -> bool:
    """Match by exact host+path or either-direction prefix.

    Prefix matching tolerates truncated/normalized IDs and trailing segments
    (e.g. `/recruit/detail/69153f` vs the full `/recruit/detail/69153fe9…`).
    """
    if not candidate:
        return False
    return target == candidate or candidate.startswith(target) or target.startswith(candidate)


def resolve_jd_via_ats(jd_url: str) -> str | None:
    """Return JD text for `jd_url` via a known ATS API, or None on any miss."""
    # Fast path: by-URL detail adapters (single job, one request) for platforms
    # whose listing omits the JD (MB Bank, Greenhouse-custom, SuccessFactors).
    for name, fn in _DETAIL_ADAPTERS:
        try:
            txt = fn(jd_url)
        except Exception as e:  # never break the crawl
            logger.info(f"[jd_resolver:{name}] {jd_url} → {str(e)[:80]}")
            txt = None
        if txt and len(txt) >= _MIN_DESC:
            logger.info(f"[jd_resolver:{name}] resolved {jd_url} ({len(txt)} chars)")
            return txt

    # Try the JD URL itself first (works when the detector keys off the domain,
    # e.g. GHN), then the career root (platforms that need the listing page).
    candidates = [jd_url]
    root = _career_root(jd_url)
    if root and root not in candidates:
        candidates.append(root)

    jobs: list[dict] = []
    for c in candidates:
        try:
            jobs = fetch_ats_jobs(c) or []
        except Exception as e:  # never break the crawl pipeline
            logger.info(f"[jd_resolver] fetch_ats_jobs({c}) failed: {str(e)[:80]}")
            jobs = []
        if jobs:
            break
    if not jobs:
        return None

    target = _norm(jd_url)
    match = next((j for j in jobs if _urls_match(target, _norm(j.get("url", "")))), None)
    if not match:
        return None

    desc = match.get("description", "") or ""
    if len(desc) < _MIN_DESC:
        return None

    title = match.get("title", "")
    loc = match.get("location", "")
    parts = [f"Job Title: {title}" if title else "", f"Location: {loc}" if loc else "", desc]
    text = "\n".join(p for p in parts if p).strip()
    logger.info(f"[jd_resolver] resolved {jd_url} via ATS ({len(text)} chars)")
    return text or None


async def resolve_full_jd(source_url: str, existing: str = "") -> str:
    """Best-effort full JD text for a promoted landing-page snapshot.

    Many stored jobs keep an empty/thin ``description`` — SPA/Phenom/Workday
    listings expose the JD only at apply-time (via the browser extension). A
    public landing page renders server-side, so we must materialize the JD now:
      1. keep the stored description if it's already substantial,
      2. else the ATS detail/listing API (fast, no browser),
      3. else a full crawl (HTTP → Playwright) for SPA career pages.
    Returns the best text found (falls back to ``existing`` on total miss).
    """
    import asyncio

    existing = (existing or "").strip()
    if len(existing) >= 200 or not source_url:
        return existing

    best = existing
    try:
        ats = await asyncio.to_thread(resolve_jd_via_ats, source_url)
        if ats and len(ats) > len(best):
            best = ats
    except Exception as e:  # never break publish
        logger.info(f"[resolve_full_jd] ats miss {source_url}: {str(e)[:80]}")

    if len(best) < 200:
        try:
            from app.services.crawler import crawl_url
            cr = await crawl_url(source_url)
            if cr.cleaned_text and len(cr.cleaned_text) > len(best):
                best = cr.cleaned_text
        except Exception as e:
            logger.info(f"[resolve_full_jd] crawl miss {source_url}: {str(e)[:80]}")

    return best
