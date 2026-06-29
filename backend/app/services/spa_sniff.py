"""Generic custom-SPA job ingester.

Many bespoke career SPAs (Atlassian, Samsung, FPT, HSBC, …) have no standard
ATS but DO load their jobs from an internal JSON API. Rather than write a
per-company adapter, we render the page, observe which JSON endpoint it calls
for the job list, then re-fetch that endpoint and parse it with shape-agnostic
heuristics. Returns [{title, url, location, description}].
"""
from __future__ import annotations

import logging
import re
from urllib.parse import urljoin, urlparse

# Some SPAs expose only a bare slug in their job API; the public detail page
# lives under a fixed route prefix that a plain origin-join can't recover (so
# the job 404s). Map such hosts → the detail-route prefix. VNG is a Next.js
# i18n site whose job route is /vi/tim-kiem-viec-lam/chi-tiet/[slug].
_SLUG_DETAIL_PREFIX = {
    "career.vng.com.vn": "/vi/tim-kiem-viec-lam/chi-tiet/",
}

import requests

logger = logging.getLogger(__name__)

_TIMEOUT = 15
_HEADERS = {"User-Agent": "Mozilla/5.0 Chrome/120", "Accept": "application/json, */*"}
_JOB_URL_RX = re.compile(
    r"(job|career|opening|position|posting|listing|vacanc|search|requisition|"
    r"tuyendung|tuyen-dung|tuyen_dung|tuyen|viec-lam|vieclam|vi-tri|vitri|"
    r"ung-tuyen|cong-viec|congviec|tindung|co-hoi)", re.I)
_NOISE = ("google", "facebook", "doubleclick", "/gtm", "analytics", "hotjar", "segment",
          "clarity", "sentry", "cdn", "gstatic", "/fonts", "linkedin", "branding",
          ".js", ".css", ".png", ".svg", ".woff", "cookie", "tracking", "config", "settings")

_TITLE_KEYS = ("title", "name", "jobtitle", "positiontitle", "text", "postingtitle", "displayname",
               "tenvitri", "vitri", "tencongviec", "tieude", "jobname", "positionname", "tendangtin")
_URL_KEYS = ("applyurl", "joburl", "url", "canonicalurl", "absolute_url", "hostedurl",
             "externalpath", "apply_url", "detailurl", "link", "slug", "alias", "duongdan")
_LOC_KEYS = ("locationstext", "location", "locations", "city", "primarylocation", "joblocation",
             "diadiem", "noilamviec", "tinhthanh", "province")
_DESC_KEYS = ("description", "jobdescription", "overview", "responsibilities", "content", "summary")

# Role words used to tell a real job title from a look-alike list (provinces,
# region codes, menu items) when scoring candidate JSON lists. Substring match
# on the accent-stripped title.
_ROLE_RX = re.compile(
    r"chuyen vien|nhan vien|truong|giam doc|pho |ky thuat|ky su|thuc tap|"
    r"chuyen gia|quan ly|nhan su|tro ly|giam sat|cong nhan|tai xe|lai xe|"
    r"manager|engineer|specialist|executive|officer|intern|associate|director|"
    r"analyst|developer|designer|consultant|supervisor|accountant|technician|"
    r"senior|junior|lead|head|sales|marketing|nhan vien|telesales",
    re.I)


