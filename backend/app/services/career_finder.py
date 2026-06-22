"""
Career Finder pipeline.

Given a company hint (TopCV company-profile URL, TopCV/VNW job-posting URL, or
free-text company name), discover the company's *own* careers page and the
job postings listed on it — without relying on a search engine.

Pipeline:
    Stage 0   Resolve input → company name + website domain
              (from TopCV/VNW company-profile or job-posting page)
    Stage 1   Parse the homepage <nav>/<footer> for an anchor whose text/URL
              matches careers keywords (Tuyển dụng, Careers, Jobs, ...).
    Stage 2   Brute-force common career paths (/careers, /tuyen-dung, ...)
              on the apex domain and on careers.*, tuyendung.*, jobs.*
              subdomains.
    Stage 3   Read robots.txt → sitemap.xml; pick URLs whose path mentions
              career/job/tuyendung.
    Stage 4   Once a career page is found, list job postings on it (anchor
              + heuristic patterns + LLM fallback).

Every stage is independent and can be invoked alone. The orchestrator runs
Stage 1 → 2 → 3 and stops at the first confirmed hit.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field, asdict
from typing import Optional
from urllib.parse import urlparse, urljoin

import requests
from bs4 import BeautifulSoup

from app.services.crawler import (
    try_http_fetch,
    try_playwright_fetch,
    detect_needs_playwright,
    clean_html,
)
from app.services.url_validator import is_allowed_url
from app.services import company_cache
from app.services.gemini_client import generate_json, search_company_website

logger = logging.getLogger(__name__)


# ── KEYWORDS ──────────────────────────────────────────────────────────────────

# Anchor text / URL slug fragments that signal a career page.
# Lowercase, accent-stripped where possible (we accent-fold before matching).
CAREER_KEYWORDS = (
    "career", "careers",
    "job", "jobs",
    "tuyen dung", "tuyendung",
    "viec lam", "vieclam",
    "co hoi nghe nghiep", "cohoinghnghiep",
    "join us", "joinus",
    "work with us", "workwithus",
    "open positions", "openings",
    "hiring",
)

# Common career path slugs to brute-force when no nav hint is found.
BRUTE_FORCE_PATHS = (
    "/careers", "/career",
    "/jobs", "/job",
    "/tuyen-dung", "/tuyendung",
    "/viec-lam", "/vieclam",
    "/co-hoi-nghe-nghiep",
    "/join-us", "/join", "/work-with-us",
    "/about/careers", "/about/jobs",
    "/en/careers", "/en/jobs",
    "/vi/tuyen-dung",
)

BRUTE_FORCE_SUBDOMAINS = ("careers", "career", "tuyendung", "jobs", "job", "vieclam")

# Skip these hostnames when extracting a "company website" from a TopCV/VNW
# page — they're social/ATS aggregators, not the company's own site.
NON_COMPANY_HOSTS = {
    "facebook.com", "fb.com", "linkedin.com", "instagram.com", "twitter.com",
    "x.com", "youtube.com", "tiktok.com", "zalo.me",
    "topcv.vn", "vietnamworks.com", "careerbuilder.vn", "careerlink.vn",
    "itviec.com", "jobsgo.vn", "timviecnhanh.com", "mywork.com.vn",
    "lever.co", "greenhouse.io", "workday.com", "bamboohr.com",
}


# ── DATA STRUCTURES ───────────────────────────────────────────────────────────

@dataclass
class CompanyResolution:
    """Stage 0 result."""
    company_name: str = ""
    website_url: str = ""        # https://acme.com or https://www.acme.com
    source: str = ""             # "topcv_profile" | "topcv_job" | "vnw_job" | "user_input"
    notes: str = ""


@dataclass
class CareerPage:
    url: str
    method: str                  # "nav" | "brute_force" | "sitemap"
    title: str = ""
    confidence: float = 0.0      # 0..1, set by the discovery stage


@dataclass
class JobListing:
    title: str
    url: str
    location: str = ""


@dataclass
class FinderResult:
    """Full pipeline result."""
    resolution: CompanyResolution = field(default_factory=CompanyResolution)
    career_candidates: list[CareerPage] = field(default_factory=list)
    chosen_career: Optional[CareerPage] = None
    jobs: list[JobListing] = field(default_factory=list)
    stages_run: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "resolution": asdict(self.resolution),
            "career_candidates": [asdict(c) for c in self.career_candidates],
            "chosen_career": asdict(self.chosen_career) if self.chosen_career else None,
            "jobs": [asdict(j) for j in self.jobs],
            "stages_run": self.stages_run,
            "errors": self.errors,
        }


# ── UTIL ──────────────────────────────────────────────────────────────────────

_ACCENT_MAP = str.maketrans(
    "àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ"
    "ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ",
    "aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd"
    "AAAAAAAAAAAAAAAAAEEEEEEEEEEEIIIIIOOOOOOOOOOOOOOOOOUUUUUUUUUUUYYYYYD",
)


def _normalize(s: str) -> str:
    """Lowercase + strip Vietnamese accents for fuzzy keyword matching."""
    return (s or "").translate(_ACCENT_MAP).lower().strip()


def _looks_like_career(text: str, href: str) -> bool:
    """Does anchor text OR href match a career keyword?"""
    norm_text = _normalize(text)
    norm_href = _normalize(href)
    for kw in CAREER_KEYWORDS:
        if kw in norm_text or kw.replace(" ", "") in norm_href:
            return True
    return False


def _apex_url(url: str) -> str:
    """Reduce a URL to its scheme://hostname root (no path)."""
    p = urlparse(url)
    if not p.scheme or not p.hostname:
        return ""
    return f"{p.scheme}://{p.hostname}"


