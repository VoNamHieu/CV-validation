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
from urllib.parse import urljoin, urlparse

import requests

logger = logging.getLogger(__name__)

_TIMEOUT = 12
_MAX_ATS_JOBS = 100   # per-company cap across all adapters
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
    # searchText narrows to the country server-side (big global tenants have
    # thousands of jobs); then keep only ones whose location is really VN. The
    # cxs API caps limit at 20 (else HTTP 400), so paginate by offset to get
    # tenants with >20 VN postings (e.g. Prudential).
    for offset in (0, 20, 40, 60):
        try:
            r = requests.post(f"{cxs}/jobs", headers=_JSON_POST, timeout=_TIMEOUT,
                              json={"limit": 20, "offset": offset, "searchText": country,
                                    "appliedFacets": {}})
            if r.status_code != 200:
                break
            postings = (r.json() or {}).get("jobPostings", []) or []
            if not postings:
                break
            for j in postings:
                loc = j.get("locationsText", "") or ""
                if not _is_vn_loc(loc):
                    continue
                ext = j.get("externalPath", "") or ""
                out.append({"title": j.get("title", ""), "url": base + ext if ext else base,
                            "location": loc, "description": "", "_ext": ext})
            if len(postings) < 20 or len(out) >= _MAX_ATS_JOBS:
                break
        except Exception as e:
            logger.info(f"[ats] workday {tenant} offset {offset} failed: {str(e)[:80]}")
            break

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


# ── Eightfold AI ("pcsx") — Microsoft, NVIDIA, etc. ─────────────────────────
# Public GET JSON: /api/pcsx/search?domain=<registrable-domain>&location=<loc>.
# Response: {"data": {"positions": [{name, locations[], id, positionUrl, ...}]}}.
# Job detail page = /careers?pid=<id>&domain=<domain>. The `domain` param is the
# tenant's registrable domain (microsoft.com, nvidia.com), derivable from host.
_EIGHTFOLD_MARKERS = ("eightfold", "/api/pcsx/", '"pcsx"', "pcsx/search")


def _is_eightfold(career_url: str, html: str | None) -> bool:
    if html and any(m in html.lower() for m in _EIGHTFOLD_MARKERS):
        return True
    host = (urlparse(career_url).netloc or "").lower()
    return host.startswith("apply.careers.") or host.startswith("jobs.") and "/careers" in (career_url or "")


def _registrable_domain(host: str) -> str:
    host = (host or "").lower().split(":")[0]
    parts = host.split(".")
    # handle 2-level public suffixes (.com.vn, .co.uk) → keep 3 labels
    if len(parts) >= 3 and parts[-2] in ("com", "co", "net", "org", "edu", "gov"):
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def _eightfold(career_url: str) -> list[dict]:
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"
    domain = _registrable_domain(p.netloc)
    country = os.getenv("DISCOVER_COUNTRY", "Vietnam")
    out, seen = [], set()
    for start in (0, 10, 20):
        try:
            r = requests.get(f"{origin}/api/pcsx/search", headers=_JSON_POST, timeout=_TIMEOUT,
                             params={"domain": domain, "query": "", "location": country,
                                     "start": start, "sort_by": "relevance", "num": 10})
            if r.status_code != 200:
                break
            data = (r.json() or {}).get("data", {}) or {}
            positions = data.get("positions", []) or []
            if not positions:
                break
            for j in positions:
                jid = j.get("id")
                title = (j.get("name") or "").strip()
                if not title or jid in seen:
                    continue
                seen.add(jid)
                locs = j.get("locations") or []
                loc = ", ".join(locs) if isinstance(locs, list) else str(locs)
                if not _is_vn_loc(loc):
                    continue
                # positionUrl is root-relative (e.g. "/careers/job/123") — make
                # it absolute, else the JD URL is uncrawlable.
                pos = j.get("positionUrl")
                url = urljoin(origin + "/", pos) if pos else f"{origin}/careers?pid={jid}&domain={domain}"
                out.append({"title": title[:200], "url": url,
                            "location": loc[:120], "description": ""})
            if len(positions) < 10 or len(out) >= 25:
                break
        except Exception as e:
            logger.info(f"[ats] eightfold {domain} page {start} failed: {str(e)[:80]}")
            break
    logger.info(f"[ats] eightfold:{domain} → {len(out)} VN jobs ({origin})")
    return out


