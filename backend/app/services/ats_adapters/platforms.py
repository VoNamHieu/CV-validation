"""Multi-tenant / global platform ATS adapters (split out of vendors.py). Shared helpers from ._shared;
the `_ADAPTERS` registry that wires these lives in vendors.py."""
from __future__ import annotations

import json as _json  # noqa: F401,E402
from app.services.ats_adapters._shared import *  # noqa: F401,F403

# ── base.vn (a.k.a. talent.vn) — popular VN ATS for banks/retail ──────────────
# Server-renders the full job list as a JSON blob ("openings":[...]) right in the
# page HTML — each opening carries name + content (the JD). No API key, no JS.

import json as _json  # noqa: E402


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
                # externalPath is relative to the SITE ("/job/…"); the public
                # URL needs the site segment ("{base}/{site}/job/…") — without it
                # Workday 404s.
                out.append({"title": j.get("title", ""),
                            "url": f"{base}/{site}{ext}" if ext else f"{base}/{site}",
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


def _sf_v4(origin: str) -> list[dict]:
    """Modern SuccessFactors RMK (v4) JSON API — POST /services/recruiting/v1/jobs,
    paginated. JS-rendered SF sites (Standard Chartered, …) expose NO /job/ tiles
    in static HTML, so the scrape below returns 0 for them; this covers those.
    Returns [] when the site isn't v4.

    Two-attempt: the ``jobLocationCountry:["Viet Nam"]`` facet + ``en_GB`` locale
    filters server-side and works for most tenants. But some tenants REJECT that
    facet (400) and only serve ``en_US`` (Swire Coca-Cola VN — jobs tagged
    "…, VNM") → they'd come back empty. So on 0 results, retry without the facet
    on ``en_US`` and VN-filter client-side."""
    out = _sf_v4_fetch(origin, locale="en_GB", vn_facet=True, vn_filter=False)
    if out:
        return out
    return _sf_v4_fetch(origin, locale="en_US", vn_facet=False, vn_filter=True)


def _sf_v4_fetch(origin: str, *, locale: str, vn_facet: bool, vn_filter: bool) -> list[dict]:
    """One SF v4 fetch pass (see _sf_v4). ``vn_facet`` adds the server-side VN
    country filter; ``vn_filter`` keeps only VN-tagged jobs client-side (for the
    no-facet fallback, so a global tenant doesn't leak foreign roles)."""
    out: list[dict] = []
    for page in range(0, 6):
        body = {"locale": locale, "pageNumber": page, "keywords": "",
                "brand": "", "skills": []}
        if vn_facet:
            body["facetFilters"] = {"jobLocationCountry": ["Viet Nam"]}
        try:
            r = requests.post(f"{origin}/services/recruiting/v1/jobs", json=body,
                              headers={**_JSON_POST, "Referer": origin}, timeout=_TIMEOUT)
            if r.status_code != 200:
                break
            results = (r.json() or {}).get("jobSearchResult") or []
        except Exception:
            break
        if not results:
            break
        for j in results:
            rp = j.get("response") or {}
            title = (rp.get("unifiedStandardTitle") or "").strip()
            if not title:
                continue
            loc = (rp.get("jobLocationShort") or [""])[0]
            if vn_filter and not _is_vn_loc(str(loc)):   # global tenant → keep VN only
                continue
            jid, ut = rp.get("id"), rp.get("unifiedUrlTitle")
            url = f"{origin}/job/{ut}/{jid}/" if ut and jid else origin
            out.append({"title": title[:200], "url": url,
                        "location": str(loc)[:120], "description": ""})
        if len(results) < 10 or len(out) >= _MAX_ATS_JOBS:
            break
    return out


def _sf_tile_href(href: str) -> bool:
    """A SuccessFactors job-tile link: ``/job/<slug>/<id>/`` — optionally behind
    ONE site-path segment (EY serves tiles at ``/ey/job/…`` because its career
    site is mounted under ``/ey``). One segment only, so we match ``/job/`` and
    ``/ey/job/`` but not arbitrary nav like ``/a/b/job-search``."""
    parts = (href or "").split("/job/", 1)
    if len(parts) != 2:
        return False
    prefix = parts[0]                       # "" for /job/…, "/ey" for /ey/job/…
    return prefix == "" or (prefix.startswith("/") and prefix.count("/") == 1)


def _successfactors(career_url: str, html: str | None) -> list[dict]:
    from bs4 import BeautifulSoup
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"
    # Modern RMK (v4) JSON API first; falls through to the legacy HTML tile
    # scrape when the site isn't v4 (VN banks, TH Group, …).
    v4 = _sf_v4(origin)
    if v4:
        logger.info(f"[ats] successfactors(v4) → {len(v4)} VN jobs ({origin})")
        return v4[:_MAX_ATS_JOBS]
    # Legacy HTML tiles. VN-domestic SF sites (banks) tag locations as "Hà Nội"
    # and a locationsearch=Vietnam facet returns nothing, so their career_url is
    # a bare /search/?q= and we return all tiles (downstream role/city filter
    # narrows). Global boards (Adidas) instead carry an explicit
    # locationsearch=Vietnam in career_url — honour it by fetching the career_url
    # AS GIVEN rather than resetting to /search/?q=, else the VN filter is lost.
    is_search = "/search" in (p.path or "")
    out, seen = [], set()

    def _harvest(soup) -> int:
        # Returns how many NEW VN(-or-untagged) jobs this page added. SF's
        # `locationsearch=Vietnam` facet only filters the FIRST page — startrow
        # pages beyond it spill the worldwide board — and nothing downstream
        # VN-filters an adapter's output. So filter here: keep VN-tagged tiles
        # (span.jobLocation like "Ho Chi Minh City, 65, VN") and untagged ones
        # (VN-domestic SF sites often omit the location), but DROP foreign-tagged
        # rows. When VN rows run out, the caller stops (we've hit the global tail).
        added = 0
        for a in soup.select("a[href]"):
            href = a.get("href", "")
            if not _sf_tile_href(href):
                continue
            title = a.get_text(" ", strip=True)
            if not href or not title or len(title) < 4 or href in seen:
                continue
            seen.add(href)
            row = a.find_parent(["tr", "li", "div"])
            loc_el = row.select_one("span.jobLocation") if row else None
            loc = loc_el.get_text(" ", strip=True) if loc_el else ""
            if loc and not _is_vn_loc(loc):   # foreign-tagged → not a VN job
                continue
            added += 1
            out.append({"title": title[:200], "url": origin + href,
                        "location": loc[:120], "description": ""})
        return added

    try:
        if is_search:
            # Classic SF search pages return tiles in static HTML and paginate by
            # &startrow=N (25/page). Walk startrow until a page adds no new VN
            # rows (the VN-faceted results end and the global board begins) — this
            # both de-truncates real VN boards (Deloitte 25 → 48) and stops us
            # ingesting the foreign tail (Adidas stays 25 VN, not 75).
            sep = "&" if "?" in career_url else "?"
            for startrow in range(0, 25 * 20, 25):
                if startrow == 0 and html:
                    page_html = html                      # reuse rendered page 1
                else:
                    page_url = career_url if startrow == 0 else f"{career_url}{sep}startrow={startrow}"
                    r = requests.get(page_url, headers=_HTML_HEADERS, timeout=_TIMEOUT)
                    if r.status_code != 200:
                        break
                    page_html = r.text
                if _harvest(BeautifulSoup(page_html, "html.parser")) == 0 \
                        or len(out) >= _MAX_ATS_JOBS:
                    break
        else:
            # Homepage career_url (no /search path): its passed HTML has no tiles,
            # so hit the site search once (single page — not VN-scoped).
            r = requests.get(f"{origin}/search/?q=", headers=_HTML_HEADERS, timeout=_TIMEOUT)
            if r.status_code == 200:
                _harvest(BeautifulSoup(r.text, "html.parser"))
    except Exception:
        pass
    logger.info(f"[ats] successfactors → {len(out)} VN jobs ({origin})")
    return out[:_MAX_ATS_JOBS]


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
        # The public detail page is keyed by the NUMERIC id, e.g.
        # /job/10626 — that route SSRs the full posting. The codename
        # (/job/VINPEARLJSC-J10626) returns only an empty 200 shell, so a
        # codename-based URL looks alive (200) but is a dead end for the user.
        # Prefer id; fall back to codename only when id is absent.
        jid = str(o.get("id") or "").strip()
        code = jid or str(o.get("codename") or "").strip()
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
    for start in range(0, 200, 50):
        try:
            r = requests.get(f"{origin}/api/pcsx/search", headers=_JSON_POST, timeout=_TIMEOUT,
                             params={"domain": domain, "query": "", "location": country,
                                     "start": start, "sort_by": "relevance", "num": 50})
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
                # Match per-location, not the whole joined string — a global
                # posting tagged "Singapore, Vietnam, Thailand" would otherwise
                # report a Vietnam-flavored location string that's just noise.
                locs = j.get("locations") or []
                vn = next((l for l in locs if _is_vn_loc(l)), "") if isinstance(locs, list) else ""
                if not vn:
                    continue
                seen.add(jid)
                # positionUrl is root-relative (e.g. "/careers/job/123") — make
                # it absolute, else the JD URL is uncrawlable.
                pos = j.get("positionUrl")
                url = urljoin(origin + "/", pos) if pos else f"{origin}/careers?pid={jid}&domain={domain}"
                out.append({"title": title[:200], "url": url,
                            "location": str(vn)[:120], "description": ""})
            # `count` is the API's own total — pace off it instead of a fixed
            # page cap, so a company with >30 VN postings isn't truncated.
            if start + 50 >= (data.get("count") or 0) or len(out) >= _MAX_ATS_JOBS:
                break
        except Exception as e:
            logger.info(f"[ats] eightfold {domain} page {start} failed: {str(e)[:80]}")
            break
    logger.info(f"[ats] eightfold:{domain} → {len(out)} VN jobs ({origin})")
    return out


# ── Moka (mokahr.com — Klook, …) ─────────────────────────────────────────────
# Chinese ATS hosting career sites at hire-*.mokahr.com/social-recruitment/
# {orgId}/{siteId}. The SPA shell is cookie-gated (302 that only sets csrfCk/
# moka-apply and re-serves the same URL), so a plain GET on the career page
# primes a session, after which the job API accepts anonymous POSTs:
#   POST /api/outer/ats-apply/website/jobs/v2
#     {"orgId", "siteId", "limit": 30, "offset", "needStat": true, ...}
#   → {"code": 0, "data": {"jobStats": {"total"}, "jobs": [{id, title,
#      jobDescription(html), locations: [{country, cityName?}], ...}]}}
# limit must stay ≤30 (the API rejects larger pages with code 102). Detail URL
# is the hash route {career_url_base}?locale=en-US#/job/{uuid} (matches the
# rows seeded in the store). Sites list GLOBAL jobs → keep VN only, unless the
# org tags no locations at all (VN-domestic tenants).
_MOKA_RX = re.compile(r"https?://([a-z0-9-]+\.mokahr\.(?:com|io))/social-recruitment/([a-z0-9_-]+)/(\d+)", re.I)


def _is_mokahr(career_url: str) -> bool:
    return bool(_MOKA_RX.match(career_url or ""))


def _mokahr(career_url: str) -> list[dict]:
    m = _MOKA_RX.match(career_url or "")
    if not m:
        return []
    host, org, site = m.group(1), m.group(2), m.group(3)
    base = f"https://{host}/social-recruitment/{org}/{site}"

    s = requests.Session()
    s.headers.update(_HEADERS)
    try:
        s.get(f"{base}?locale=en-US", timeout=_TIMEOUT)  # cookie gate
    except Exception as e:
        logger.info(f"[ats] mokahr gate failed ({base}): {str(e)[:80]}")
        return []

    raw: list[dict] = []
    total = None
    while total is None or len(raw) < min(total, _MAX_ATS_JOBS * 3):
        try:
            r = s.post(
                f"https://{host}/api/outer/ats-apply/website/jobs/v2",
                json={"orgId": org, "siteId": site, "limit": 30, "offset": len(raw),
                      "needStat": True, "jobIdTopList": [], "customFields": {},
                      "site": "social", "locale": "en-US"},
                timeout=_TIMEOUT,
            )
            d = r.json() if r.status_code == 200 else {}
        except Exception as e:
            logger.info(f"[ats] mokahr page {len(raw)} failed: {str(e)[:80]}")
            break
        if d.get("code") != 0:
            logger.info(f"[ats] mokahr API code {d.get('code')} ({base})")
            break
        page = (d.get("data", {}) or {}).get("jobs", []) or []
        if total is None:
            total = int(((d.get("data", {}) or {}).get("jobStats", {}) or {}).get("total") or 0)
        if not page:
            break
        raw.extend(page)

    out = []
    for j in raw:
        title = (j.get("title") or "").strip()
        jid = j.get("id")
        if not title or not jid:
            continue
        locs = j.get("locations") or []
        loc = ", ".join(
            p for p in (
                (locs[0].get("cityName") if locs else None),
                (locs[0].get("country") if locs else None),
            ) if p
        )
        out.append({
            "title": title[:200],
            "url": f"{base}?locale=en-US#/job/{jid}",
            "location": loc,
            "description": _strip_html(j.get("jobDescription") or ""),
        })

    # Global tenant → VN postings only; keep everything only when the org tags
    # no locations at all (otherwise we'd pour 100+ SG/MY jobs into a VN store).
    vn = [j for j in out if _is_vn_loc(j.get("location") or "")]
    if vn:
        out = vn
    elif any(j.get("location") for j in out):
        out = []
    logger.info(f"[ats] mokahr → {len(out)} jobs of {total} total ({base})")
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
    # The feed is server-side location-filtered (locationsearch=Vietnam) but
    # returns only `recordsperpage` rows per call with NO total field — a single
    # page truncated big VN Phenom banks (Techcombank: 294 VN jobs → 100). Page
    # by startrow until a short page (the last) or the global cap.
    _PER = 100
    for startrow in range(0, 30 * _PER, _PER):
        try:
            r = requests.post(f"{origin}/services/jobs/search/", headers=headers, timeout=_TIMEOUT,
                              json={"page": startrow // _PER, "keywords": "", "locationsearch": country,
                                    "recordsperpage": _PER, "startrow": startrow})
            if r.status_code != 200:
                break
            joblist = (r.json() or {}).get("jobList", []) or []
        except Exception as e:
            logger.info(f"[ats] phenom-services {origin} failed: {str(e)[:80]}")
            break
        if not joblist:
            break
        for j in joblist:
            title = (j.get("title") or "").strip()
            loc = j.get("location") or j.get("city") or ""
            if not title or not _is_vn_loc(loc):
                continue
            urltitle, jid = j.get("urltitle"), j.get("id")
            url = f"{origin}/job/{urltitle}/{jid}/" if urltitle and jid else f"{origin}/search-results"
            out.append({"title": title[:200], "url": url, "location": str(loc)[:120],
                        "description": ""})
        if len(joblist) < _PER or len(out) >= _MAX_ATS_JOBS:
            break
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
# keyword="Vietnam" already returns VN-only postings. Detail page is
# lifeattiktok.com/search/<id> — NOT careers.tiktok.com/position/<id>, which
# 302s to lifeattiktok.com/position/<id> and renders "page missing" (verified
# headless: /search/<id> shows the job, /position/<id> is a dead route).
# Both TikTok and ByteDance run the same job-search service (data.job_post_list
# with a city_info parent chain), differing only in API host, the website-path
# header, and the detail-page base.
_BD_FAMILY = {
    "tiktok": {
        "hosts": ("lifeattiktok.com", "www.lifeattiktok.com", "careers.tiktok.com"),
        "api": "https://api.lifeattiktok.com/api/v1/public/supplier/search/job/posts",
        "website_path": "tiktok",
        "detail": "https://lifeattiktok.com/search/{id}",
    },
    "bytedance": {
        "hosts": ("joinbytedance.com", "www.joinbytedance.com", "jobs.bytedance.com"),
        "api": "https://jobs.bytedance.com/api/v1/public/supplier/search/job/posts",
        "website_path": "en",
        # Detail page needs the trailing /detail — /en/position/{id} alone
        # renders "page is missing" (verified via headless render).
        "detail": "https://jobs.bytedance.com/en/position/{id}/detail",
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
    # The search returns `count` total matches for keyword=Vietnam but only
    # `limit` per page — a single offset=0 fetch capped results at 50 (TikTok has
    # 67). Page by offset until we've seen `count` or hit the global cap.
    out = []
    for offset in range(0, 600, 50):
        body = {"recruitment_id_list": [], "job_category_id_list": [], "subject_id_list": [],
                "location_code_list": [], "keyword": "Vietnam", "limit": 50, "offset": offset}
        try:
            r = requests.post(cfg["api"], headers=headers, timeout=_TIMEOUT, json=body)
            if r.status_code != 200:
                break
            data = (r.json() or {}).get("data", {}) or {}
        except Exception as e:
            logger.info(f"[ats] bytedance-family failed: {str(e)[:80]}")
            break
        posts = data.get("job_post_list", []) or []
        if not posts:
            break
        for j in posts:
            title = (j.get("title") or "").strip()
            loc = _bd_loc(j.get("city_info"))
            if not title or "vietnam" not in loc.lower():
                continue
            jid = j.get("id")
            url = cfg["detail"].format(id=jid) if jid else cfg["api"]
            out.append({"title": title[:200], "url": url, "location": loc[:120],
                        "description": _strip_html(j.get("description", ""))})
        if offset + 50 >= (data.get("count") or 0) or len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] bytedance-family → {len(out)} VN jobs ({cfg['website_path']})")
    return out


# ── Odoo website_hr_recruitment (skyhr.vietnamairlines.com, …) ──────────────
# Odoo's built-in recruitment site is fully SSR: /jobs lists <a href="/jobs/
# detail/<slug>-<id>"> tiles and each detail page server-renders the whole
# posting (title, location, JD). No API, no JS. We parse the list here and pull
# each JD from its SSR detail page (bounded). Generic across Odoo tenants — the
# oe_website_jobs marker + /jobs/detail/ route are Odoo standard.
_ODOO_MAX_JD = 30  # bound per-detail fetches for large Odoo tenants


def _is_odoo_jobs(career_url: str, html: str | None) -> bool:
    host = (urlparse(career_url or "").netloc or "").lower()
    if host == "skyhr.vietnamairlines.com":
        return True
    if not html:
        return False
    h = html.lower()
    return "oe_website_jobs" in h and "/jobs/detail/" in h


def _odoo_jobs(career_url: str, html: str | None) -> list[dict]:
    from bs4 import BeautifulSoup
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"
    if not html:
        try:
            r = requests.get(f"{origin}/jobs", headers=_HTML_HEADERS, timeout=_TIMEOUT)
            html = r.text if r.status_code == 200 else ""
        except Exception:
            html = ""
    if not html:
        return []
    soup = BeautifulSoup(html, "html.parser")
    seen, tiles = set(), []
    for a in soup.select('a[href*="/jobs/detail/"]'):
        href = (a.get("href") or "").split("?")[0]
        title = a.get_text(" ", strip=True)
        if not href or not title or len(title) < 4 or href in seen:
            continue
        seen.add(href)
        tiles.append((urljoin(origin + "/", href), title))

    loc_rx = re.compile(r"Địa điểm tuyển dụng\s*(.+?)\s*(?:Kinh nghiệm|Số lượng|Mức lương|Hạn nộp)")
    out = []
    for i, (url, title) in enumerate(tiles):
        loc, desc = "", ""
        if i < _ODOO_MAX_JD:  # SSR detail carries location + full JD
            try:
                dr = requests.get(url, headers=_HTML_HEADERS, timeout=_TIMEOUT)
                if dr.status_code == 200:
                    dsoup = BeautifulSoup(dr.text, "html.parser")
                    main = dsoup.select_one("#wrap") or dsoup.find("main") or dsoup
                    text = main.get_text("\n", strip=True)
                    m = loc_rx.search(text.replace("\n", " "))
                    loc = (m.group(1).strip() if m else "")[:120]
                    idx = text.find("Mô tả công việc")
                    desc = _strip_html(text[idx:] if idx >= 0 else text)[:6000]
            except Exception:
                pass
        out.append({"title": title[:200], "url": url, "location": loc, "description": desc})
    logger.info(f"[ats] odoo → {len(out)} jobs ({origin})")
    return out


# ── Phenom apply/v2 (HSBC + other portal.careers.* portals) ─────────────────
# Phenom career portals expose a public list API:
#   GET https://<host>/api/apply/v2/jobs?domain=<reg-domain>&location=<country>
#   → {positions:[{name, canonicalPositionUrl, location, ...}], count}
# The list omits the JD, but each canonicalPositionUrl page carries a JSON-LD
# JobPosting the normal crawl extracts — so listing the jobs here is enough.
def _is_phenom_v2(career_url: str, html: str | None = None) -> bool:
    host = (urlparse(career_url or "").netloc or "").lower()
    if host.startswith("portal.careers."):
        return True
    return bool(html) and "/api/apply/v2/jobs" in html


def _phenom_v2(career_url: str) -> list[dict]:
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"
    domain = _registrable_domain(p.netloc)
    country = os.getenv("DISCOVER_COUNTRY", "Vietnam").lower()
    out, seen = [], set()
    for start in range(0, _MAX_ATS_JOBS, 10):       # 10/page
        try:
            r = requests.get(f"{origin}/api/apply/v2/jobs", headers=_JSON_POST, timeout=_TIMEOUT,
                             params={"domain": domain, "location": country, "num": 10, "start": start})
            if r.status_code != 200:
                break
            pos = (r.json() or {}).get("positions", []) or []
            if not pos:
                break
            for j in pos:
                title = (j.get("name") or "").strip()
                url = j.get("canonicalPositionUrl") or ""
                if not title or not url or url in seen:
                    continue
                # The location=vietnam param is a soft filter (HSBC leaks e.g. a
                # Sheffield, UK req), so drop foreign-tagged rows; keep untagged.
                loc = (j.get("location") or "")
                if loc and not _is_vn_loc(loc):
                    continue
                seen.add(url)
                out.append({"title": title[:200], "url": url,
                            "location": loc[:120],
                            "description": _strip_html(j.get("job_description") or "")})
            if len(pos) < 10 or len(out) >= _MAX_ATS_JOBS:
                break
        except Exception as e:
            logger.info(f"[ats] phenom_v2 failed: {str(e)[:80]}")
            break
    logger.info(f"[ats] phenom_v2 → {len(out)} jobs ({origin})")
    return out


# Adapter protocol: each is (name, detect(url, html) -> bool, fetch(url, html) ->
# [{title,url,location,description}]). Tried in order; the first whose detect()
# matches AND returns rows wins. Output always passes through _finalize. To add
# an ATS: write _is_x / _x and append one line here — no other edits.


# ── Amazon (amazon.jobs) — public search.json, no auth ──────────────────────
# GET https://www.amazon.jobs/en/search.json?loc_query=Vietnam&country=VNM
#   -> {jobs:[{title, location, job_path, description_short, ...}]}
# Detail = https://www.amazon.jobs + job_path. country=VNM scopes to VN, so we
# trust it rather than re-filtering on _is_vn_loc (Amazon's "VN, Hanoi" strings
# aren't all in _VN_MARKERS).
def _is_amazon(career_url: str) -> bool:
    return "amazon.jobs" in (urlparse(career_url or "").netloc or "").lower()


def _amazon(career_url: str) -> list[dict]:
    # result_limit is capped at 100 server-side: a larger value (we used to send
    # _MAX_ATS_JOBS=300) is rejected with {"error": "...", "jobs": null}, which
    # then blew up on iteration → 0 jobs. VN has ~23 postings, well under 100.
    params = {"loc_query": "Vietnam", "country": "VNM",
              "result_limit": min(_MAX_ATS_JOBS, 100), "sort": "recent"}
    try:
        r = requests.get("https://www.amazon.jobs/en/search.json",
                         params=params, headers=_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        data = r.json() or {}
    except Exception as e:
        logger.info(f"[ats] amazon failed: {str(e)[:80]}")
        return []
    out = []
    for j in (data.get("jobs") or []):
        title = (j.get("title") or "").strip()
        path = j.get("job_path") or ""
        if not title or not path:
            continue
        out.append({
            "title": title[:200],
            "url": "https://www.amazon.jobs" + path,
            "location": str(j.get("location") or j.get("normalized_location") or "")[:120],
            "description": _strip_html(j.get("description_short") or "")[:600],
        })
    logger.info(f"[ats] amazon -> {len(out)} VN jobs")
    return out


# ── Avature (custom-domain career sites: careers.nike.com, careers.bain.com) ─
# Avature tenants sit on bespoke domains, so the only reliable signal is the
# "avature" marker in the page HTML. Listings are server-rendered as
# <a href=".../job/<id>">Title</a>, so we parse the rendered HTML (ingest
# supplies it via the render fallback). The career_url should already carry a
# Vietnam location filter, so we trust it rather than per-job location parsing.
def _is_avature(career_url: str, html: str | None) -> bool:
    return bool(html) and "avature" in html.lower()


def _avature(career_url: str, html: str | None) -> list[dict]:
    if not html:
        return []
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    out, seen = [], set()
    # Avature's job-detail path is /{locale}/jobs/JobDetail/{slug}/{id} (plural
    # "jobs") — the old '/job/' selector never matched it. Match both.
    for a in soup.select('a[href*="/job/"], a[href*="/JobDetail/"]'):
        href = (a.get("href") or "").strip()
        title = a.get_text(" ", strip=True)
        if not href or not title or len(title) < 4 or href in seen:
            continue
        seen.add(href)
        out.append({"title": title[:200], "url": urljoin(career_url, href),
                    "location": "", "description": ""})
    logger.info(f"[ats] avature -> {len(out)} jobs ({career_url})")
    return out


# ── Radancy / TalentBrew (careers.se.com, many large-enterprise boards) ──────
# TalentBrew sites live on bespoke domains but share a public JSON feed:
#   GET {origin}/api/jobs?<same location facets as the career_url>&page=N
#   → {jobs:[{data:{title, req_id, slug, full_location, country_code,
#              apply_url, description, ...}}], totalCount}
# Signature: the career_url carries Radancy's geo facets (woe= + regionCode=),
# which no other adapter uses — safe to key on. The career_url should already
# scope to Vietnam (regionCode=VN); we still re-filter on country_code/location
# because the radius facet (stretch=) can pull in neighbouring-country roles.
def _is_radancy(career_url: str) -> bool:
    q = (urlparse(career_url or "").query or "").lower()
    return "woe=" in q and "regioncode=" in q


def _radancy(career_url: str) -> list[dict]:
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"
    base = dict(parse_qsl(p.query))            # preserve location/woe/regionCode
    out, seen = [], set()
    for page in range(1, 12):                  # 10/page, cap ~110
        base["page"] = str(page)
        try:
            r = requests.get(f"{origin}/api/jobs", params=base,
                             headers=_JSON_POST, timeout=_TIMEOUT)
            if r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
                break
            jobs = (r.json() or {}).get("jobs", []) or []
        except Exception as e:
            logger.info(f"[ats] radancy failed: {str(e)[:80]}")
            break
        if not jobs:
            break
        for it in jobs:
            d = it.get("data", it)
            title = (d.get("title") or "").strip()
            loc = d.get("full_location") or d.get("short_location") or d.get("location_name") or ""
            if (d.get("country_code") or "").upper() != "VN" and not _is_vn_loc(loc):
                continue
            url = (d.get("apply_url") or "").rstrip("/")
            if url.endswith("/login"):
                url = url[: -len("/login")]
            url = url or f"{origin}/jobs/{d.get('slug') or d.get('req_id')}"
            if not title or url in seen:
                continue
            seen.add(url)
            out.append({"title": title[:200], "url": url, "location": str(loc)[:120],
                        "description": _strip_html(d.get("description") or "")[:600]})
        if len(jobs) < 10 or len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] radancy → {len(out)} VN jobs ({origin})")
    return out


# ── careers-page.com (hosted careers pages, e.g. Mekong Capital) ─────────────
# Generic. Server-rendered listing at careers-page.com/<company>; each job card:
#   <a href="/<company>/job/<CODE>"><h5>TITLE</h5></a>
#   <span>…<i class="fa-map-marker-alt"></i> City, …, Country</span>
# Title + location parse straight out of the HTML; VN-filtered by the card loc.
def _is_careerspage(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "careers-page.com"


def _careerspage(career_url: str) -> list[dict]:
    p = urlparse(career_url or "")
    slug = next((s for s in (p.path or "").split("/") if s), "")
    if not slug:
        return []
    try:
        r = requests.get(f"https://www.careers-page.com/{slug}", headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        html = r.text
    except Exception as e:
        logger.info(f"[ats] careers-page {slug} failed: {str(e)[:80]}")
        return []
    out, seen = [], set()
    anchor_re = re.compile(
        r'href="(/' + re.escape(slug) + r'/job/[A-Za-z0-9]+)"[^>]*>\s*<h5[^>]*>(.*?)</h5>', re.S | re.I)
    for m in anchor_re.finditer(html):
        href = m.group(1)
        title = _html.unescape(re.sub(r"\s+", " ", _strip_html(m.group(2)))).strip()
        if not title or href in seen:
            continue
        seen.add(href)
        # location = nearest map-marker within the card that follows the title
        lm = re.search(r'fa-map-marker-alt[^>]*></i>\s*([^<]+)', html[m.end():m.end() + 400])
        loc = re.sub(r"\s+", " ", lm.group(1)).strip() if lm else ""
        if loc and not _is_vn_loc(loc):
            continue
        out.append({"title": title[:200], "url": f"https://www.careers-page.com{href}",
                    "location": (loc or "Vietnam")[:120], "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] careers-page:{slug} → {len(out)} VN jobs")
    return out


# ── Talent-network platform (VNDIRECT, Viettel IDC, …) — SSR listing ─────────
# A white-label VN recruiting SaaS: the all-jobs page (…/tim-viec-lam/…) is
# server-rendered with <a href="…/viec-lam/<slug>.<hex>.html">Title</a> cards.
# Generic on the /tim-viec-lam/ URL so any tenant works. VN-only sites.
def _is_talentnet(career_url: str) -> bool:
    return "/tim-viec-lam/" in (urlparse(career_url or "").path or "")


def _talentnet(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"
    # The listing paginates via ?page=N (e.g. VNDIRECT has 3+ pages of 20); a
    # single fetch of page 1 truncated to 20. Walk pages until one adds nothing.
    out, seen = [], set()
    for page in range(1, 21):
        page_url = career_url if page == 1 else (
            f"{career_url}{'&' if '?' in career_url else '?'}page={page}")
        try:
            r = requests.get(page_url, headers=_HTML_HEADERS, timeout=_TIMEOUT)
            if r.status_code != 200:
                break
            soup = BeautifulSoup(r.text, "html.parser")
        except Exception as e:
            logger.info(f"[ats] talentnet page {page} failed: {str(e)[:80]}")
            break
        added = 0
        for a in soup.select('a[href*="/viec-lam/"]'):
            href = a.get("href") or ""
            if not href.endswith(".html") or "tat-ca-viec-lam" in href:
                continue
            url = href if href.startswith("http") else origin + href
            title = re.sub(r"\s+", " ", a.get_text(" ", strip=True)).strip()
            if not title or url in seen:
                continue
            seen.add(url)
            added += 1
            out.append({"title": title[:200], "url": url, "location": "Vietnam", "description": ""})
        # No new jobs on this page → past the last page (server may echo page 1).
        if added == 0 or len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] talentnet → {len(out)} jobs ({p.netloc})")
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


__all__ = ['_amazon', '_avature', '_basevn', '_bd_config', '_bd_loc', '_bytedance_family', '_careerspage', '_eightfold', '_is_amazon', '_is_avature', '_is_basevn', '_is_careerspage', '_is_eightfold', '_is_mokahr', '_is_odoo_jobs', '_is_oracle_hcm', '_is_phenom_services', '_is_phenom_v2', '_is_radancy', '_is_successfactors', '_is_talentnet', '_is_workday', '_mokahr', '_odoo_jobs', '_oracle_hcm', '_parse_openings', '_phenom_services', '_phenom_v2', '_radancy', '_registrable_domain', '_resolve_workday_url', '_sf_v4', '_successfactors', '_talentnet', '_workday']