# Multi-label public suffixes. Without these, comparing the last two labels
# would reduce e.g. fpt.com.vn and evil.com.vn both to "com.vn" and treat any
# two .com.vn sites as the SAME domain. Not a full Public Suffix List — just
# the suffixes likely to show up for VN-market companies plus common
# international ones.
_MULTI_LABEL_SUFFIXES = {
    "com.vn", "net.vn", "org.vn", "edu.vn", "gov.vn", "ac.vn", "info.vn",
    "pro.vn", "int.vn", "biz.vn", "name.vn", "health.vn", "id.vn", "io.vn",
    "co.uk", "org.uk", "ac.uk", "gov.uk",
    "com.au", "net.au", "org.au",
    "co.jp", "or.jp", "ne.jp",
    "com.sg", "com.my", "co.id", "co.in", "co.th", "co.kr",
    "com.cn", "com.tw", "com.hk", "com.br", "com.mx",
}


def _registrable_domain(hostname: str) -> str:
    """acme.com.vn → acme.com.vn; sub.acme.com → acme.com; www.acme.com → acme.com."""
    h = (hostname or "").lower().removeprefix("www.").rstrip(".")
    parts = h.split(".")
    if len(parts) >= 3 and ".".join(parts[-2:]) in _MULTI_LABEL_SUFFIXES:
        return ".".join(parts[-3:])
    if len(parts) >= 2:
        return ".".join(parts[-2:])
    return h


def _same_site(host_a: str, host_b: str) -> bool:
    """True iff both hostnames share the same registrable domain."""
    a, b = _registrable_domain(host_a), _registrable_domain(host_b)
    return bool(a) and a == b


# ── STAGE 0: RESOLVE INPUT ────────────────────────────────────────────────────

# href patterns we want to extract from TopCV/VNW company pages.
# These pages typically render the company's homepage as a normal <a> tag
# in the company-info sidebar.
_WEBSITE_LABEL_PATTERNS = (
    re.compile(r"website", re.I),
    re.compile(r"trang\s*web", re.I),
    re.compile(r"trang\s*ch[uủ]", re.I),
)


async def _fetch_html(url: str) -> tuple[bool, str, str]:
    """Fetch with HTTP, fall back to Playwright if needed.
    Returns (ok, html, method)."""
    if not is_allowed_url(url):
        return False, "", "blocked"
    ok, data = try_http_fetch(url)
    if ok and not detect_needs_playwright(data):
        return True, data, "http"
    ok2, data2 = await try_playwright_fetch(url)
    if ok2:
        return True, data2, "playwright"
    if ok:  # http worked but looked thin; return it anyway
        return True, data, "http_thin"
    return False, f"{data} | {data2}", "failed"


def _extract_company_website_from_html(html: str, source_host: str) -> Optional[str]:
    """Look for an external website link inside a TopCV/VNW company page.

    We prefer anchors whose nearby label says "Website" / "Trang web";
    failing that, return the first external link that isn't a social /
    ATS host.
    """
    soup = BeautifulSoup(html, "html.parser")
    labelled_hits: list[str] = []
    fallback_hits: list[str] = []

    for a in soup.find_all("a", href=True):
        href = (a["href"] or "").strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        if not href.lower().startswith(("http://", "https://")):
            continue
        try:
            host = (urlparse(href).hostname or "").lower().removeprefix("www.")
        except Exception:
            continue
        if not host or host == source_host or host in NON_COMPANY_HOSTS:
            continue
        if any(host.endswith("." + s) or host == s for s in NON_COMPANY_HOSTS):
            continue

        # Is the anchor adjacent to a "Website" label?
        parent_text = " ".join((a.parent.stripped_strings if a.parent else []))[:200]
        anchor_text = a.get_text(" ", strip=True)
        if any(p.search(parent_text) or p.search(anchor_text) for p in _WEBSITE_LABEL_PATTERNS):
            labelled_hits.append(href)
        else:
            fallback_hits.append(href)

    if labelled_hits:
        return labelled_hits[0]
    if fallback_hits:
        # Heuristic: prefer shorter URLs (probably the homepage, not a deep link).
        return sorted(fallback_hits, key=len)[0]
    return None