# ── workatsea (Sea group: Shopee, SPX, Garena, SeaMoney) ────────────────────
# careers.shopee.vn is a thin SPA backed by ats.workatsea.com. The job list is a
# public GET: /ats/api/v1/user/job/list/?region_ids=<region>&limit&offset.
# region_ids=32 == Vietnam (Hanoi=33, HCMC=34). Each item already carries the
# HTML job_description + requirements, so no per-job detail fetch is needed.
_WORKATSEA_VN_REGION = "32"


def _is_workatsea(career_url: str, html: str | None) -> bool:
    host = (urlparse(career_url).netloc or "").lower()
    if host == "careers.shopee.vn":
        return True
    return bool(html) and "workatsea" in html.lower()


def _workatsea(career_url: str) -> list[dict]:
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"
    api = "https://ats.workatsea.com/ats/api/v1/user/job/list/"
    out, seen = [], set()
    for offset in (0, 20, 40):
        try:
            r = requests.get(api, headers=_JSON_POST, timeout=_TIMEOUT,
                             params={"region_ids": _WORKATSEA_VN_REGION, "limit": 20,
                                     "offset": offset, "lang_code": "vi"})
            if r.status_code != 200:
                break
            jl = ((r.json() or {}).get("data", {}) or {}).get("job_list", []) or []
            if not jl:
                break
            for j in jl:
                jid = j.get("id")
                title = (j.get("job_name") or "").strip()
                if not title or jid in seen:
                    continue
                seen.add(jid)
                desc = _strip_html((j.get("job_description") or "") + " " +
                                   (j.get("requirements") or ""))
                out.append({"title": title[:200], "url": f"{origin}/jobs/{jid}",
                            "location": "Vietnam", "description": desc})
            if len(jl) < 20 or len(out) >= 40:
                break
        except Exception as e:
            logger.info(f"[ats] workatsea offset {offset} failed: {str(e)[:80]}")
            break
    logger.info(f"[ats] workatsea → {len(out)} VN jobs ({origin})")
    return out


# ── Phenom "ph-services" (Nestlé, …) ────────────────────────────────────────
# Phenom career sites render via JS on a Cloudflare-protected host (www.nestle
# .com → 403 to datacenters), but the underlying job API lives on a separate,
# unprotected careersite host (jobdetails.nestle.com) at a clean REST endpoint:
#   POST /services/jobs/search/  {locationsearch, recordsperpage, startrow}
#   → {"jobList":[{title, id, urltitle, city, country, location, ...}]}
# Detail URL = {origin}/job/{urltitle}/{id}/. Curate the careersite host as the
# featured career_url (e.g. https://jobdetails.nestle.com/search-results).
def _is_phenom_services(career_url: str) -> bool:
    p = urlparse(career_url or "")
    host = (p.netloc or "").lower()
    path = (p.path or "").lower().rstrip("/")
    return (host.startswith("jobdetails.")
            or host in _PHENOM_HOSTS
            or path.endswith("/search-results")
            or path.endswith("/viewalljobs"))  # VN Phenom banks (Sacombank, Vietcombank)


# Root-domain Phenom career sites (no /search-results path to key off).
_PHENOM_HOSTS = {"www.techcombankjobs.com", "techcombankjobs.com"}


