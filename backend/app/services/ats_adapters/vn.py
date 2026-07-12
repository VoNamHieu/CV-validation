"""Vietnam single-company ATS adapters (split out of vendors.py). Shared helpers from ._shared;
the `_ADAPTERS` registry that wires these lives in vendors.py."""
from __future__ import annotations

import json as _json  # noqa: F401,E402
import hashlib as _hashlib  # noqa: E402
import base64 as _b64  # noqa: E402
import datetime as _dt  # noqa: E402
from app.services.ats_adapters._shared import *  # noqa: F401,F403

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
    # Walk offset until a short/empty page or the global cap. Was a fixed
    # (0, 20, 40) tuple with a len(out) >= 40 sub-cap, which truncated big VN
    # boards (Shopee: 252 → 40) to the first 3 pages.
    offset = 0
    while offset < _MAX_ATS_JOBS + 20:
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
                # Detail route is /job-detail/{id}/ — /jobs/{id} is NOT a route
                # and the SPA just falls back to the careers home (verified via
                # headless render). Same id-keyed-detail class as base.vn.
                out.append({"title": title[:200], "url": f"{origin}/job-detail/{jid}/",
                            "location": "Vietnam", "description": desc})
            if len(jl) < 20 or len(out) >= _MAX_ATS_JOBS:
                break
            offset += 20
        except Exception as e:
            logger.info(f"[ats] workatsea offset {offset} failed: {str(e)[:80]}")
            break
    logger.info(f"[ats] workatsea → {len(out)} VN jobs ({origin})")
    return out