async def resolve_from_topcv_or_vnw(url: str, *, use_cache: bool = True) -> CompanyResolution:
    """Stage 0a: input is a TopCV/VNW URL — scrape it for company name + website.

    On hit, skips the HTTP/Playwright fetch entirely. On miss, scrapes
    upstream and upserts the result so future calls are O(1).
    """
    if use_cache:
        cached = await company_cache.aget_by_source_url(url)
        if cached and cached.website_url:
            logger.info(f"[cache] HIT source_url={url} (age={cached.age_seconds}s)")
            return CompanyResolution(
                company_name=cached.name,
                website_url=cached.website_url,
                source=cached.source or "cache",
                notes=f"cache_hit age={cached.age_seconds}s",
            )

    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    ok, html, _ = await _fetch_html(url)
    if not ok:
        return CompanyResolution(notes=f"fetch failed: {html[:200]}")

    soup = BeautifulSoup(html, "html.parser")

    # Company name: try og:site_name, og:title, h1, then <title>.
    name = ""
    for sel in (
        ('meta', {"property": "og:site_name"}),
        ('meta', {"property": "og:title"}),
    ):
        tag = soup.find(*sel)
        if tag and tag.get("content"):
            name = tag["content"].strip()
            break
    if not name:
        h1 = soup.find("h1")
        if h1:
            name = h1.get_text(strip=True)
    if not name:
        title = soup.find("title")
        if title:
            name = title.get_text(strip=True)

    # On a TopCV job-posting page, the company name often appears as the second
    # heading; on a profile page it's the h1. Either way, strip the boilerplate.
    name = re.sub(r"\s*[\|\-–]\s*(TopCV|VietnamWorks).*$", "", name, flags=re.I).strip()

    website = _extract_company_website_from_html(html, host)
    if website:
        source = "topcv_profile" if "/cong-ty/" in url else "topcv_job" if "topcv.vn" in host else "vnw_job"
        resolution = CompanyResolution(company_name=name, website_url=website, source=source)
        if use_cache:
            try:
                await company_cache.aupsert(
                    name=name, website_url=website, source=source, source_url=url
                )
                logger.info(f"[cache] STORED source_url={url} → {website}")
            except Exception as e:
                logger.warning(f"[cache] upsert failed: {e}")
        return resolution

    # Negative result — also cache it so we don't re-scrape a known-bad URL on
    # every request. TTL still applies, so it'll get retried eventually.
    source = "topcv_profile" if "/cong-ty/" in url else "topcv_job"
    resolution = CompanyResolution(
        company_name=name,
        notes="company website not found on the page",
        source=source,
    )
    if use_cache and name:
        try:
            await company_cache.aupsert(
                name=name, website_url="", source=source, source_url=url,
                notes="no_website_found",
            )
        except Exception as e:
            logger.warning(f"[cache] negative upsert failed: {e}")
    return resolution


async def _probe_url_reachable(url: str, timeout: float = 8.0) -> bool:
    """HEAD-then-GET check that a URL responds 2xx/3xx.

    HEAD often gets blocked or 405'd on edge providers; if it's not a clear
    success we fall back to a GET with redirects so we can confirm the
    homepage actually resolves before we trust the LLM's URL pick.
    """
    if not is_allowed_url(url):
        return False
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        r = await asyncio.to_thread(
            requests.head, url, allow_redirects=True, timeout=timeout, headers=headers,
        )
        if r.status_code < 400:
            return True
        if r.status_code != 405:
            return False
    except Exception:
        pass
    try:
        r = await asyncio.to_thread(
            requests.get, url, allow_redirects=True, timeout=timeout, headers=headers,
        )
        return r.status_code < 400
    except Exception:
        return False


async def resolve_by_name(name: str, *, use_cache: bool = True) -> CompanyResolution:
    """Stage 0b: free-text company name → cache → Gemini grounded search.

    1. Cache lookup (fast path, O(1) after first resolve).
    2. Cache miss → Gemini grounded search (google_search tool) to discover
       the company's homepage.
    3. Validate the returned URL: reject blacklisted hosts (LinkedIn, FB,
       TopCV...), confirm it actually resolves over HTTP.
    4. Upsert into the cache so future lookups skip the LLM call.
    """
    if not name or not name.strip():
        return CompanyResolution(notes="empty name")

    if use_cache:
        cached = await company_cache.aget_by_name(name)
        if cached and cached.website_url:
            logger.info(f"[cache] HIT name={name!r}")
            return CompanyResolution(
                company_name=cached.name,
                website_url=cached.website_url,
                source=cached.source or "cache",
                notes=f"cache_hit age={cached.age_seconds}s",
            )

    logger.info(f"[gemini_search] cache miss for {name!r} — calling grounded search")
    search_result = await asyncio.to_thread(search_company_website, name)
    url = (search_result.get("url") or "").strip()
    conf = search_result.get("confidence", "none")
    sources = search_result.get("sources", []) or []
    search_notes = search_result.get("notes", "")

    if not url:
        return CompanyResolution(
            company_name=name,
            source="grounded_search",
            notes=f"grounded search returned no URL (confidence={conf}, {search_notes})".strip(),
        )

    # Reject blacklisted hosts up front — Gemini sometimes returns LinkedIn
    # despite the prompt telling it not to.
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if not host:
        return CompanyResolution(
            company_name=name, source="grounded_search",
            notes=f"grounded search returned URL with no host: {url}",
        )
    if host in NON_COMPANY_HOSTS or any(host.endswith("." + s) or host == s for s in NON_COMPANY_HOSTS):
        return CompanyResolution(
            company_name=name, source="grounded_search",
            notes=f"grounded search returned blacklisted host: {host}",
        )

    if not await _probe_url_reachable(url):
        return CompanyResolution(
            company_name=name, source="grounded_search",
            notes=f"grounded search URL not reachable: {url}",
        )

    homepage = _apex_url(url) or url

    if use_cache:
        # source_url has a UNIQUE constraint; use a synthetic, normalized key
        # so re-resolves for the same name upsert in place instead of stacking.
        synthetic_source = f"name:{company_cache.normalize_name(name)}"
        try:
            await company_cache.aupsert(
                name=name,
                website_url=homepage,
                source="grounded_search",
                source_url=synthetic_source,
                notes=("confidence=" + conf
                       + (" sources=" + ",".join(sources[:3]) if sources else "")),
            )
            logger.info(f"[cache] STORED name={name!r} → {homepage}")
        except Exception as e:
            logger.warning(f"[cache] upsert failed for name={name!r}: {e}")

    return CompanyResolution(
        company_name=name,
        website_url=homepage,
        source="grounded_search",
        notes=f"confidence={conf}",
    )


