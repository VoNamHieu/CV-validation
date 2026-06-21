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

import requests

logger = logging.getLogger(__name__)

_TIMEOUT = 15
_HEADERS = {"User-Agent": "Mozilla/5.0 Chrome/120", "Accept": "application/json, */*"}
_JOB_URL_RX = re.compile(r"(job|career|opening|position|posting|listing|vacanc|search|requisition)", re.I)
_NOISE = ("google", "facebook", "doubleclick", "/gtm", "analytics", "hotjar", "segment",
          "clarity", "sentry", "cdn", "gstatic", "/fonts", "linkedin", "branding",
          ".js", ".css", ".png", ".svg", ".woff", "cookie", "tracking", "config", "settings")

_TITLE_KEYS = ("title", "name", "jobtitle", "positiontitle", "text", "postingtitle", "displayname")
_URL_KEYS = ("applyurl", "joburl", "url", "canonicalurl", "absolute_url", "hostedurl",
             "externalpath", "apply_url", "detailurl", "link")
_LOC_KEYS = ("locationstext", "location", "locations", "city", "primarylocation", "joblocation")
_DESC_KEYS = ("description", "jobdescription", "overview", "responsibilities", "content", "summary")


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
        if url and url.startswith("/"):
            url = origin + url
        if not url:
            jid = it.get("id") or it.get("jobId") or it.get("slug")
            url = f"{origin}/job/{jid}" if jid else origin
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
    except Exception as e:
        logger.info(f"[spa_sniff] render failed {career_url}: {str(e)[:60]}")
        bodies = []
    finally:
        await ctx.close()

    best: list[dict] = []
    best_src = ""
    for url, body in bodies:
        try:
            data = json.loads(body)
        except Exception:
            continue
        jobs = _items_to_jobs(_find_job_list(data), origin)
        if len(jobs) > len(best):
            best, best_src = jobs, url
    if best:
        logger.info(f"[spa_sniff] {origin} → {len(best)} jobs via {best_src[:70]}")
    return best