def _phenom_services(career_url: str) -> list[dict]:
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"
    country = os.getenv("DISCOVER_COUNTRY", "Vietnam")
    headers = {**_JSON_POST, "Referer": f"{origin}/search-results"}
    out = []
    try:
        r = requests.post(f"{origin}/services/jobs/search/", headers=headers, timeout=_TIMEOUT,
                          json={"page": 0, "keywords": "", "locationsearch": country,
                                "recordsperpage": 100, "startrow": 0})
        if r.status_code != 200:
            return []
        for j in (r.json() or {}).get("jobList", []):
            title = (j.get("title") or "").strip()
            loc = j.get("location") or j.get("city") or ""
            if not title or not _is_vn_loc(loc):
                continue
            urltitle, jid = j.get("urltitle"), j.get("id")
            url = f"{origin}/job/{urltitle}/{jid}/" if urltitle and jid else f"{origin}/search-results"
            out.append({"title": title[:200], "url": url, "location": str(loc)[:120],
                        "description": ""})
    except Exception as e:
        logger.info(f"[ats] phenom-services {origin} failed: {str(e)[:80]}")
    logger.info(f"[ats] phenom-services → {len(out)} VN jobs ({origin})")
    return out


# ── Oracle Cloud HCM / Fusion (Hilton, …) — public recruiting REST ──────────
# Oracle Fusion candidate-experience sites (*.oraclecloud.com/hcmUI/Candidate
# Experience/.../sites/<SITE>/) expose a public REST API:
#   GET {host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions
#       ?onlyData=true&finder=findReqs;siteNumber=<SITE>,keyword=Vietnam,limit=50
#   → {items:[{requisitionList:[{Id, Title, PrimaryLocation, ...}]}]}
# Detail = {host}/hcmUI/CandidateExperience/en/sites/<SITE>/job/<Id>.
def _is_oracle_hcm(career_url: str) -> bool:
    p = urlparse(career_url or "")
    return "oraclecloud.com" in (p.netloc or "").lower() and "/sites/" in (p.path or "")


def _oracle_hcm(career_url: str) -> list[dict]:
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"
    m = re.search(r"/sites/([A-Za-z0-9_]+)", p.path)
    site = m.group(1) if m else "CX_1"
    country = os.getenv("DISCOVER_COUNTRY", "Vietnam")
    ep = f"{origin}/hcmRestApi/resources/latest/recruitingCEJobRequisitions"
    finder = f"findReqs;siteNumber={site},facetsList=LOCATIONS;limit=50,keyword={country}"
    out = []
    try:
        r = requests.get(ep, headers=_JSON_POST, timeout=_TIMEOUT,
                         params={"onlyData": "true",
                                 "expand": "requisitionList.secondaryLocations", "finder": finder})
        if r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
            return []
        items = (r.json() or {}).get("items", [])
        rl = items[0].get("requisitionList", []) if items else []
        for it in rl:
            title = (it.get("Title") or "").strip()
            loc = it.get("PrimaryLocation") or ""
            if not title or not _is_vn_loc(loc):
                continue
            jid = it.get("Id")
            url = (f"{origin}/hcmUI/CandidateExperience/en/sites/{site}/job/{jid}"
                   if jid else career_url)
            out.append({"title": title[:200], "url": url, "location": str(loc)[:120],
                        "description": _strip_html(it.get("ShortDescriptionStr", ""))})
    except Exception as e:
        logger.info(f"[ats] oracle-hcm {origin} failed: {str(e)[:80]}")
    logger.info(f"[ats] oracle-hcm:{site} → {len(out)} VN jobs ({origin})")
    return out


