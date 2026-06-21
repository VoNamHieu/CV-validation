"""Pull jobs from companies' own ATS via their PUBLIC JSON APIs.

Many career pages are SPA/ATS shells that scraping can't read — but the ATS
(Lever, Greenhouse, Ashby, Recruitee, SmartRecruiters) exposes a free public
JSON feed with full job data incl. descriptions. No API key, no payment. We
detect the ATS from the career URL or from ATS signals embedded in the career
page HTML, then hit its API.

Returns plain dicts: {"title", "url", "location", "description"}.
"""
from __future__ import annotations

import logging
import os
import re
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

_TIMEOUT = 12
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
}


def _get_json(url: str):
    try:
        r = requests.get(url, headers=_HEADERS, timeout=_TIMEOUT)
        if r.status_code == 200 and r.text:
            return r.json()
        logger.info(f"[ats] {url} → HTTP {r.status_code}")
    except Exception as e:
        logger.info(f"[ats] {url} failed: {str(e)[:80]}")
    return None


# ── Detection ───────────────────────────────────────────────────────────────

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


# ── Per-ATS fetchers ──────────────────────────────────────────────────────────

def _strip_html(s: str) -> str:
    if not s:
        return ""
    if "<" in s and ">" in s:
        from bs4 import BeautifulSoup
        return BeautifulSoup(s, "html.parser").get_text(separator="\n", strip=True)
    return s


def _lever(slug: str) -> list[dict]:
    data = _get_json(f"https://api.lever.co/v0/postings/{slug}?mode=json")
    if not isinstance(data, list):  # error responses come back as a dict
        return []
    out = []
    for j in data:
        cats = j.get("categories") or {}
        out.append({
            "title": j.get("text", ""),
            "url": j.get("hostedUrl", ""),
            "location": cats.get("location", "") or "",
            "description": j.get("descriptionPlain") or _strip_html(j.get("description", "")),
        })
    return out


def _greenhouse(slug: str) -> list[dict]:
    data = _get_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true")
    out = []
    for j in (data or {}).get("jobs", []):
        loc = j.get("location") or {}
        out.append({
            "title": j.get("title", ""),
            "url": j.get("absolute_url", ""),
            "location": loc.get("name", "") if isinstance(loc, dict) else "",
            "description": _strip_html(j.get("content", "")),
        })
    return out


def _ashby(slug: str) -> list[dict]:
    data = _get_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}")
    out = []
    for j in (data or {}).get("jobs", []):
        out.append({
            "title": j.get("title", ""),
            "url": j.get("jobUrl", "") or j.get("applyUrl", ""),
            "location": j.get("location", "") or "",
            "description": j.get("descriptionPlain") or _strip_html(j.get("descriptionHtml", "")),
        })
    return out


def _recruitee(slug: str) -> list[dict]:
    data = _get_json(f"https://{slug}.recruitee.com/api/offers/")
    out = []
    for o in (data or {}).get("offers", []):
        out.append({
            "title": o.get("title", ""),
            "url": o.get("careers_url") or o.get("url", ""),
            "location": o.get("city", "") or o.get("location", "") or "",
            "description": _strip_html(o.get("description", "")),
        })
    return out