def _norm_vi(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.replace("đ", "d").replace("Đ", "D").lower().strip()


# Extracts job-detail anchors from a rendered DOM (for SSR/RSC sites with no
# JSON API). Matches job-detail URL patterns; skips generic CTA link texts.
_DOM_JOBS_JS = """() => {
  const rx = new RegExp("recruit/|chi-tiet|cong-viec|vi-tri|tuyen-dung/|/job/|/jobs/|/positions?/|requisition|recruitment/", "i");
  const bad = new RegExp("/blog/|/tin-tuc|/news/|/event|facebook|tiktok|linkedin|youtube", "i");
  const cta = new RegExp("^(xem chi ti|xem th.m|ung tuyen|.ng tuy|apply|dang ky|.ng k|view|detail|chi ti.t|read more|learn more|nop don|n.p|video|tin t.c|see more|kh.m ph.)", "i");
  // Role words that strongly mark text as a job title (vi accents stripped). Used
  // to (a) accept anchors whose URL isn't job-shaped (root-level slugs) and
  // (b) pick the title cell out of a <table> row that has no detail link.
  const role = new RegExp("^(chuyen vien|nhan vien|truong |giam doc|pho |ky thuat|ky su|thuc tap|chuyen gia|quan ly|nhan su|tro ly|giam sat|truong nhom|truong phong|truong ca|truong bo|cong nhan|tai xe|lai xe|senior |junior |lead |head |manager|engineer|specialist|executive|officer|intern|associate|director|analyst|developer|designer|consultant|supervisor|accountant|technician|staff|sales |brand |trade )", "i");
  const locrx = new RegExp("ha noi|ho chi minh|hcm|sai gon|da nang|hai phong|can tho|binh duong|dong nai|bac ninh|hung yen|thai nguyen|long an|tinh |thanh pho|toan quoc|mien (bac|nam|trung)|remote|viet nam|vietnam", "i");
  const nav = new RegExp("chinh sach|tai lieu|chuong trinh|tin tuc|hoat dong|gioi thieu|lien he|ve chung toi|phuc loi|cau hoi|quy che|xem toan bo|cam nang|quy trinh tuyen|moi truong lam|van hoa|vi sao|saved job|talent pool|drop cv|^tu ngay \\\\d|^job description:?\\\\s*$", "i");
  const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/\\u0111/g,'d').trim();
  const firstLine = s => (s||'').split(String.fromCharCode(10)).map(x=>x.trim()).filter(Boolean)[0] || '';
  const seen = new Set(); const out = [];
  // (A) Anchors: href looks job-shaped, OR the link text reads like a role title.
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    if (bad.test(href) || seen.has(a.href)) continue;
    const card = a.closest('li, article, tr, [class*="card" i], [class*="item" i], [class*="job" i]');
    let title = firstLine(a.innerText);
    if (!title || cta.test(title)) {
      const h = card && card.querySelector('h1,h2,h3,h4,h5,[class*="title" i],[class*="name" i],[class*="position" i]');
      if (h) title = firstLine(h.innerText);
    }
    const titleIsRole = title && role.test(norm(title));
    if (!rx.test(href) && !titleIsRole) continue;
    if (nav.test(norm(title)) || nav.test(href.replace(/[-/]/g,' '))) continue;
    const nt = norm(title);
    if (nt === 'tuyen dung' || nt === 'viec lam' || nt === 'co hoi nghe nghiep') continue;
    if (!title || title.length < 5 || title.length > 120 || cta.test(title)) continue;
    const loc = card ? (card.querySelector('[class*="location" i], [class*="address" i], [class*="diadiem" i]') || {}).innerText : '';
    seen.add(a.href);
    out.push({ title, url: a.href, location: (loc||'').split(String.fromCharCode(10))[0].trim().slice(0,120), description: '' });
    if (out.length >= 60) break;
  }
  // (B) Table rows whose detail opens via JS (no <a>) — e.g. Ant-design tables.
  // Title = the cell that reads like a role; location = a cell matching a place.
  if (out.length < 3) {
    for (const tr of document.querySelectorAll('table tr')) {
      const tds = [...tr.querySelectorAll('td')].map(td => firstLine(td.innerText)).filter(Boolean);
      if (tds.length < 2) continue;
      const title = tds.find(t => role.test(norm(t)));
      if (!title || title.length < 5 || title.length > 120 || cta.test(title) || seen.has('row:'+title)) continue;
      // Use the row's detail link only when it points to a real sub-page; many
      // JS tables wrap rows in a link to the homepage/listing, which would make
      // every job share one URL (and collapse on dedupe). Fall back to a
      // title-fragment URL so rows stay distinct.
      let url = '';
      const a = tr.querySelector('a[href]');
      if (a) {
        try {
          const pu = new URL(a.href, location.href);
          if (pu.pathname && pu.pathname !== '/' && pu.pathname !== location.pathname) url = a.href;
        } catch (e) {}
      }
      if (!url) url = location.href.split('#')[0] + '#' + encodeURIComponent(title.slice(0,40));
      const loc = tds.find(t => locrx.test(norm(t))) || '';
      seen.add('row:'+title);
      out.push({ title, url, location: loc.slice(0,120), description: '' });
      if (out.length >= 60) break;
    }
  }
  return out;
}"""


def _first(d: dict, keys) -> str:
    low = {k.lower(): v for k, v in d.items()}
    for k in keys:
        v = low.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, dict):
            for kk in ("name", "label", "text", "value", "city"):
                if isinstance(v.get(kk), str) and v[kk].strip():
                    return v[kk].strip()
        if isinstance(v, list) and v:
            parts = [x if isinstance(x, str) else (x.get("name") or x.get("city") or x.get("label", "")
                     if isinstance(x, dict) else "") for x in v]
            joined = ", ".join(p for p in parts if p)
            if joined:
                return joined
    return ""