# ── TikTok / ByteDance (lifeattiktok.com) — public job-search API ───────────
# careers.tiktok.com / lifeattiktok.com render via JS, but expose a clean POST:
#   POST api.lifeattiktok.com/api/v1/public/supplier/search/job/posts
#   header website-path: tiktok ; body {keyword, limit, offset}
#   → {data:{job_post_list:[{id, code, title, city_info:{...parent.en_name}}]}}
# keyword="Vietnam" already returns VN-only postings. Detail = careers.tiktok
# .com/position/<id>.
# Both TikTok and ByteDance run the same job-search service (data.job_post_list
# with a city_info parent chain), differing only in API host, the website-path
# header, and the detail-page base.
_BD_FAMILY = {
    "tiktok": {
        "hosts": ("lifeattiktok.com", "www.lifeattiktok.com", "careers.tiktok.com"),
        "api": "https://api.lifeattiktok.com/api/v1/public/supplier/search/job/posts",
        "website_path": "tiktok",
        "detail": "https://careers.tiktok.com/position/{id}",
    },
    "bytedance": {
        "hosts": ("joinbytedance.com", "www.joinbytedance.com", "jobs.bytedance.com"),
        "api": "https://jobs.bytedance.com/api/v1/public/supplier/search/job/posts",
        "website_path": "en",
        "detail": "https://jobs.bytedance.com/en/position/{id}",
    },
}


def _bd_config(career_url: str):
    host = (urlparse(career_url or "").netloc or "").lower()
    for cfg in _BD_FAMILY.values():
        if host in cfg["hosts"]:
            return cfg
    return None


def _bd_loc(city_info) -> str:
    """Walk the city_info parent chain to a readable 'City, Country' string."""
    names, node = [], city_info if isinstance(city_info, dict) else None
    while isinstance(node, dict):
        nm = node.get("en_name") or node.get("i18n_name")
        if nm:
            names.append(nm)
        node = node.get("parent")
    return ", ".join(dict.fromkeys(names[:1] + names[-1:]))


def _bytedance_family(career_url: str) -> list[dict]:
    cfg = _bd_config(career_url)
    if not cfg:
        return []
    headers = {**_JSON_POST, "website-path": cfg["website_path"], "accept-language": "en-US"}
    body = {"recruitment_id_list": [], "job_category_id_list": [], "subject_id_list": [],
            "location_code_list": [], "keyword": "Vietnam", "limit": 50, "offset": 0}
    out = []
    try:
        r = requests.post(cfg["api"], headers=headers, timeout=_TIMEOUT, json=body)
        if r.status_code != 200:
            return []
        for j in ((r.json() or {}).get("data", {}) or {}).get("job_post_list", []):
            title = (j.get("title") or "").strip()
            loc = _bd_loc(j.get("city_info"))
            if not title or "vietnam" not in loc.lower():
                continue
            jid = j.get("id")
            url = cfg["detail"].format(id=jid) if jid else cfg["api"]
            out.append({"title": title[:200], "url": url, "location": loc[:120],
                        "description": _strip_html(j.get("description", ""))})
    except Exception as e:
        logger.info(f"[ats] bytedance-family failed: {str(e)[:80]}")
    logger.info(f"[ats] bytedance-family → {len(out)} VN jobs ({cfg['website_path']})")
    return out


# ── VPBank Securities (vpbanks.com.vn) — headless CMS, post_type=tuyen-dung ──
def _is_vpbanks(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "www.vpbanks.com.vn", "vpbanks.com.vn")


def _vpbanks(career_url: str) -> list[dict]:
    api = "https://www.vpbanks.com.vn/api/v1/front/post-type-content"
    out = []
    for page in range(1, 4):
        try:
            r = requests.get(api, headers=_JSON_POST, timeout=_TIMEOUT,
                             params={"page": page, "limit": 50, "post_type": "tuyen-dung", "locale": "vi"})
            if r.status_code != 200:
                break
            data = (r.json() or {}).get("data", []) or []
            if not data:
                break
            for it in data:
                title = (it.get("title") or "").strip()
                slug = it.get("slug")
                if not title or not slug:
                    continue
                out.append({"title": title[:200],
                            "url": f"https://www.vpbanks.com.vn/co-hoi-nghe-nghiep/{slug}",
                            "location": "Vietnam", "description": _strip_html(it.get("long_description", ""))})
            if len(data) < 50 or len(out) >= 100:
                break
        except Exception as e:
            logger.info(f"[ats] vpbanks page {page} failed: {str(e)[:80]}")
            break
    logger.info(f"[ats] vpbanks → {len(out)} jobs")
    return out