# ── MB Bank (careers.mbbank.com.vn "libra") — paginated public API ──────────
# tuyendung.mbbank.com.vn is a JS SPA (crawler saw 0); jobs come from
#   GET careers.mbbank.com.vn/libra-job-management/public/recruitment-news?size=&page=
#   → {content:[{id, name, province, toDate}]}
def _is_mbbank(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower() in (
        "tuyendung.mbbank.com.vn", "careers.mbbank.com.vn")


def _mbbank(career_url: str) -> list[dict]:
    # Spring-Data paged API (content + totalPages). It's a big board (~2790
    # recruitment-news rows), so loop pages until totalPages or the global cap —
    # a single page=0 fetch silently truncated to 100.
    api = "https://careers.mbbank.com.vn/libra-job-management/public/recruitment-news"
    out = []
    for page in range(0, 40):  # 100/page; _MAX_ATS_JOBS bounds the total
        try:
            r = requests.get(api, headers=_JSON_POST, timeout=_TIMEOUT,
                             params={"workGroupId": "", "name": "", "skillTags": "",
                                     "city": "", "size": 100, "page": page})
            if r.status_code != 200:
                break
            body = r.json() or {}
        except Exception as e:
            logger.info(f"[ats] mbbank page {page} failed: {str(e)[:80]}")
            break
        content = body.get("content", []) or []
        if not content:
            break
        for it in content:
            name = (it.get("name") or "").strip()
            jid = it.get("id")
            if not name or not jid:
                continue
            out.append({"title": name[:200],
                        "url": f"https://tuyendung.mbbank.com.vn/job/{jid}",
                        "location": str(it.get("province") or "")[:120], "description": ""})
        if page + 1 >= body.get("totalPages", page + 1) or len(out) >= _MAX_ATS_JOBS:
            break
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


# ── FPT Software — custom Spring API (career.fpt-software.com) ──────────────
# JS career site; jobs come from a public paginated API with full HTML JD inline:
#   GET /service/api/v1.0/public/job-postings?page=N&pageSize=10
#   → {content:[{title, slug, description, locationName, ...}], last, totalPages}
_FPTSOFT_API = "https://career.fpt-software.com/service/api/v1.0/public/job-postings"


def _is_fptsoft(career_url: str, html: str | None = None) -> bool:
    host = (urlparse(career_url or "").netloc or "").lower().removeprefix("www.")
    if host == "career.fpt-software.com":
        return True
    return bool(html) and "career.fpt-software.com/service/api" in html.lower()


def _fptsoft(career_url: str) -> list[dict]:
    out = []
    try:
        for page in range(0, 12):       # API caps at 10/page
            r = requests.get(_FPTSOFT_API, headers=_JSON_POST, timeout=_TIMEOUT,
                             params={"page": page, "pageSize": 10})
            if r.status_code != 200:
                break
            d = r.json() or {}
            for j in d.get("content", []) or []:
                title = (j.get("title") or "").strip()
                slug = j.get("slug")
                if not title or not slug:
                    continue
                out.append({
                    "title": title[:200],
                    "url": f"https://career.fpt-software.com/co-hoi-viec-lam/{slug}",
                    "location": (j.get("locationName") or "")[:120],
                    "description": _strip_html(j.get("description") or j.get("summary") or ""),
                })
            if d.get("last") or len(out) >= 100:
                break
    except Exception as e:
        logger.info(f"[ats] fptsoft failed: {str(e)[:80]}")
    logger.info(f"[ats] fptsoft → {len(out)} jobs")
    return out


# ── Trusting Social (trustingsocial.com) — Gatsby static site over Recruiterbox ──
# Careers are a Gatsby page-data feed (pure JSON, no headless): the list is
#   /page-data/careers/page-data.json → result.data.allRecruiterboxOpening.nodes[]
#     (rawID, slug, title, state, position_type, team, location{city,state,country})
# and each opening's JD is
#   /page-data/careers/openings/<slug>/page-data.json → result.data.recruiterboxOpening
#     (adds description + hosted_url). Apply flows to Trakstar.
def _is_trustingsocial(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "trustingsocial.com"


def _trustingsocial(career_url: str) -> list[dict]:
    base = "https://trustingsocial.com"
    try:
        r = requests.get(f"{base}/page-data/careers/page-data.json", headers=_JSON_POST, timeout=_TIMEOUT)
        if r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
            return []
        nodes = (((r.json() or {}).get("result") or {}).get("data") or {}) \
            .get("allRecruiterboxOpening", {}).get("nodes", []) or []
    except Exception as e:
        logger.info(f"[ats] trustingsocial list failed: {str(e)[:80]}")
        return []
    out = []
    for n in nodes:
        if n.get("state") != "Published":
            continue
        loc = n.get("location") or {}
        loc_str = ", ".join(x for x in (loc.get("city"), loc.get("country")) if x)
        if not _is_vn_loc(loc_str):
            continue
        slug = (n.get("slug") or "").strip()
        title = (n.get("title") or "").strip()
        if not slug or not title:
            continue
        # Per-opening detail carries the full JD; a hiccup just leaves it blank.
        desc = ""
        try:
            dr = requests.get(f"{base}/page-data/careers/openings/{slug}/page-data.json",
                              headers=_JSON_POST, timeout=_TIMEOUT)
            if dr.status_code == 200:
                op = (((dr.json() or {}).get("result") or {}).get("data") or {}) \
                    .get("recruiterboxOpening", {}) or {}
                desc = _strip_html(op.get("description") or "")[:600]
        except Exception:
            pass
        out.append({"title": title[:200],
                    "url": f"{base}/careers/openings/{slug}",
                    "location": loc_str[:120] or "Vietnam",
                    "description": desc,
                    "employment_type": (n.get("position_type") or "").strip(),
                    "category": (n.get("team") or "").strip()})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] trustingsocial → {len(out)} VN jobs")
    return out


# ── Timo (timo.vn) — WordPress "career" custom post type via WP REST ─────────
# /tuyen-dung/ is a JS SPA, but the CPT is exposed at wp-json/wp/v2/career
# (title, link=/career/<slug>/, content=JD, career-location taxonomy ids). The
# location taxonomy id→name map comes from wp/v2/career-location; default VN.
def _is_timo(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "timo.vn"


def _timo(career_url: str) -> list[dict]:
    base = "https://timo.vn"
    locmap = {}
    try:
        lr = requests.get(f"{base}/wp-json/wp/v2/career-location", headers=_JSON_POST,
                          timeout=_TIMEOUT, params={"per_page": 100})
        if lr.status_code == 200:
            locmap = {t.get("id"): (t.get("name") or "") for t in (lr.json() or [])}
    except Exception:
        pass
    out = []
    try:
        r = requests.get(f"{base}/wp-json/wp/v2/career", headers=_JSON_POST,
                         timeout=_TIMEOUT, params={"per_page": 50})
        if r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
            return []
        for j in (r.json() or []):
            title = _html.unescape(re.sub(r"\s+", " ", _strip_html((j.get("title") or {}).get("rendered", "")))).strip()
            link = j.get("link") or ""
            if not title or not link:
                continue
            locs = [locmap.get(i, "") for i in (j.get("career-location") or [])]
            loc = ", ".join(x for x in locs if x) or "Vietnam"
            desc = _strip_html((j.get("content") or {}).get("rendered", ""))[:600]
            out.append({"title": title[:200], "url": link, "location": loc[:120], "description": desc})
    except Exception as e:
        logger.info(f"[ats] timo failed: {str(e)[:80]}")
    logger.info(f"[ats] timo → {len(out)} jobs")
    return out


# ── TCBS (tcbs.com.vn) — WordPress careers listing, static SSR anchors ──
# Jobs are <a href=".../ve-chung-toi-cate/tuyen-dung/<slug>">[City] Title</a>
# in the page HTML (no WP REST). The [City] prefix on the title → location; the
# same href also appears as a "Read more:" link, so dedupe on href.
def _is_tcbs(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "tcbs.com.vn"


def _tcbs(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get(career_url or "https://www.tcbs.com.vn/ve-chung-toi/tuyen-dung/",
                         headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] tcbs failed: {str(e)[:80]}")
        return []
    out, seen = [], set()
    for a in soup.select('a[href*="/ve-chung-toi-cate/tuyen-dung/"]'):
        href = a.get("href") or ""
        title = re.sub(r"\s+", " ", a.get_text(" ", strip=True)).strip()
        if not href or not title or href in seen or title.lower().startswith("read more"):
            continue
        seen.add(href)
        m = re.match(r"\s*\[([^\]]+)\]\s*(.+)", title)
        loc, clean = (m.group(1).strip(), m.group(2).strip()) if m else ("Vietnam", title)
        out.append({"title": clean[:200],
                    "url": href if href.startswith("http") else "https://www.tcbs.com.vn" + href,
                    "location": (loc or "Vietnam")[:120], "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] tcbs → {len(out)} jobs")
    return out


# ── Canon Vietnam (cvn.canon) — static SSR recruitment listing ──
# Jobs are <a href="/vn/recruitment/<slug>.html"> whose sibling heading holds
# the role/department (the anchor text itself is a date/"JOB DESCRIPTION:"
# blurb). Page is UTF-8-SIG. Slug prefix tl_=Thang Long, ts_=Tien Son plant.
def _is_canon(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "cvn.canon"


def _canon(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get("https://cvn.canon/vn/latestjob.html", headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.content.decode("utf-8-sig", "ignore"), "html.parser")
    except Exception as e:
        logger.info(f"[ats] canon failed: {str(e)[:80]}")
        return []
    out, seen = [], set()
    for a in soup.select('a[href*="/vn/recruitment/"]'):
        href = a.get("href") or ""
        if not href or href in seen:
            continue
        seen.add(href)
        row = a.find_parent(["tr", "li", "div"])
        he = row.find(["h1", "h2", "h3", "h4", "h5", "strong", "b"]) if row else None
        title = re.sub(r"\s+", " ", he.get_text(" ", strip=True)).strip() if he else ""
        if not title:
            t = re.sub(r"\s+", " ", a.get_text(" ", strip=True)).strip()
            title = re.sub(r"^(JOB DESCRIPTION:\s*|Từ ngày.*?đến\s*\d{2}/\d{2}/\d{4}\s*)", "", t, flags=re.I)
        if not title or len(title) < 3:
            continue
        slug = href.rsplit("/", 1)[-1].lower()
        plant = "Thang Long" if slug.startswith("tl_") else "Tien Son" if slug.startswith("ts_") else ""
        out.append({"title": title[:200],
                    "url": href if href.startswith("http") else "https://cvn.canon" + href,
                    "location": (f"{plant}, Vietnam" if plant else "Vietnam"), "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] canon → {len(out)} jobs")
    return out


# ── GEEKUP / Geek Adventure (geekadventure.vn) — Next.js SSR listing ─────────
# geekadventure.vn is GEEKUP's employer-brand site; /opportunity is server-
# rendered. Each card: <a href="opportunity/<slug>">…<div class="body-text
# font-bold">[HCM] Title<!-- --></div>. The [City] title prefix → location.
# Pure HTML parse, no headless.
def _is_geekadventure(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "geekadventure.vn"


_GEEK_CARD_RE = re.compile(r'href="(opportunity/[a-z0-9-]+)"[^>]*>.*?body-text font-bold">(.*?)<!--', re.S)


def _geekadventure(career_url: str) -> list[dict]:
    try:
        r = requests.get("https://geekadventure.vn/opportunity", headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        html = r.text
    except Exception as e:
        logger.info(f"[ats] geekadventure failed: {str(e)[:80]}")
        return []
    out, seen = [], set()
    for href, raw in _GEEK_CARD_RE.findall(html):
        if href in seen:
            continue
        seen.add(href)
        title = _html.unescape(re.sub(r"\s+", " ", _strip_html(raw))).strip()
        loc = "Vietnam"
        m = re.match(r"^\[([^\]]+)\]\s*(.*)$", title)
        if m:
            tag, title = m.group(1), m.group(2).strip()
            tl = tag.lower()
            parts = []
            if "hcm" in tl or "ho chi minh" in tl:
                parts.append("Ho Chi Minh City")
            if re.search(r"\bhn\b|ha noi|hanoi", tl):
                parts.append("Hanoi")
            loc = ", ".join(parts + ["Vietnam"]) if parts else "Vietnam"
        if not title:
            continue
        out.append({"title": title[:200], "url": f"https://geekadventure.vn/{href}",
                    "location": loc[:120], "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] geekadventure → {len(out)} VN jobs")
    return out


# ── Garena (careers.garena.vn) — public job-search JSON API ──────────────────
# POST /api/job/list → {jobs:[{id, title, tags:{location[],job_category[]},
# description}]}. Regional board (SG/ID/VN/TW) → filter by tags.location. Detail
# page /vn/careers/<id>.
def _is_garena(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "careers.garena.vn"


def _garena(career_url: str) -> list[dict]:
    out = []
    try:
        r = requests.post("https://careers.garena.vn/api/job/list", headers=_JSON_POST, timeout=_TIMEOUT, json={})
        if r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
            return []
        jobs = (r.json() or {}).get("jobs", []) or []
    except Exception as e:
        logger.info(f"[ats] garena failed: {str(e)[:80]}")
        return []
    for j in jobs:
        title = (j.get("title") or "").strip()
        jid = j.get("id")
        tags = j.get("tags") or {}
        loc = ", ".join(tags.get("location") or [])
        if not title or not jid or not _is_vn_loc(loc):
            continue
        out.append({"title": title[:200], "url": f"https://careers.garena.vn/vn/careers/{jid}",
                    "location": loc[:120], "description": _strip_html(j.get("description") or "")[:600],
                    "category": ", ".join(tags.get("job_category") or [])[:120]})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] garena → {len(out)} VN jobs")
    return out


# ── SSI Securities (tuyendung.ssi.com.vn) — SSR listing ──────────────────────
# /tin-tuyen-dung lists <a href="/tin-tuyen-dung/<slug>">Title (City)</a>. The
# trailing "(City)" in the title carries the location.
def _is_ssi(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "tuyendung.ssi.com.vn"


def _ssi(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    base = "https://tuyendung.ssi.com.vn"
    try:
        r = requests.get(f"{base}/tin-tuyen-dung", headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] ssi failed: {str(e)[:80]}")
        return []
    out, seen = [], set()
    for a in soup.select('a[href*="/tin-tuyen-dung/"]'):
        href = a.get("href") or ""
        if href.rstrip("/").endswith("/tin-tuyen-dung"):
            continue
        title = re.sub(r"\s+", " ", a.get_text(" ", strip=True)).strip()
        url = href if href.startswith("http") else base + href
        if not title or url in seen:
            continue
        seen.add(url)
        loc = "Vietnam"
        m = re.search(r"\(([^)]+)\)\s*$", title)
        if m and _is_vn_loc(m.group(1)):
            loc = m.group(1).strip()
        out.append({"title": title[:200], "url": url, "location": loc[:120], "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] ssi → {len(out)} jobs")
    return out


# ── Appota (appota.com) — GraphQL careers API ────────────────────────────────
# POST /api/graphql/client op "jobs" → data.query.data[]{id, contents{title,
# workplace, description}}. Detail page /careers/jobs/<id>.
_APPOTA_JOBS_QUERY = (
    "query jobs($offset: Float, $limit: Float) { "
    "query: jobs(offset: $offset, limit: $limit) { total "
    "data { id contents { title workplace description } } } }"
)


def _is_appota(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "appota.com"


def _appota(career_url: str) -> list[dict]:
    body = {"operationName": "jobs", "variables": {"offset": 0, "limit": 50}, "query": _APPOTA_JOBS_QUERY}
    try:
        r = requests.post("https://appota.com/api/graphql/client", headers=_JSON_POST, timeout=_TIMEOUT, json=body)
        if r.status_code != 200:
            return []
        items = ((((r.json() or {}).get("data") or {}).get("query") or {}).get("data")) or []
    except Exception as e:
        logger.info(f"[ats] appota failed: {str(e)[:80]}")
        return []
    out = []
    for it in items:
        c = it.get("contents") or {}
        title = re.sub(r"\s+", " ", _strip_html(c.get("title") or "")).strip()
        jid = it.get("id")
        if not title or not jid:
            continue
        wp = (c.get("workplace") or "").strip()
        out.append({"title": title[:200], "url": f"https://appota.com/careers/jobs/{jid}",
                    "location": (wp or "Vietnam")[:120], "description": _strip_html(c.get("description") or "")[:600]})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] appota → {len(out)} jobs")
    return out


# ── Be (be.com.vn) — WordPress careers listing, static SSR anchors ──────────
# Jobs are <a href=".../be_recruitment/<slug>">Title</a>; each repeats an
# "Ứng tuyển ngay" apply link on the same href (+#form) → filter those. VN-only.
def _is_be(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "be.com.vn"


def _be(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get("https://be.com.vn/ve-be/tuyen-dung/", headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] be failed: {str(e)[:80]}")
        return []
    out, seen = [], set()
    for a in soup.select('a[href*="/be_recruitment/"]'):
        href = (a.get("href") or "").split("#")[0]
        title = re.sub(r"\s+", " ", a.get_text(" ", strip=True)).strip()
        if not href or not title or href in seen:
            continue
        if title.lower().startswith("ứng tuyển"):
            continue
        seen.add(href)
        out.append({"title": title[:200],
                    "url": href if href.startswith("http") else "https://be.com.vn" + href,
                    "location": "Vietnam", "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] be → {len(out)} jobs")
    return out


# ── Zalo (zalo.careers) — public JSON API (paginated), VN (HCM) tenant ───────
# GET /api/v2/jobs?page=N&option=getSliceJobs → {data:{total, values:[{name,
# slug, locationName, desc, require}]}}. Detail page is /job/<slug>.
def _is_zalo(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "zalo.careers"


def _zalo(career_url: str) -> list[dict]:
    out = []
    for page in range(1, 20):
        try:
            r = requests.get("https://zalo.careers/api/v2/jobs",
                             params={"page": page, "option": "getSliceJobs"},
                             headers=_JSON_POST, timeout=_TIMEOUT)
            if r.status_code != 200:
                break
            vals = ((r.json() or {}).get("data", {}) or {}).get("values", []) or []
        except Exception as e:
            logger.info(f"[ats] zalo page {page} failed: {str(e)[:80]}")
            break
        if not vals:
            break
        for j in vals:
            name = (j.get("name") or "").strip()
            slug = (j.get("slug") or "").strip()
            if not name or not slug:
                continue
            # Zalo re-noises every id field (slug/masterJobId/noisedId) on each
            # request — the slug carries a fresh 16-char token per call, so the
            # full URL is NOT a stable posting identity. Strip that trailing
            # token to get a stable external_id, else every cron re-inserts the
            # job as new (resetting created_at, deactivating the old row).
            stable = re.sub(r"-[A-Za-z0-9_-]{16}$", "", slug)
            out.append({"title": name[:200],
                        "url": f"https://zalo.careers/job/{slug}",
                        "external_id": f"zalo:{stable}",
                        "location": (j.get("locationName") or "Vietnam")[:120],
                        "description": _strip_html(j.get("desc") or "")[:600]})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] zalo → {len(out)} jobs")
    return out


# ── MoMo (momo.careers) — Next.js SSR shell over a request-signed JSON API ────
# The listing page prerenders only page 1 (12 of ~98). The full list is served
# by GET aws.momo.vn/momovn-api/public/v2/hr/get-list-job-with-filter, gated by
# an X-Client-Token header: base64(AES-256-CBC("<METHOD>§<HH:MM:SS>§<path?qs>§
# <bodyMD5>")). Both key and IV are hardcoded constants in the site's JS bundle
# (_app-*.js: `AES.encrypt(u, SHA256("Una34%^&xMpajd"), {mode:CBC, iv:
# Utf8.parse("da3iks0ndfm@#335")})`), so the signature is fully reproducible
# server-side — no browser/capture needed. Body MD5 is empty for GET requests.
_MOMO_API = "https://aws.momo.vn/momovn-api/public/v2/hr/get-list-job-with-filter"
_MOMO_KEY = _hashlib.sha256(b"Una34%^&xMpajd").digest()  # 32 bytes → AES-256
_MOMO_IV = b"da3iks0ndfm@#335"                            # 16-byte CBC IV
_MOMO_SEP = "§"                                      # § field separator


def _is_momo(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "momo.careers"


def _momo_sign(method: str, signed_url: str) -> tuple[str, str]:
    """Return (timestamp, X-Client-Token) for a MoMo API request. Timestamp is
    Vietnam-local HH:MM:SS (the API's own timezone); it must appear both in the
    header and inside the signed plaintext."""
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    ts = (_dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=7)).strftime("%H:%M:%S")
    plain = f"{method}{_MOMO_SEP}{ts}{_MOMO_SEP}{signed_url}{_MOMO_SEP}".encode("utf-8")
    pad = 16 - (len(plain) % 16)          # PKCS7
    plain += bytes([pad]) * pad
    enc = Cipher(algorithms.AES(_MOMO_KEY), modes.CBC(_MOMO_IV)).encryptor()
    return ts, _b64.b64encode(enc.update(plain) + enc.finalize()).decode()


def _momo_api() -> list[dict]:
    """Fetch the full opening list via the signed JSON API. Paginates by lastIdx
    until TotalItems is reached. Returns [] on any failure so the caller can fall
    back to the SSR/captured DOM."""
    out, last = [], 0
    for _ in range(12):  # safety cap; ~98 jobs at count=100 = one page today
        qs = f"sortType=1&sortDir=1&count=100&lastIdx={last}"
        ts, token = _momo_sign("GET", f"/v2/hr/get-list-job-with-filter?{qs}")
        try:
            r = requests.get(f"{_MOMO_API}?{qs}", timeout=_TIMEOUT, headers={
                **_HTML_HEADERS, "Accept": "application/json, text/plain, */*",
                "Origin": "https://momo.careers", "Referer": "https://momo.careers/",
                "X-Client-Device": "5", "X-Client-Id": "", "X-Client-Token": token,
                "X-Timestamp": ts, "X-Project": "careers"})
            if r.status_code != 200:
                logger.info(f"[ats] momo api HTTP {r.status_code}")
                break
            data = (r.json() or {}).get("Data") or {}
        except Exception as e:
            logger.info(f"[ats] momo api failed: {str(e)[:80]}")
            break
        items = data.get("Items") or []
        for it in items:
            slug = (it.get("subdirectory") or "").strip()
            title = (it.get("jobTitle") or "").strip()
            if not slug or not title:
                continue
            out.append({"title": title[:200],
                        "url": f"https://momo.careers/jobs/{slug}",
                        "location": (it.get("location") or "Hồ Chí Minh").strip()[:120],
                        "description": ""})
        total = data.get("TotalItems") or 0
        last += len(items)
        if not items or last >= total or len(out) >= _MAX_ATS_JOBS:
            break
    return out


def _momo(career_url: str, html: str | None = None) -> list[dict]:
    from bs4 import BeautifulSoup
    # Primary: the signed JSON API — full list, always fresh, no browser needed.
    if html is None:
        api = _momo_api()
        if api:
            logger.info(f"[ats] momo → {len(api)} jobs (signed api)")
            return api
        # API unreachable (key rotated / network) → the 12 live SSR cards.
        try:
            r = requests.get("https://momo.careers/jobs-opening", headers=_HTML_HEADERS, timeout=_TIMEOUT)
            if r.status_code != 200:
                return []
            html = r.text
        except Exception as e:
            logger.info(f"[ats] momo failed: {str(e)[:80]}")
            return []
    # DOM path: parses SSR fallback OR a captured/expanded snapshot (<a alt=Title
    # href=/jobs/slug> with a location chip). Kept as the API's safety net.
    soup = BeautifulSoup(html, "html.parser")
    out, seen = [], set()
    for a in soup.select('a[href*="/jobs/"]'):
        href = a.get("href") or ""
        title = (a.get("alt") or a.get_text(" ", strip=True)).strip()
        if not href or not title or href in seen:
            continue
        seen.add(href)
        chip = a.select_one("div.flex.items-center")
        loc = re.sub(r"\s+", " ", chip.get_text(" ", strip=True)).strip() if chip else ""
        # The chip trails the employment type ("… Fulltime") — drop it.
        loc = re.sub(r"\s*(Full[\s-]?time|Part[\s-]?time|Intern(?:ship)?|Contract|Freelance)\b.*$", "",
                     loc, flags=re.I).strip()
        out.append({"title": title[:200],
                    "url": href if href.startswith("http") else "https://momo.careers" + href,
                    "location": (loc or "Vietnam")[:120], "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] momo → {len(out)} jobs")
    return out


# ── VNPAY (tuyendung.vnpay.vn) — static SSR listing, VN-only tenant ──────────
# Jobs are <a href=".../tuyen-dung/<slug>">Title</a>; the same card repeats an
# "Ứng tuyển"/"Chia sẻ" (facebook share) link on the same href → filter those.
def _is_vnpay_tuyendung(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "tuyendung.vnpay.vn"


def _vnpay_tuyendung(career_url: str) -> list[dict]:
    from bs4 import BeautifulSoup
    try:
        r = requests.get("https://tuyendung.vnpay.vn/co-hoi-nghe-nghiep", headers=_HTML_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200:
            return []
        soup = BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        logger.info(f"[ats] vnpay failed: {str(e)[:80]}")
        return []
    out, seen = [], set()
    for a in soup.select('a[href*="/tuyen-dung/"]'):
        href = a.get("href") or ""
        title = re.sub(r"\s+", " ", a.get_text(" ", strip=True)).strip()
        if not href or "facebook.com" in href or href in seen:
            continue
        if not title or title.upper() in ("ỨNG TUYỂN", "CHIA SẺ"):
            continue
        seen.add(href)
        # City sometimes encoded in the slug as [da-nang]/[hcm]; else generic VN.
        slug = href.lower()
        loc = ("Đà Nẵng" if "da-nang" in slug else "Hồ Chí Minh" if "hcm" in slug
               else "Hà Nội" if "ha-noi" in slug or "hanoi" in slug else "Vietnam")
        out.append({"title": title[:200],
                    "url": href if href.startswith("http") else "https://tuyendung.vnpay.vn" + href,
                    "location": loc, "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] vnpay → {len(out)} jobs")
    return out


# ── VinaCapital (vinacapital.com/careers) — WordPress careers, static SSR ────
# The /careers page server-renders the job cards (no JS needed):
#   <div class="career_ti"><a href=".../careers/<slug>/">Title</a></div>
#   <div class="career_lo">Location</div>
# Fetch it directly when no html is supplied; a passed (rendered/captured) html
# is used as-is. VN-filtered by the .career_lo location.
def _is_vinacapital(career_url: str) -> bool:
    return (urlparse(career_url or "").netloc or "").lower().removeprefix("www.") == "vinacapital.com"


def _vinacapital(career_url: str, html: str | None) -> list[dict]:
    from bs4 import BeautifulSoup
    if not html:
        try:
            r = requests.get(career_url or "https://vinacapital.com/careers/",
                             headers=_HTML_HEADERS, timeout=_TIMEOUT)
            if r.status_code != 200:
                return []
            html = r.text
        except Exception as e:
            logger.info(f"[ats] vinacapital failed: {str(e)[:80]}")
            return []
    soup = BeautifulSoup(html, "html.parser")
    out, seen = [], set()
    for a in soup.select('.career_ti a[href*="/careers/"]'):
        href = a.get("href") or ""
        title = re.sub(r"\s+", " ", a.get_text(" ", strip=True)).strip()
        if not href or not title or href.rstrip("/").endswith("/careers"):
            continue
        url = href if href.startswith("http") else "https://vinacapital.com" + href
        if url in seen:
            continue
        seen.add(url)
        block = a.find_parent(class_="flex02")
        loc_el = block.select_one(".career_lo") if block else None
        loc = re.sub(r"\s+", " ", loc_el.get_text(" ", strip=True)).strip() if loc_el else ""
        if loc and not _is_vn_loc(loc):
            continue
        out.append({"title": title[:200], "url": url, "location": (loc or "Vietnam")[:120], "description": ""})
        if len(out) >= _MAX_ATS_JOBS:
            break
    logger.info(f"[ats] vinacapital → {len(out)} jobs")
    return out


__all__ = ['_ahamove', '_appota', '_be', '_canon', '_fptsoft', '_garena', '_geekadventure', '_ghn', '_is_ahamove', '_is_appota', '_is_be', '_is_canon', '_is_fptsoft', '_is_garena', '_is_geekadventure', '_is_ghn', '_is_iviec', '_is_mbbank', '_is_momo', '_is_ssi', '_is_tcbs', '_is_timo', '_is_trustingsocial', '_is_vinacapital', '_is_vnpay_tuyendung', '_is_workatsea', '_is_zalo', '_iviec', '_mbbank', '_momo', '_ssi', '_tcbs', '_timo', '_trustingsocial', '_vinacapital', '_vnpay_tuyendung', '_workatsea', '_zalo']