def _find_job_list(data):
    """Find the list of job objects in an arbitrary JSON payload."""
    if isinstance(data, list):
        if sum(1 for x in data[:5] if isinstance(x, dict)) >= 1:
            return data
        return []
    if isinstance(data, dict):
        best = []
        for v in data.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                # a list whose items look job-like (have a title-ish key)
                if any(any(k.lower() in _TITLE_KEYS for k in it) for it in v[:3]):
                    if len(v) > len(best):
                        best = v
            elif isinstance(v, dict):
                nested = _find_job_list(v)
                if len(nested) > len(best):
                    best = nested
        return best
    return []


def _strip(s: str) -> str:
    if s and "<" in s and ">" in s:
        from bs4 import BeautifulSoup
        return BeautifulSoup(s, "html.parser").get_text(separator="\n", strip=True)
    return s


def _items_to_jobs(items, origin: str) -> list[dict]:
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        title = _first(it, _TITLE_KEYS)
        if not title or len(title) < 3:
            continue
        url = _first(it, _URL_KEYS)
        if url and not url.startswith("http"):
            # Make absolute: protocol-relative ("//host/x"), root-relative
            # ("/x"), or a bare slug ("6742-foo" — many SPAs put the slug in a
            # url/slug field). A bare slug left as-is is an uncrawlable URL.
            if url.startswith("//"):
                url = "https:" + url
            else:
                slug = url.lstrip("/")
                host = (urlparse(origin).netloc or "").lower()
                prefix = _SLUG_DETAIL_PREFIX.get(host)
                # A bare slug (no path separators) on a host with a known detail
                # route → prepend that route, else origin-join would 404.
                if prefix and "/" not in slug:
                    url = f"{origin}{prefix}{slug}"
                else:
                    url = urljoin(origin + "/", slug)
        if not url:
            jid = it.get("id") or it.get("jobId") or it.get("slug")
            if jid:
                url = f"{origin}/job/{jid}"
            else:
                # No url and no id (e.g. 247Express table JSON) — keep rows
                # distinct with a title fragment so they don't collapse on dedupe.
                from urllib.parse import quote
                url = f"{origin}#{quote(title[:40])}"
        out.append({"title": title[:200], "url": url,
                    "location": _first(it, _LOC_KEYS)[:120],
                    "description": _strip(_first(it, _DESC_KEYS))})
    return out