# ── MB Bank (careers.mbbank.com.vn "libra") — paginated public API ──────────
# tuyendung.mbbank.com.vn is a JS SPA (crawler saw 0); jobs come from
#   GET careers.mbbank.com.vn/libra-job-management/public/recruitment-news?size=&page=
#   → {content:[{id, name, province, toDate}]}
def _is_mbbank(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "tuyendung.mbbank.com.vn", "careers.mbbank.com.vn")


def _mbbank(career_url: str) -> list[dict]:
    api = "https://careers.mbbank.com.vn/libra-job-management/public/recruitment-news"
    out = []
    try:
        r = requests.get(api, headers=_JSON_POST, timeout=_TIMEOUT,
                         params={"workGroupId": "", "name": "", "skillTags": "",
                                 "city": "", "size": 100, "page": 0})
        if r.status_code != 200:
            return []
        for it in (r.json() or {}).get("content", []) or []:
            name = (it.get("name") or "").strip()
            jid = it.get("id")
            if not name or not jid:
                continue
            out.append({"title": name[:200],
                        "url": f"https://tuyendung.mbbank.com.vn/job/{jid}",
                        "location": str(it.get("province") or "")[:120], "description": ""})
    except Exception as e:
        logger.info(f"[ats] mbbank failed: {str(e)[:80]}")
    logger.info(f"[ats] mbbank → {len(out)} jobs")
    return out


# ── iVIEC (VN bank ATS: TPBank, Eximbank, …) — paginated public API ─────────
# Career sites hosted by iVIEC render via JS and paginate at 10/page, so the
# generic crawler badly under-counts (TPBank: 114 jobs, we saw 10). The public
# API returns everything:
#   GET centralize-api-v2.iviec.vn/api/recruitment/Recruitment/GetRecruitmentsByDomain
#       ?pageIndex=N&pageSize=50&Domain=<career-host>
#   → {items:[{name, slug, workingNewAddresses:[{provinceName,countryName}], ...}],
#      totalRecord, totalPage}
_IVIEC_HOSTS = {"tuyendung.tpb.vn", "tuyendungeximbank.com", "careers.fptis.com"}
_IVIEC_API = ("https://centralize-api-v2.iviec.vn/api/recruitment/"
              "Recruitment/GetRecruitmentsByDomain")


def _is_iviec(career_url: str, html: str | None = None) -> bool:
    if (urlparse(career_url or "").netloc or "").lower() in _IVIEC_HOSTS:
        return True
    # Any iVIEC-hosted career site loads its data from the centralize-api-v2
    # backend — detect generically so new iVIEC tenants work without a hardcode.
    return bool(html) and "centralize-api-v2.iviec.vn" in html.lower()


def _iviec(career_url: str) -> list[dict]:
    host = (urlparse(career_url).netloc or "").lower()
    out = []
    for page in range(1, 6):  # up to 5×50 = 250, capped below
        try:
            r = requests.get(_IVIEC_API, headers={**_JSON_POST, "Referer": f"https://{host}/"},
                             timeout=_TIMEOUT,
                             params={"pageIndex": page, "pageSize": 50, "Domain": host})
            if r.status_code != 200:
                break
            d = r.json() or {}
            items = d.get("items", []) or []
            if not items:
                break
            for it in items:
                name = (it.get("name") or "").strip()
                slug = it.get("slug")
                if not name or not slug:
                    continue
                addrs = it.get("workingNewAddresses") or it.get("workingAddresses") or []
                loc = ", ".join(a.get("provinceName") for a in addrs
                                if isinstance(a, dict) and a.get("provinceName"))
                out.append({"title": name[:200], "url": f"https://{host}/vi/jobs/{slug}",
                            "location": loc[:120], "description": _strip_html(it.get("requirement", ""))})
            if page >= d.get("totalPage", page) or len(out) >= 100:
                break
        except Exception as e:
            logger.info(f"[ats] iviec {host} page {page} failed: {str(e)[:80]}")
            break
    logger.info(f"[ats] iviec → {len(out)} jobs ({host})")
    return out