# ── STAGE 1: NAV PARSE ────────────────────────────────────────────────────────

async def find_career_via_nav(homepage_url: str) -> list[CareerPage]:
    """Stage 1: fetch the homepage and look in <nav>/<header>/<footer> for
    anchors whose text or URL signals a career page.

    Returns ranked candidates (high-confidence first). Empty list = no hit.
    """
    ok, html, _method = await _fetch_html(homepage_url)
    if not ok:
        return []

    soup = BeautifulSoup(html, "html.parser")
    base = _apex_url(homepage_url)
    if not base:
        return []

    hits: list[CareerPage] = []
    seen: set[str] = set()

    # Prefer matches inside nav/header/footer (less noisy than the whole body).
    region_priority = [
        (soup.find("nav"), 0.95),
        (soup.find("header"), 0.85),
        (soup.find("footer"), 0.75),
        (soup, 0.55),  # whole document, lowest confidence
    ]

    for region, conf in region_priority:
        if region is None:
            continue
        for a in region.find_all("a", href=True):
            href = (a["href"] or "").strip()
            text = a.get_text(" ", strip=True)
            if not href or not _looks_like_career(text, href):
                continue
            full = urljoin(base + "/", href)
            if not is_allowed_url(full):
                continue
            # Stay on the same registrable domain.
            target_host = (urlparse(full).hostname or "").lower().removeprefix("www.")
            base_host = (urlparse(base).hostname or "").lower().removeprefix("www.")
            if not _same_site(target_host, base_host):
                continue
            if full in seen:
                continue
            seen.add(full)
            hits.append(CareerPage(url=full, method="nav", title=text[:120], confidence=conf))

    hits.sort(key=lambda c: c.confidence, reverse=True)
    return hits


# ── STAGE 2: BRUTE-FORCE PATHS ────────────────────────────────────────────────

def _is_careerish_html(html: str) -> tuple[bool, float]:
    """Does the response look like a real career page (vs. a 200 OK SPA shell
    or a soft-404)?

    Returns (looks_career, confidence). Confidence is rough: counts how many
    career keywords appear in the visible body.
    """
    if not html or len(html) < 800:
        return False, 0.0
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = _normalize(soup.get_text(" ", strip=True))
    if not text:
        return False, 0.0
    hits = sum(text.count(_normalize(kw)) for kw in CAREER_KEYWORDS)
    # Soft-404 detection: many "page not found" hits also serve 200s.
    if any(p in text for p in ("page not found", "khong tim thay", "404")):
        return False, 0.0
    confidence = min(1.0, hits / 5.0)
    return hits >= 2, confidence


async def _probe_path(url: str) -> Optional[CareerPage]:
    """HEAD-then-GET probe for a candidate career URL.
    Returns a CareerPage iff the response body looks like a real career page.
    """
    if not is_allowed_url(url):
        return None
    try:
        # Cheap HEAD first — many sites 404 fast on the path.
        r = await asyncio.to_thread(
            requests.head, url, allow_redirects=True, timeout=8,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        if r.status_code >= 400:
            return None
    except Exception:
        return None

    ok, html, _ = await _fetch_html(url)
    if not ok:
        return None
    looks, conf = _is_careerish_html(html)
    if not looks:
        return None
    # Extract a title for display.
    soup = BeautifulSoup(html, "html.parser")
    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True)[:120] if title_tag else url
    return CareerPage(url=url, method="brute_force", title=title, confidence=conf)


async def brute_force_career_paths(homepage_url: str) -> list[CareerPage]:
    """Stage 2: try common career paths in parallel.

    Probes both the apex domain (paths) and known career subdomains.
    """
    parsed = urlparse(homepage_url)
    if not parsed.hostname:
        return []
    apex_host = parsed.hostname.lower().removeprefix("www.")
    scheme = parsed.scheme or "https"

    candidates: list[str] = []
    for path in BRUTE_FORCE_PATHS:
        candidates.append(f"{scheme}://{apex_host}{path}")
    for sub in BRUTE_FORCE_SUBDOMAINS:
        candidates.append(f"{scheme}://{sub}.{apex_host}/")

    results = await asyncio.gather(*[_probe_path(u) for u in candidates], return_exceptions=True)
    hits: list[CareerPage] = []
    seen: set[str] = set()
    for r in results:
        if isinstance(r, CareerPage) and r.url not in seen:
            seen.add(r.url)
            hits.append(r)
    hits.sort(key=lambda c: c.confidence, reverse=True)
    return hits