# Keys (beyond title) that mark a list as real job postings — used to pick the
# job list out of a Next.js __NEXT_DATA__ tree without grabbing menus/banners.
_JOB_SIGNAL_KEYS = {
    "location", "locations", "locationstext", "city", "department", "departments",
    "category", "categories", "employmenttype", "employment_type", "dateposted",
    "jobid", "job_id", "requisitionid", "requisition_id", "team", "function",
    "workplace", "seniority", "salary", "postingdate", "jobtitle", "positiontitle",
    "joblocation", "applyurl", "joburl", "contracttype",
}


def _looks_like_job_list(items) -> bool:
    dicts = [x for x in items if isinstance(x, dict)][:5]
    if len(dicts) < 1:
        return False
    has_title = sum(1 for d in dicts if any(k.lower() in _TITLE_KEYS for k in d))
    has_signal = sum(1 for d in dicts if any(k.lower() in _JOB_SIGNAL_KEYS for k in d))
    avg_keys = sum(len(d) for d in dicts) / len(dicts)
    # Real postings carry a title, at least one job-specific field, and several
    # fields overall (menus/categories/addresses are thin title-only lists).
    return has_title >= 1 and has_signal >= 1 and avg_keys >= 4


def _walk_best_job_list(o):
    best: list = []

    def walk(x):
        nonlocal best
        if isinstance(x, list):
            if _looks_like_job_list(x) and len(x) > len(best):
                best = x
            for i in x[:5]:
                walk(i)
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
    walk(o)
    return best


def next_data_jobs(career_url: str) -> list[dict]:
    """Next.js SSG sites embed the job list in __NEXT_DATA__ — parse it from the
    SSR HTML (no render), choosing the list that actually looks like postings."""
    import json
    from urllib.parse import urlparse
    try:
        r = requests.get(career_url, headers={"User-Agent": "Mozilla/5.0 Chrome/120"}, timeout=_TIMEOUT)
        m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.S)
        if not m:
            return []
        items = _walk_best_job_list(json.loads(m.group(1)))
    except Exception:
        return []
    p = urlparse(career_url)
    return _items_to_jobs(items, f"{p.scheme}://{p.netloc}")


async def phenom_jobs(career_url: str) -> list[dict]:
    """Phenom People career sites load jobs via an opaque tokenized /widgets POST
    (no clean public API), but render clean job tiles into the DOM. Render the
    search page and read the [data-ph-at-job-title-text] tiles. Point the URL at
    a location-filtered search (…?location=Vietnam) so the tiles are already VN."""
    try:
        from app.services.browser_pool import get_browser
    except ImportError:
        return []
    browser = await get_browser()
    ctx = await browser.new_context(locale="en-US", user_agent="Mozilla/5.0 Chrome/120")
    page = await ctx.new_page()
    rows = []
    try:
        await page.goto(career_url, timeout=40000, wait_until="domcontentloaded")
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        await page.wait_for_timeout(3000)
        rows = await page.evaluate(
            """() => [...document.querySelectorAll('[data-ph-at-job-title-text]')].map(el => {
                // Real job tiles always have an adjacent /job/ link; language /
                // nav items carrying the same attribute do not — requiring the
                // link filters them out (works for DHL .jobs-list-item and UPS's
                // bare tiles alike).
                const item = el.closest('.jobs-list-item, li, article, [role="listitem"]') || el.parentElement;
                const a = el.closest('a[href*="/job/"]') ||
                          (item || document).querySelector('a[href*="/job/"]');
                const loc = item ? (item.querySelector('[data-ph-at-job-location-text], .job-location, [class*="location" i]') || {}).innerText : '';
                return { title: (el.innerText||'').trim(), url: a ? a.href : '', location: (loc||'').trim() };
            }).filter(j => j.title && j.url)"""
        )
    except Exception as e:
        logger.info(f"[phenom] render failed {career_url}: {str(e)[:60]}")
    finally:
        await ctx.close()
    logger.info(f"[phenom] {career_url[:60]} → {len(rows)} jobs")
    return rows[:50]