# ── GHN (tuyendung.ghn.vn) — React SPA, public gateway API ──────────────────
# Cards render client-side (no anchors), but the jobs come from a reachable
# public API: GET online-gateway.ghn.vn/.../recruit/search-recruit. Title lives
# in selectedListRecruit.label, province in provinceNameText.label.
_GHN_API = ("https://online-gateway.ghn.vn/integration/recruit-ghn/"
            "public-api/recruit/search-recruit")


def _is_ghn(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() == "tuyendung.ghn.vn"


def _ghn(career_url: str) -> list[dict]:
    out, seen = [], set()
    try:
        r = requests.get(_GHN_API, headers=_JSON_POST, timeout=_TIMEOUT,
                         params={"search": "", "page": 1, "pageSize": 60})
        if r.status_code != 200:
            return []
        for j in ((r.json() or {}).get("data", {}) or {}).get("list", []):
            sel = j.get("selectedListRecruit") or {}
            title = (sel.get("label") or "").strip()
            rid = sel.get("value") or j.get("id")
            if not title or rid in seen:
                continue
            seen.add(rid)
            prov = (j.get("provinceNameText") or {}).get("label") or ""
            url = f"https://tuyendung.ghn.vn/recruit/detail/{rid}" if rid else "https://tuyendung.ghn.vn/recruit/"
            out.append({"title": title[:200], "url": url,
                        "location": str(prov)[:120], "description": _strip_html(j.get("content", ""))})
            if len(out) >= 40:
                break
    except Exception as e:
        logger.info(f"[ats] ghn failed: {str(e)[:80]}")
    logger.info(f"[ats] ghn → {len(out)} jobs")
    return out


# Normalized exact titles that are nav/section labels, never a real posting.
_BAD_TITLES = {
    "trang chu", "tuyen dung", "viec lam", "co hoi nghe nghiep", "co hoi viec lam",
    "tuyen dung hot", "tuyen dung moi", "tat ca viec lam", "xem toan bo tin",
    "opportunities", "job search", "search jobs", "all jobs", "view all jobs",
    "apply", "ung tuyen",
}


def _norm_title(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.replace("đ", "d").replace("Đ", "D").lower().strip()


def _finalize(jobs: list[dict]) -> list[dict]:
    """Single exit gate for every adapter: keep title+url rows, drop nav/section
    labels and date-range rows, dedup by url then by title, cap per company."""
    out, seen_url, seen_title = [], set(), set()
    for j in jobs:
        title = (j.get("title") or "").strip()
        url = j.get("url") or ""
        if not title or not url or len(title) < 4:
            continue
        nt = _norm_title(title)
        if nt in _BAD_TITLES or nt.startswith(("tu ngay ", "from ")):  # date-range rows (Canon)
            continue
        tkey = nt[:80]
        if url in seen_url or tkey in seen_title:
            continue
        seen_url.add(url)
        seen_title.add(tkey)
        out.append(j)
        if len(out) >= _MAX_ATS_JOBS:
            break
    return out


def _resolve_workday_url(career_url: str, html: str | None) -> str | None:
    """The Workday tenant URL for this page: the career_url itself if it's a
    myworkdayjobs URL, else one embedded in the HTML (e.g. Maersk links to its
    Workday tenant with JSON-escaped slashes)."""
    if _is_workday(career_url):
        return career_url
    if html:
        unesc = html.replace("\\u002f", "/").replace("\\u002F", "/").replace("\\/", "/")
        m = re.search(r"https?://[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com/[A-Za-z0-9_\-]+", unesc, re.I)
        if m:
            return m.group(0)
    return None


# ── Ahamove — Strapi CMS (cms.ahamove.com) ──────────────────────────────────
# ahamove.com/job is a Next.js SPA, but jobs come from a public Strapi API that
# already carries the full JD inline:
#   GET cms.ahamove.com/api/jobs?populate=*
#   → {data:[{title, slug, job_description, job_requirement, benefit, ...}]}
_AHAMOVE_API = "https://cms.ahamove.com/api/jobs"


def _is_ahamove(career_url: str, html: str | None = None) -> bool:
    host = (urlparse(career_url or "").netloc or "").lower().removeprefix("www.")
    if host == "ahamove.com":
        return True
    return bool(html) and "cms.ahamove.com" in html.lower()


def _ahamove(career_url: str) -> list[dict]:
    out = []
    try:
        r = requests.get(_AHAMOVE_API, headers=_JSON_POST, timeout=_TIMEOUT,
                         params={"populate": "*", "pagination[pageSize]": 100})
        if r.status_code != 200:
            return []
        for j in (r.json() or {}).get("data", []) or []:
            a = j.get("attributes", j) if isinstance(j, dict) else {}
            title = (a.get("title") or "").strip()
            slug = a.get("slug") or a.get("id_job")
            if not title or not slug:
                continue
            desc = "\n\n".join(_strip_html(a.get(k) or "") for k in
                               ("job_description", "job_requirement", "benefit") if a.get(k))
            loc = a.get("locations")
            if isinstance(loc, dict):  # Strapi relation: {"data":[{"attributes":{"name":…}}]}
                loc = ", ".join((x.get("attributes", {}) or {}).get("name", "")
                                for x in (loc.get("data") or []) if isinstance(x, dict))
            elif isinstance(loc, list):
                loc = ", ".join(x.get("name", "") if isinstance(x, dict) else str(x) for x in loc)
            out.append({"title": title[:200], "url": f"https://ahamove.com/job/{slug}",
                        "location": str(loc or "")[:120], "description": desc.strip()})
    except Exception as e:
        logger.info(f"[ats] ahamove failed: {str(e)[:80]}")
    logger.info(f"[ats] ahamove → {len(out)} jobs")
    return out


# Adapter protocol: each is (name, detect(url, html) -> bool, fetch(url, html) ->
# [{title,url,location,description}]). Tried in order; the first whose detect()
# matches AND returns rows wins. Output always passes through _finalize. To add
# an ATS: write _is_x / _x and append one line here — no other edits.
_ADAPTERS: list = [
    ("workday",        lambda u, h: _resolve_workday_url(u, h) is not None,
                       lambda u, h: _workday(_resolve_workday_url(u, h))),
    ("base.vn",        _is_basevn,                       lambda u, h: _basevn(u, h)),
    ("workatsea",      _is_workatsea,                    lambda u, h: _workatsea(u)),
    ("oracle-hcm",     lambda u, h: _is_oracle_hcm(u),   lambda u, h: _oracle_hcm(u)),
    ("bytedance",      lambda u, h: bool(_bd_config(u)), lambda u, h: _bytedance_family(u)),
    ("vpbanks",        lambda u, h: _is_vpbanks(u),      lambda u, h: _vpbanks(u)),
    ("mbbank",         lambda u, h: _is_mbbank(u),       lambda u, h: _mbbank(u)),
    ("iviec",          lambda u, h: _is_iviec(u, h),     lambda u, h: _iviec(u)),
    ("ghn",            lambda u, h: _is_ghn(u),          lambda u, h: _ghn(u)),
    ("ahamove",        _is_ahamove,                      lambda u, h: _ahamove(u)),
    ("phenom",         lambda u, h: _is_phenom_services(u), lambda u, h: _phenom_services(u)),
    ("eightfold",      _is_eightfold,                    lambda u, h: _eightfold(u)),
    ("successfactors", _is_successfactors,               lambda u, h: _successfactors(u, h)),
]


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
    if vn:
        jobs = vn
    logger.info(f"[ats] {ats}:{slug} → {len(jobs)} jobs ({career_url})")
    return _finalize(jobs)
