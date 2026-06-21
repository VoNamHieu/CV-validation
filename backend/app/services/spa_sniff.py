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


def _parse_api(api_url: str, origin: str) -> list[dict]:
    try:
        r = requests.get(api_url, headers=_HEADERS, timeout=_TIMEOUT)
        if r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
            return []
        items = _find_job_list(r.json())
    except Exception:
        return []
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


async def sniff_jobs(career_url: str) -> list[dict]:
    """Render the SPA, capture its job-list JSON endpoint(s), re-fetch + parse."""
    try:
        from app.services.browser_pool import get_browser
        from urllib.parse import urlparse
    except ImportError:
        return []
    p = urlparse(career_url)
    origin = f"{p.scheme}://{p.netloc}"
    candidates: list[str] = []

    browser = await get_browser()
    ctx = await browser.new_context(locale="vi-VN", user_agent="Mozilla/5.0 Chrome/120")
    page = await ctx.new_page()

    def on_resp(r):
        try:
            if r.request.method != "GET":
                return
            u = r.url
            ct = r.headers.get("content-type", "")
            if "json" in ct and _JOB_URL_RX.search(u) and not any(n in u.lower() for n in _NOISE):
                candidates.append(u)
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
    except Exception as e:
        logger.info(f"[spa_sniff] render failed {career_url}: {str(e)[:60]}")
    finally:
        await ctx.close()

    best: list[dict] = []
    for cu in dict.fromkeys(candidates):  # de-dup, keep order
        jobs = _parse_api(cu, origin)
        if len(jobs) > len(best):
            best = jobs
            logger.info(f"[spa_sniff] {origin} → {len(jobs)} jobs via {cu[:70]}")
    return best