# ── OutSystems career portals ────────────────────────────────────────────────
# OutSystems SPAs (e.g. One Mount) load jobs via POST /screenservices/<module>/
# <screen>/ScreenDataSet… returning {data:{List:{List:[…]}}}. Each record nests
# the posting under sub-objects (JobRequest/Company/…). The list is server-side
# paginated (StartIndex/MaxRecord), so after finding the job endpoint we replay
# its POST in-page — the page's valid X-CSRFToken + module version come for free
# — with the page size bumped, pulling every opening in one shot. JD is left
# empty: it's resolved lazily from the detail page when scoring needs it.
_OUTSYSTEMS_DETAIL_PREFIX = {
    "careers.onemount.com": "/jobs/",   # detail page = /jobs/{JobRequest.Id}
}
_OS_SIZE_KEYS = ("maxrecord", "maxrecords", "pagesize", "recordsperpage",
                 "top", "limit", "pagelength", "rowcount")
_OS_OFFSET_KEYS = ("startindex", "startrow", "skip", "offset",
                   "pageindex", "pagenumber", "currentpage")


def is_outsystems(html: str) -> bool:
    h = (html or "").lower()
    return ("outsystemsapp" in h or "/scripts/outsystems" in h
            or "/moduleservices/moduleversioninfo" in h)


def _os_arrays(data):
    """Every array of dict records anywhere in an OutSystems response."""
    out = []

    def walk(x):
        if isinstance(x, list):
            if x and sum(isinstance(i, dict) for i in x[:5]) >= 1:
                out.append(x)
            for i in x[:8]:
                walk(i)
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
    walk(data)
    return out


def _os_core(rec: dict) -> dict:
    """The sub-object carrying the posting, else rec. Requires a NON-EMPTY
    title — sibling objects (Department/Company) often have an empty Name key
    that would otherwise win and yield a blank title."""
    for c in [rec, *(v for v in rec.values() if isinstance(v, dict))]:
        if _first(c, _TITLE_KEYS):
            return c
    return rec


def _os_clean_loc(loc: str) -> str:
    # OutSystems wraps multi-locations in '#': "#Hà Nội#Hồ Chí Minh#".
    return ", ".join(p.strip() for p in (loc or "").split("#") if p.strip())[:120]


def _os_records_to_jobs(records, origin: str, host: str) -> list[dict]:
    prefix = _OUTSYSTEMS_DETAIL_PREFIX.get(host, "/jobs/")
    out, seen = [], set()
    for rec in records:
        if not isinstance(rec, dict):
            continue
        core = _os_core(rec)
        low = {k.lower(): v for k, v in core.items()}
        title = _first(core, _TITLE_KEYS)
        if not title or len(title) < 3:
            continue
        jid = str(low.get("id") or low.get("jobid") or low.get("number") or "").strip()
        if not jid or jid == "0":
            continue
        company = ""
        for k, v in rec.items():
            if "company" in k.lower() and isinstance(v, dict):
                company = (v.get("OfficalName") or v.get("OfficialName")
                           or v.get("Name") or "").strip()
                break
        key = (title.lower(), jid)
        if key in seen:
            continue
        seen.add(key)
        out.append({"title": title[:200], "url": f"{origin}{prefix}{jid}",
                    "location": _os_clean_loc(_first(core, _LOC_KEYS)),
                    "company": company, "description": ""})
    return out