def _smartrecruiters(slug: str) -> list[dict]:
    data = _get_json(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100")
    out = []
    for j in (data or {}).get("content", []):
        loc = j.get("location") or {}
        jid = j.get("id", "")
        out.append({
            "title": j.get("name", ""),
            "url": f"https://jobs.smartrecruiters.com/{slug}/{jid}" if jid else "",
            "location": loc.get("city", "") if isinstance(loc, dict) else "",
            "description": "",  # SmartRecruiters JD needs a per-posting call; skip for now
        })
    return out


_FETCHERS = {
    "lever": _lever,
    "greenhouse": _greenhouse,
    "ashby": _ashby,
    "recruitee": _recruitee,
    "smartrecruiters": _smartrecruiters,
}


# ── base.vn (a.k.a. talent.vn) — popular VN ATS for banks/retail ──────────────
# Server-renders the full job list as a JSON blob ("openings":[...]) right in the
# page HTML — each opening carries name + content (the JD). No API key, no JS.

import json as _json  # noqa: E402

_HTML_HEADERS = {"User-Agent": _HEADERS["User-Agent"], "Accept": "text/html,*/*"}


def _parse_openings(html: str) -> list:
    """Extract the `openings` JSON array embedded in a base.vn page."""
    i = html.find('"openings":')
    if i < 0:
        return []
    j = html.find("[", i)
    if j < 0:
        return []
    depth = 0
    in_str = esc = False
    for k in range(j, len(html)):
        ch = html[k]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    try:
                        return _json.loads(html[j:k + 1])
                    except Exception:
                        return []
    return []


# ── Workday — dominant enterprise ATS (multinationals). Public cxs JSON API. ──
# Workday's cxs WAF is picky: it 400s the full realistic UA + multi-type Accept.
# A short UA + clean application/json gets through.
_JSON_POST = {"User-Agent": "Mozilla/5.0 Chrome/120", "Accept": "application/json",
              "Content-Type": "application/json"}
_VN_MARKERS = ("vietnam", "viet nam", "việt nam", "hanoi", "ha noi", "hà nội",
               "ho chi minh", "hồ chí minh", "hcmc", "da nang", "đà nẵng",
               "hai phong", "can tho", ", vn")
_WD_RX = re.compile(r"https?://([^.]+)\.(wd\d+)\.myworkdayjobs\.com(/[^?]*)?", re.I)


def _is_vn_loc(loc: str) -> bool:
    l = (loc or "").lower()
    return any(m in l for m in _VN_MARKERS)


def _is_workday(url: str) -> bool:
    return bool(_WD_RX.match(url or ""))


def _workday(career_url: str) -> list[dict]:
    m = _WD_RX.match(career_url)
    if not m:
        return []
    tenant, wd, path = m.group(1), m.group(2), (m.group(3) or "")
    segs = [s for s in path.strip("/").split("/")
            if s and not re.match(r"^[a-z]{2}(-[A-Za-z]{2})?$", s)]
    site = segs[0] if segs else "External"
    base = f"https://{tenant}.{wd}.myworkdayjobs.com"
    cxs = f"{base}/wday/cxs/{tenant}/{site}"
    country = os.getenv("DISCOVER_COUNTRY", "Vietnam")
    out = []
    try:
        # searchText narrows to the country server-side (big global tenants have
        # thousands of jobs); then keep only ones whose location is really VN.
        # NOTE: cxs caps limit at 20 (else HTTP 400).
        r = requests.post(f"{cxs}/jobs", headers=_JSON_POST, timeout=_TIMEOUT,
                          json={"limit": 20, "offset": 0, "searchText": country, "appliedFacets": {}})
        if r.status_code == 200:
            for j in (r.json() or {}).get("jobPostings", []):
                loc = j.get("locationsText", "") or ""
                if not _is_vn_loc(loc):
                    continue
                ext = j.get("externalPath", "") or ""
                out.append({"title": j.get("title", ""), "url": base + ext if ext else base,
                            "location": loc, "description": "", "_ext": ext})
    except Exception as e:
        logger.info(f"[ats] workday {tenant} failed: {str(e)[:80]}")

    # Fetch each VN job's full JD from the cxs detail endpoint (bounded).
    for job in out[:12]:
        ext = job.pop("_ext", "")
        if not ext:
            continue
        try:
            dr = requests.get(f"{cxs}{ext}", headers=_JSON_POST, timeout=_TIMEOUT)
            if dr.status_code == 200:
                info = (dr.json() or {}).get("jobPostingInfo", {})
                job["description"] = _strip_html(info.get("jobDescription", ""))
        except Exception:
            pass
    for job in out:
        job.pop("_ext", None)
    logger.info(f"[ats] workday:{tenant}/{site} → {len(out)} VN jobs")
    return out


# ── SuccessFactors (SAP) Career Site Builder — server-renders job tiles ──────
# No clean JSON API, but /search/ (and the /tile-search-results/ fragment) return
# SSR HTML with <a href="/job/..."> tiles, and each /job/ page is itself SSR — so
# we parse the tiles here and let the normal crawler read the JD from the page.

def _is_successfactors(career_url: str, html: str | None) -> bool:
    if not html:
        return False
    h = html.lower()
    return any(s in h for s in ("successfactors", "sapsf", "data-careersite",
                                "/tile-search-results/", "careersite"))


def _successfactors(career_url: str, html: str | None) -> list[dict]:
    from bs4 import BeautifulSoup
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"
    # No locationsearch: VN-domestic SF sites tag locations as "Hà Nội" etc., so
    # locationsearch=Vietnam returns nothing. Return all tiles; the downstream
    # role/city filter narrows. (Most SF sites in the featured list are VN banks.)
    try:
        r = requests.get(f"{origin}/search/?q=", headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception:
        return []
    out, seen = [], set()
    for a in soup.select('a[href^="/job/"]'):
        href = a.get("href", "")
        title = a.get_text(" ", strip=True)
        if not href or not title or len(title) < 4 or href in seen:
            continue
        seen.add(href)
        out.append({"title": title[:200], "url": origin + href, "location": "", "description": ""})
    logger.info(f"[ats] successfactors → {len(out)} jobs ({origin})")
    return out[:50]


def _is_basevn(career_url: str, html: str | None) -> bool:
    host = (urlparse(career_url).netloc or "").lower()
    if host.endswith(".talent.vn"):
        return True
    return bool(html) and ('base.vn/hiring' in html or '"openings":[' in html)


def _basevn(career_url: str, html: str | None) -> list[dict]:
    if not html:
        try:
            r = requests.get(career_url, headers=_HTML_HEADERS, timeout=_TIMEOUT, allow_redirects=True)
            html = r.text if r.status_code == 200 else ""
            career_url = r.url
        except Exception:
            html = ""
    if not html:
        return []
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"
    out = []
    for o in _parse_openings(html):
        if not isinstance(o, dict):
            continue
        name = (o.get("name") or "").strip()
        code = o.get("codename") or o.get("id") or ""
        if not name or not code:
            continue
        out.append({
            "title": name,
            "url": f"{origin}/job/{code}",
            "location": "",
            "description": _strip_html(o.get("content", "")),
        })
    logger.info(f"[ats] base.vn → {len(out)} jobs ({origin})")
    return out


def fetch_ats_jobs(career_url: str, html: str | None = None) -> list[dict]:
    """Detect the ATS (from URL, then embedded in HTML) and fetch its jobs.
    Returns [] when no ATS is detected or the API yields nothing."""
    # Workday — parse tenant/site from the URL (or a myworkdayjobs URL embedded
    # in the page HTML, e.g. Maersk) and hit its cxs JSON API.
    wd_url = career_url if _is_workday(career_url) else None
    if not wd_url and html:
        # Un-escape JSON-encoded URLs (/ / \/) so embedded Workday links
        # like Maersk's "https://maersk.wd3.myworkdayjobs.com/PT_Careers" match.
        unesc = html.replace("\\u002f", "/").replace("\\u002F", "/").replace("\\/", "/")
        m = re.search(r"https?://[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com/[A-Za-z0-9_\-]+", unesc, re.I)
        if m:
            wd_url = m.group(0)
    if wd_url:
        try:
            jobs = [j for j in _workday(wd_url) if j.get("title") and j.get("url")]
            if jobs:
                return jobs
        except Exception as e:
            logger.info(f"[ats] workday failed for {wd_url}: {str(e)[:80]}")

    # base.vn (talent.vn) parses the page JSON rather than calling a slug API.
    if _is_basevn(career_url, html):
        try:
            jobs = [j for j in _basevn(career_url, html) if j.get("title") and j.get("url")]
            if jobs:
                return jobs
        except Exception as e:
            logger.info(f"[ats] base.vn failed for {career_url}: {str(e)[:80]}")

    # SuccessFactors (SAP) — parse the SSR /search/ job tiles.
    if _is_successfactors(career_url, html):
        try:
            jobs = [j for j in _successfactors(career_url, html) if j.get("title") and j.get("url")]
            if jobs:
                return jobs
        except Exception as e:
            logger.info(f"[ats] successfactors failed for {career_url}: {str(e)[:80]}")

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
    logger.info(f"[ats] {ats}:{slug} → {len(jobs)} jobs ({career_url})")
    return jobs