# ── STAGE 3: SITEMAP ──────────────────────────────────────────────────────────

_SITEMAP_RE = re.compile(r"(?im)^\s*sitemap:\s*(\S+)\s*$")


async def _fetch_text(url: str, timeout: int = 10) -> Optional[str]:
    if not is_allowed_url(url):
        return None
    try:
        r = await asyncio.to_thread(
            requests.get, url, timeout=timeout,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        if r.status_code == 200 and r.text:
            return r.text
    except Exception:
        return None
    return None


def _is_careerish_url(url: str) -> bool:
    norm = _normalize(url)
    return any(kw.replace(" ", "") in norm for kw in CAREER_KEYWORDS)


async def find_via_sitemap(homepage_url: str, max_sitemaps: int = 5) -> list[CareerPage]:
    """Stage 3: read robots.txt → sitemap(s) → URLs whose path mentions
    career/job/tuyendung.

    Sitemap indexes are followed one level deep (up to `max_sitemaps` files
    fetched total) so we don't fan out across hundreds of shards.
    """
    parsed = urlparse(homepage_url)
    if not parsed.hostname:
        return []
    base = f"{parsed.scheme or 'https'}://{parsed.hostname}"

    sitemap_urls: list[str] = []

    robots = await _fetch_text(f"{base}/robots.txt")
    if robots:
        sitemap_urls.extend(m.strip() for m in _SITEMAP_RE.findall(robots))
    if not sitemap_urls:
        sitemap_urls = [f"{base}/sitemap.xml"]

    seen_sitemaps: set[str] = set()
    discovered: dict[str, str] = {}  # url → title (empty if not in <url><lastmod>)
    fetched = 0

    queue = list(sitemap_urls)
    while queue and fetched < max_sitemaps:
        sm_url = queue.pop(0)
        if sm_url in seen_sitemaps:
            continue
        seen_sitemaps.add(sm_url)
        body = await _fetch_text(sm_url, timeout=15)
        fetched += 1
        if not body:
            continue
        # Sitemap-index? has <sitemap><loc>…
        for m in re.finditer(r"<sitemap>\s*<loc>([^<]+)</loc>", body, re.I):
            queue.append(m.group(1).strip())
        # Regular sitemap with <url><loc>…
        for m in re.finditer(r"<url[^>]*>.*?<loc>([^<]+)</loc>", body, re.I | re.S):
            u = m.group(1).strip()
            if _is_careerish_url(u):
                discovered[u] = ""

    if not discovered:
        return []

    # Probe the most-promising candidates — cap to keep this cheap.
    results = await asyncio.gather(
        *[_probe_path(u) for u in list(discovered)[:20]],
        return_exceptions=True,
    )
    hits: list[CareerPage] = []
    seen: set[str] = set()
    for r in results:
        if isinstance(r, CareerPage) and r.url not in seen:
            seen.add(r.url)
            r.method = "sitemap"
            hits.append(r)
    hits.sort(key=lambda c: c.confidence, reverse=True)
    return hits


# ── STAGE 4: LIST JOBS ON CAREER PAGE ─────────────────────────────────────────

# Anchor patterns that look like a single job posting.
_JOB_URL_PATTERNS = (
    re.compile(r"/job[s]?/[A-Za-z0-9\-_/]+", re.I),
    re.compile(r"/career[s]?/[A-Za-z0-9\-_/]+\d", re.I),
    re.compile(r"/tuyen-dung/[A-Za-z0-9\-]+", re.I),
    re.compile(r"/viec-lam/[A-Za-z0-9\-]+", re.I),
    re.compile(r"/positions?/[A-Za-z0-9\-_/]+", re.I),
    re.compile(r"/openings?/[A-Za-z0-9\-_/]+", re.I),
    re.compile(r"/ung-tuyen/[A-Za-z0-9\-/]+", re.I),
    re.compile(r"/vi-tri/[A-Za-z0-9\-]+", re.I),
    re.compile(r"/cong-viec/[A-Za-z0-9\-]+", re.I),
    re.compile(r"/recruit(?:ment)?/[A-Za-z0-9\-]+", re.I),
)


# If the anchor heuristic returns fewer than this many jobs, fall back to the
# LLM extractor. SPA career pages often render the job grid client-side with
# anchors that don't match the path patterns above; the LLM gets the cleaned
# text + a link inventory and picks out real postings.
_MIN_JOBS_BEFORE_LLM = 3
# Max postings kept per company (big employers — banks, groups — list 100+).
_MAX_JOBS = 100

# Generic CTA / navigation anchor texts that should never be treated as jobs.
_CTA_BLACKLIST = {
    "apply", "view", "details", "learn more", "more", "see more",
    "see all", "view all", "all jobs", "all positions", "apply now",
    "read more", "find out more", "tim hieu them", "xem them", "xem tat ca",
    "ung tuyen", "ung tuyen ngay",
    "xem chi tiet", "chi tiet", "video", "tin tuc", "dang ky", "dang ky ngay",
    "nop don", "nop ho so", "view detail", "view details", "kham pha",
    # listing-page nav/section headings (not jobs)
    "tuyen dung", "viec lam", "co hoi nghe nghiep", "co hoi viec lam",
    "quy trinh tuyen dung", "job search", "search jobs", "tat ca viec lam",
    "vi sao nen gia nhap", "moi truong lam viec", "phuc loi", "van hoa",
}

# Substrings that mark an anchor as an info/nav page, never a job posting.
# (Checked against accent-stripped text, so it catches "Chính sách tuyển dụng",
# "Tài liệu tuyển dụng", "Tin tức - Hoạt động", "Xem toàn bộ tin", …)
_NAV_TITLE_RX = re.compile(
    r"chinh sach|tai lieu|chuong trinh|tin tuc|hoat dong|gioi thieu|lien he|"
    r"ve chung toi|phuc loi|cau hoi|faq|quy che|so do|xem toan bo|cam nang|"
    r"quy trinh|moi truong lam viec|van hoa|vi sao|saved job|talent pool|"
    r"drop cv|gioi thieu chung",
    re.I,
)

# Anchor text that is just a location (some cards use the location as link text;
# the real title lives in the URL slug). Normalized, accent-stripped.
_LOCATION_ONLY = {
    "toan quoc", "ha noi", "hanoi", "ho chi minh", "tp ho chi minh",
    "tphcm", "hcm", "sai gon", "da nang", "hai phong", "can tho",
    "binh duong", "dong nai", "mien bac", "mien nam", "mien trung",
    "remote", "vietnam", "viet nam", "nationwide",
}


def _deslug(path: str) -> str:
    """Turn the last meaningful path segment into a human title, e.g.
    '/ung-tuyen/.../senior-it-business-analyst/' → 'Senior It Business Analyst'.
    Returns '' when the segment is a single word, numeric, or a known listing
    keyword (so we don't fabricate junk titles)."""
    segs = [s for s in (path or "").strip("/").split("/") if s]
    if not segs:
        return ""
    last = re.sub(r"\.(html?|aspx?|php|jsp)$", "", segs[-1], flags=re.I)
    words = [w for w in re.split(r"[-_]+", last) if w]
    if len(words) < 2 or last.isdigit():
        return ""
    if _normalize(last.replace("-", " ")) in _CTA_BLACKLIST:
        return ""
    return " ".join(words).title()


def _collect_link_candidates(html: str, base: str) -> list[dict]:
    """Build a compact `[{url, text}]` inventory of internal anchors on the
    career page — used as input to the LLM fallback.

    We drop nav/CTA/social/external links so the prompt stays small and the
    LLM has a cleaner search space.
    """
    soup = BeautifulSoup(html, "html.parser")
    base_host = (urlparse(base).hostname or "").lower().removeprefix("www.")

    seen: set[str] = set()
    candidates: list[dict] = []
    for a in soup.find_all("a", href=True):
        href = (a["href"] or "").strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        full = urljoin(base + "/", href)
        try:
            parsed = urlparse(full)
        except Exception:
            continue
        host = (parsed.hostname or "").lower().removeprefix("www.")
        if not host or host in NON_COMPANY_HOSTS:
            continue
        # Stay on the same registrable domain (allow career subdomains).
        if not _same_site(host, base_host):
            continue
        if not parsed.path or parsed.path == "/":
            continue
        if full in seen:
            continue
        text = a.get_text(" ", strip=True)
        norm = _normalize(text)
        if not text or norm in _CTA_BLACKLIST or _NAV_TITLE_RX.search(norm):
            continue
        seen.add(full)
        candidates.append({"url": full, "text": text[:160]})
        if len(candidates) >= 120:
            break
    return candidates


async def _extract_jobs_via_llm(
    career_url: str, html: str, candidates: list[dict]
) -> list[JobListing]:
    """LLM fallback for Stage 4. Asks Gemini to pick which links from the
    candidate inventory are real job postings and to title them properly.

    The LLM may NOT invent URLs — we validate every returned URL against
    the candidate list.
    """
    if not candidates:
        return []

    # Trim the page text so the prompt stays cheap. The link list carries
    # most of the useful signal; the text just helps disambiguate.
    page_text = clean_html(html)[:6000]
    link_list = "\n".join(
        f"{i+1}. {c['url']}  |  {c['text']}"
        for i, c in enumerate(candidates)
    )

    prompt = f"""You are extracting job postings from a company's careers page.

CAREER PAGE URL: {career_url}

Below is the page text followed by a numbered list of every internal link on the page.
Your task: pick the links that go to a SPECIFIC job opening (e.g. "Senior Backend Engineer", "Marketing Intern") — NOT navigation, NOT "View all jobs", NOT generic categories like "Engineering" or "Sales".

PAGE TEXT (truncated):
{page_text}

LINKS:
{link_list}

Return a JSON object: {{"jobs": [{{"url": "<exact url from the list above>", "title": "<role title>", "location": "<city if visible, else empty string>"}}]}}

Rules:
- url MUST be copied verbatim from the LINKS list above. Do NOT invent or modify URLs.
- title is the role name as it appears, with leading/trailing whitespace stripped.
- If no real job postings are visible, return {{"jobs": []}}.
- Cap at 50 jobs."""

    try:
        raw = await asyncio.to_thread(
            generate_json,
            "You extract individual job-posting links from a careers page. Always return JSON.",
            prompt,
        )
        parsed = json.loads(raw.strip())
    except Exception as e:
        logger.warning(f"[llm_jobs] failed: {e}")
        return []

    jobs_field = parsed.get("jobs") if isinstance(parsed, dict) else parsed
    if not isinstance(jobs_field, list):
        return []

    candidate_urls = {c["url"] for c in candidates}
    results: list[JobListing] = []
    seen: set[str] = set()
    for item in jobs_field:
        if not isinstance(item, dict):
            continue
        url = (item.get("url") or "").strip()
        title = (item.get("title") or "").strip()
        location = (item.get("location") or "").strip()
        if not url or url not in candidate_urls or url in seen:
            continue
        if not title or len(title) < 3:
            continue
        seen.add(url)
        results.append(JobListing(title=title[:200], url=url, location=location[:120]))
        if len(results) >= _MAX_JOBS:
            break
    logger.info(f"[llm_jobs] LLM picked {len(results)} jobs from {len(candidates)} candidates")
    return results


async def extract_jobs_from_career_page(career_url: str, _depth: int = 0) -> list[JobListing]:
    """Stage 4: list job postings on the discovered career page.

    Strategy:
      1. Heuristic: anchors whose href matches a job-posting URL pattern.
      2. If the heuristic returns < _MIN_JOBS_BEFORE_LLM jobs (common on SPA
         career pages that don't follow URL conventions), ask the LLM to pick
         job links out of the candidate inventory. The LLM may not invent URLs.
      3. If still empty, follow a "view all jobs / job search" link from the page
         (many career_urls point at a marketing landing, not the listing).
    """
    import asyncio as _asyncio
    from app.services.ats_adapters import fetch_ats_jobs

    def _as_listings(ats_jobs):
        return [
            JobListing(title=j["title"][:200], url=j["url"], location=(j.get("location") or "")[:120])
            for j in ats_jobs[:_MAX_JOBS]
        ]

    # Fast path 1: career URL is itself a known ATS host → hit its public JSON
    # API directly, no page fetch (avoids slow SPA renders entirely).
    try:
        ats_jobs = await _asyncio.to_thread(fetch_ats_jobs, career_url, None)
        if ats_jobs:
            return _as_listings(ats_jobs)
    except Exception as e:
        logger.info(f"[stage4] ATS(url) skipped for {career_url}: {e}")

    ok, html, _ = await _fetch_html(career_url)
    if not ok:
        return []

    # Fast path 2: the career page EMBEDS an ATS (iframe/script) → use its API.
    try:
        ats_jobs = await _asyncio.to_thread(fetch_ats_jobs, career_url, html)
        if ats_jobs:
            return _as_listings(ats_jobs)
    except Exception as e:
        logger.info(f"[stage4] ATS(html) skipped for {career_url}: {e}")

    # Fast path 3: Phenom People (no clean API) — render + read its job tiles.
    if any(s in html.lower() for s in ("phenompeople", "data-ph-id", "phapp.ddo")):
        try:
            from app.services.spa_sniff import phenom_jobs
            ph = await phenom_jobs(career_url)
            if ph:
                return [JobListing(title=j["title"][:200], url=j["url"],
                                   location=(j.get("location") or "")[:120]) for j in ph[:_MAX_JOBS]]
        except Exception as e:
            logger.info(f"[stage4] Phenom extract skipped for {career_url}: {e}")

    soup = BeautifulSoup(html, "html.parser")
    base = _apex_url(career_url) or career_url

    seen: set[str] = set()
    jobs: list[JobListing] = []
    for a in soup.find_all("a", href=True):
        href = (a["href"] or "").strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        full = urljoin(base + "/", href)
        path = urlparse(full).path
        if not any(p.search(path) for p in _JOB_URL_PATTERNS):
            continue
        if full in seen:
            continue
        text = a.get_text(" ", strip=True)
        ntext = _normalize(text)
        title = text
        # Some cards use the location (or nothing) as the link text; recover the
        # real title from the URL slug in that case.
        if len(text) < 4 or ntext in _CTA_BLACKLIST or ntext in _LOCATION_ONLY:
            slug_title = _deslug(path)
            if not slug_title:
                continue
            title = slug_title
        ntitle = _normalize(title)
        if len(title) < 4 or ntitle in _CTA_BLACKLIST or _NAV_TITLE_RX.search(ntitle):
            continue
        seen.add(full)
        jobs.append(JobListing(title=title[:200], url=full))
        if len(jobs) >= _MAX_JOBS:
            break

    if len(jobs) >= _MIN_JOBS_BEFORE_LLM:
        return jobs

    logger.info(
        f"[stage4] heuristic found {len(jobs)} jobs on {career_url} — "
        f"trying LLM fallback"
    )
    candidates = _collect_link_candidates(html, base)
    llm_jobs = await _extract_jobs_via_llm(career_url, html, candidates)

    # Merge: keep heuristic hits first, dedupe against LLM picks.
    merged_urls = {j.url for j in jobs}
    for lj in llm_jobs:
        if lj.url not in merged_urls:
            jobs.append(lj)
            merged_urls.add(lj.url)

    # Few/no hits: a custom SPA whose jobs come from an internal JSON API or are
    # rendered as cards the static heuristic can't read. Render + sniff. (Run
    # even with 1-2 weak hits — those are often nav noise like "Video".)
    if len(jobs) < _MIN_JOBS_BEFORE_LLM:
        try:
            from app.services.spa_sniff import sniff_jobs
            sniffed = await sniff_jobs(career_url)
            if len(sniffed) > len(jobs):  # sniff found a real listing → prefer it
                jobs = [JobListing(title=s["title"][:200], url=s["url"],
                                   location=(s.get("location") or "")[:120])
                        for s in sniffed[:_MAX_JOBS]]
        except Exception as e:
            logger.info(f"[stage4] SPA sniff failed for {career_url}: {e}")

    # Still nothing + we're on the first hop → the career_url may be a marketing
    # landing. Follow its "view all jobs / job search" link once and retry.
    if not jobs and _depth == 0:
        listing = _find_listing_link(soup, base, career_url)
        if listing:
            logger.info(f"[stage4] no jobs on {career_url} — following listing link {listing}")
            return await extract_jobs_from_career_page(listing, _depth=1)
    return jobs


# Anchor text/href that signals a "see all openings / job search" listing page.
_LISTING_HREF_RX = re.compile(
    r"(all-?jobs|view-?all|job-?search|search-?jobs?|job-?list|tim-kiem-viec|viec-lam|"
    r"tuyen-dung|vacanc|openings?|/positions?|/jobs?(/|$|\?))", re.I)
_LISTING_TEXT_RX = re.compile(
    r"(all jobs|view all|search jobs?|job search|all openings?|see (all )?(jobs|openings)|"
    r"tất cả|tìm việc|tìm kiếm việc|việc làm|vị trí (đang )?tuyển|xem (tất cả|thêm))", re.I)


def _find_listing_link(soup, base: str, current_url: str) -> Optional[str]:
    """Pick the best 'all jobs / job search' link on a landing page."""
    cur = current_url.rstrip("/")
    best = None
    best_score = 0
    cur_host = urlparse(current_url).netloc
    for a in soup.find_all("a", href=True):
        href = (a["href"] or "").strip()
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        full = urljoin(base + "/", href)
        if full.rstrip("/") == cur or urlparse(full).netloc != cur_host:
            continue
        text = a.get_text(" ", strip=True)
        score = 0
        if _LISTING_HREF_RX.search(urlparse(full).path):
            score += 2
        if text and _LISTING_TEXT_RX.search(text):
            score += 2
        # prefer explicit "all/search" over a single job link
        if re.search(r"(all|search|list|tim-kiem|tất cả|tìm)", (full + " " + text), re.I):
            score += 1
        if score > best_score:
            best_score, best = score, full
    return best if best_score >= 2 else None


# ── ORCHESTRATOR ──────────────────────────────────────────────────────────────

async def find_careers(input_url: Optional[str] = None,
                       company_name: Optional[str] = None,
                       homepage_url: Optional[str] = None) -> FinderResult:
    """Run the full pipeline.

    Exactly one of:
      - input_url: a TopCV/VNW URL (company profile or job posting)
      - homepage_url: the company's own website (skips Stage 0)
      - company_name: free-text name (Stage 0 will *not* search engines —
        the caller must supply a homepage_url for that case; we just record
        the name and let the user provide a domain in a follow-up)
    """
    result = FinderResult()

    # ── Stage 0: resolve to (name, website) ──
    if homepage_url:
        result.resolution = CompanyResolution(
            company_name=company_name or "",
            website_url=homepage_url,
            source="user_input",
        )
        result.stages_run.append("stage0:user_input")
    elif input_url:
        result.stages_run.append("stage0:topcv_vnw_scrape")
        result.resolution = await resolve_from_topcv_or_vnw(input_url)
        if not result.resolution.website_url:
            result.errors.append("Could not resolve company website from the input URL.")
            return result
    elif company_name:
        result.stages_run.append("stage0:resolve_by_name")
        result.resolution = await resolve_by_name(company_name)
        if not result.resolution.website_url:
            result.errors.append(
                f"Could not resolve company website for {company_name!r}: "
                f"{result.resolution.notes or 'unknown'}"
            )
            return result
    else:
        result.errors.append("Need input_url, homepage_url, or company_name.")
        return result

    homepage = _apex_url(result.resolution.website_url) or result.resolution.website_url

    # ── Stage 1: nav parse ──
    result.stages_run.append("stage1:nav")
    nav_hits = await find_career_via_nav(homepage)
    result.career_candidates.extend(nav_hits)

    # ── Stage 2: brute-force ──
    if not nav_hits:
        result.stages_run.append("stage2:brute_force")
        bf_hits = await brute_force_career_paths(homepage)
        result.career_candidates.extend(bf_hits)

    # ── Stage 3: sitemap ──
    if not result.career_candidates:
        result.stages_run.append("stage3:sitemap")
        sm_hits = await find_via_sitemap(homepage)
        result.career_candidates.extend(sm_hits)

    if not result.career_candidates:
        result.errors.append("No career page found across nav / brute-force / sitemap.")
        return result

    # Pick the highest-confidence candidate.
    result.chosen_career = max(result.career_candidates, key=lambda c: c.confidence)

    # ── Stage 4: list jobs ──
    result.stages_run.append("stage4:list_jobs")
    result.jobs = await extract_jobs_from_career_page(result.chosen_career.url)
    return result