def _os_bump(obj):
    """Raise page-size keys + zero offset keys so a replay pulls all records."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            kl = k.lower()
            if isinstance(v, bool):
                continue
            if kl in _OS_SIZE_KEYS and isinstance(v, (int, float)):
                obj[k] = 200
            elif kl in _OS_OFFSET_KEYS and isinstance(v, (int, float)):
                obj[k] = 0
            else:
                _os_bump(v)
    elif isinstance(obj, list):
        for i in obj:
            _os_bump(i)
    return obj


def _os_score(jobs: list[dict]) -> tuple[int, int]:
    real = sum(1 for j in jobs
               if _ROLE_RX.search(_norm_vi(j["title"])) or j["title"].count(" ") >= 3)
    return (real, len(jobs))


async def outsystems_jobs(career_url: str) -> list[dict]:
    """Render an OutSystems career SPA, find its job-list screenservices endpoint,
    replay it with the page size bumped, and normalize every opening."""
    import asyncio
    import json
    try:
        from app.services.browser_pool import get_browser
    except ImportError:
        return []
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"
    host = (p.netloc or "").lower().removeprefix("www.")

    browser = await get_browser()
    ctx = await browser.new_context(locale="vi-VN", user_agent="Mozilla/5.0 Chrome/120")
    page = await ctx.new_page()

    reqs: dict = {}        # screenservices url -> {body, csrf}
    read_tasks: list = []
    best_jobs: list[dict] = []

    async def _read(resp):
        try:
            return resp.url, await resp.text()
        except Exception:
            return resp.url, ""

    def on_req(req):
        try:
            if "/screenservices/" in req.url and req.method == "POST":
                reqs[req.url] = {"body": req.post_data or "",
                                 "csrf": req.headers.get("x-csrftoken", "")}
        except Exception:
            pass

    def on_resp(r):
        try:
            if "/screenservices/" in r.url and "json" in r.headers.get("content-type", ""):
                if len(read_tasks) < 30:
                    read_tasks.append(asyncio.ensure_future(_read(r)))
        except Exception:
            pass

    page.on("request", on_req)
    page.on("response", on_resp)
    try:
        await page.goto(career_url, timeout=40000, wait_until="domcontentloaded")
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            pass
        await page.wait_for_timeout(2500)
        bodies = []
        if read_tasks:
            done = await asyncio.gather(*read_tasks, return_exceptions=True)
            bodies = [d for d in done if isinstance(d, tuple) and d[1]]

        # Pick the screenservices endpoint whose records read most like real jobs.
        best_url, best_score = "", (-1, -1)
        for url, body in bodies:
            try:
                data = json.loads(body)
            except Exception:
                continue
            for arr in _os_arrays(data):
                jobs = _os_records_to_jobs(arr, origin, host)
                score = _os_score(jobs)
                if jobs and score > best_score:
                    best_url, best_jobs, best_score = url, jobs, score

        # Replay the winning endpoint with page size bumped → all openings.
        meta = reqs.get(best_url)
        if best_jobs and meta and meta["body"]:
            try:
                bumped = _os_bump(json.loads(meta["body"]))
                full = await page.evaluate(
                    """async ({url, body, csrf}) => {
                        const r = await fetch(url, {method:'POST',
                          headers:{'Content-Type':'application/json; charset=UTF-8','X-CSRFToken':csrf},
                          body: JSON.stringify(body)});
                        return await r.text();
                    }""",
                    {"url": best_url, "body": bumped, "csrf": meta["csrf"]},
                )
                data = json.loads(full)
                more = []
                for arr in _os_arrays(data):
                    js = _os_records_to_jobs(arr, origin, host)
                    if len(js) > len(more):
                        more = js
                if len(more) > len(best_jobs):
                    best_jobs = more
            except Exception as e:
                logger.info(f"[outsystems] replay failed {host}: {str(e)[:60]}")
    except Exception as e:
        logger.info(f"[outsystems] render failed {career_url}: {str(e)[:60]}")
        best_jobs = []
    finally:
        await ctx.close()

    if best_jobs:
        logger.info(f"[outsystems] {origin} → {len(best_jobs)} jobs")
    return best_jobs[:200]


async def sniff_jobs(career_url: str) -> list[dict]:
    """Render the SPA, capture its job-list JSON endpoint(s), re-fetch + parse.
    First tries __NEXT_DATA__ (cheap, no render) for Next.js SSG sites."""
    import asyncio
    try:
        from app.services.browser_pool import get_browser
        from urllib.parse import urlparse
    except ImportError:
        return []
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"

    try:
        nd = await asyncio.to_thread(next_data_jobs, career_url)
        if nd:
            logger.info(f"[spa_sniff] {origin} → {len(nd)} jobs via __NEXT_DATA__")
            return nd
    except Exception:
        pass

    import json
    browser = await get_browser()
    ctx = await browser.new_context(locale="vi-VN", user_agent="Mozilla/5.0 Chrome/120")
    page = await ctx.new_page()

    read_tasks: list = []

    async def _read(resp):
        try:
            return resp.url, await resp.text()
        except Exception:
            return resp.url, ""

    def on_resp(r):
        # Capture any JSON the page fetches that could be a job list — covers
        # GET, POST and GraphQL (read the body directly, no re-fetch/replay).
        try:
            u = r.url
            ct = r.headers.get("content-type", "")
            if "json" not in ct or any(n in u.lower() for n in _NOISE):
                return
            ul = u.lower()
            if _JOB_URL_RX.search(u) or "graphql" in ul or "/api/" in ul:
                if len(read_tasks) < 30:
                    read_tasks.append(asyncio.ensure_future(_read(r)))
        except Exception:
            pass
    page.on("response", on_resp)
    try:
        await page.goto(career_url, timeout=35000, wait_until="domcontentloaded")
        try:
            await page.wait_for_load_state("networkidle", timeout=9000)
        except Exception:
            pass
        await page.wait_for_timeout(2000)
        bodies = []
        if read_tasks:
            done = await asyncio.gather(*read_tasks, return_exceptions=True)
            bodies = [d for d in done if isinstance(d, tuple) and d[1]]
        # Also harvest job-detail anchors from the RENDERED DOM — covers SSR /
        # Next.js App-Router sites (e.g. VPS) that have no clean JSON job API but
        # render <a href=".../chi-tiet-cong-viec/…">Title</a> links.
        dom_jobs = await page.evaluate(_DOM_JOBS_JS)
    except Exception as e:
        logger.info(f"[spa_sniff] render failed {career_url}: {str(e)[:60]}")
        bodies, dom_jobs = [], []
    finally:
        await ctx.close()

    parsed = []
    for url, body in bodies:
        try:
            parsed.append((url, json.loads(body)))
        except Exception:
            continue

    # Score a candidate list by how many of its titles read like real job titles.
    # A title counts when it contains a role word (chuyên viên / manager / …) or
    # is clearly a long multi-word phrase. This rejects look-alike lists that the
    # loose finder also returns — region codes ("ACS"), provinces ("Cao Bằng"),
    # single-word menu items — so a smaller real-job list outranks them.
    def _quality(jobs: list[dict]) -> int:
        if not jobs:
            return 0
        n = 0
        for j in jobs:
            t = j["title"]
            tn = _norm_vi(t)
            if _ROLE_RX.search(tn) or (t.count(" ") >= 4 and len(t) >= 22):
                n += 1
        return n

    best: list[dict] = []
    best_src = ""
    best_score = (-1, -1)  # (quality, count)
    for url, data in parsed:
        jobs = _items_to_jobs(_find_job_list(data), origin)
        score = (_quality(jobs), len(jobs))
        if jobs and score > best_score:
            best, best_src, best_score = jobs, url, score
    # Rendered DOM (role/job anchors + JS-only table rows). Prefer it when the
    # best JSON list looks like junk (low quality) or is thin.
    if dom_jobs and (_quality(dom_jobs), len(dom_jobs)) > best_score:
        best, best_src = dom_jobs, "rendered-DOM"
    if best:
        logger.info(f"[spa_sniff] {origin} → {len(best)} jobs via {best_src[:70]}")
    return best
