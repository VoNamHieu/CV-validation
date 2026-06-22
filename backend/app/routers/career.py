"""
Career Finder API.

POST /career/find — discover a company's own career page (and its job listings)
starting from a TopCV/VNW URL, a homepage URL, or a free-text company name +
homepage. See app.services.career_finder for the underlying pipeline.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.career_finder import (
    find_careers,
    resolve_from_topcv_or_vnw,
    resolve_by_name,
    find_career_via_nav,
    brute_force_career_paths,
    find_via_sitemap,
    extract_jobs_from_career_page,
)
from app.services import company_cache
from app.services import cache
from app.services import capture_jobs
from app.services.gemini_client import discover_jobs_for_profile
from app.services.url_validator import is_allowed_url
from app.data.featured_companies import FEATURED_COMPANIES

import asyncio
import os
import time
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/career", tags=["Career Finder"])


# ── Models ────────────────────────────────────────────────────────────────────

class FindRequest(BaseModel):
    """Provide *one* of:
      - input_url: TopCV/VNW company profile or job posting URL
      - homepage_url: the company's own website
      - company_name: free-text name (only works if the company is in the cache)
    """
    input_url: str | None = Field(default=None, description="TopCV/VNW URL")
    homepage_url: str | None = Field(default=None, description="Company's own homepage")
    company_name: str | None = Field(default=None, description="Free-text company name")


class StageRequest(BaseModel):
    """For per-stage debug endpoints."""
    url: str


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/find")
async def find(req: FindRequest):
    """Run the full pipeline and return the discovered career page + jobs."""
    if not req.input_url and not req.homepage_url and not req.company_name:
        raise HTTPException(400, "Provide input_url, homepage_url, or company_name")
    for u in (req.input_url, req.homepage_url):
        if u and not is_allowed_url(u):
            raise HTTPException(400, f"URL not allowed: {u}")

    result = await find_careers(
        input_url=req.input_url,
        homepage_url=req.homepage_url,
        company_name=req.company_name,
    )
    return result.to_dict()


# ── Per-stage debug endpoints (useful while tuning the pipeline) ──

@router.post("/stage/resolve")
async def stage_resolve(req: StageRequest):
    """Stage 0: extract company name + website from a TopCV/VNW URL."""
    if not is_allowed_url(req.url):
        raise HTTPException(400, "URL not allowed")
    return (await resolve_from_topcv_or_vnw(req.url)).__dict__


@router.post("/stage/nav")
async def stage_nav(req: StageRequest):
    """Stage 1: parse the homepage <nav>/<footer> for career anchors."""
    if not is_allowed_url(req.url):
        raise HTTPException(400, "URL not allowed")
    hits = await find_career_via_nav(req.url)
    return {"candidates": [h.__dict__ for h in hits]}


@router.post("/stage/brute")
async def stage_brute(req: StageRequest):
    """Stage 2: brute-force common career paths."""
    if not is_allowed_url(req.url):
        raise HTTPException(400, "URL not allowed")
    hits = await brute_force_career_paths(req.url)
    return {"candidates": [h.__dict__ for h in hits]}


@router.post("/stage/sitemap")
async def stage_sitemap(req: StageRequest):
    """Stage 3: parse robots.txt + sitemap for career-shaped URLs."""
    if not is_allowed_url(req.url):
        raise HTTPException(400, "URL not allowed")
    hits = await find_via_sitemap(req.url)
    return {"candidates": [h.__dict__ for h in hits]}


@router.post("/stage/jobs")
async def stage_jobs(req: StageRequest):
    """Stage 4: list job postings on a given career page."""
    if not is_allowed_url(req.url):
        raise HTTPException(400, "URL not allowed")
    jobs = await extract_jobs_from_career_page(req.url)
    return {"jobs": [j.__dict__ for j in jobs]}


# ── Cache admin ──────────────────────────────────────────────────────────────

@router.get("/cache")
async def cache_list(limit: int = 100, offset: int = 0):
    """List cached company resolutions, newest first."""
    rows = company_cache.list_all(limit=limit, offset=offset)
    return {
        "stats": company_cache.stats(),
        "rows": [r.to_dict() for r in rows],
    }


@router.delete("/cache/{entry_id}")
async def cache_delete(entry_id: int):
    """Delete a single cached row by id."""
    ok = company_cache.delete(entry_id)
    if not ok:
        raise HTTPException(404, "Not found")
    return {"deleted": entry_id}


@router.post("/cache/clear")
async def cache_clear():
    """Wipe the cache."""
    n = company_cache.clear_all()
    return {"deleted_rows": n}


class NameLookup(BaseModel):
    name: str


@router.post("/cache/lookup-by-name")
async def cache_lookup_by_name(req: NameLookup):
    """Resolve a free-text company name against the cache only."""
    res = await resolve_by_name(req.name)
    return res.__dict__


# ── Featured companies (demo flow) ───────────────────────────────────────────
#
# Short-term path for the "Find jobs from my CV" button: instead of going
# through TopCV/VNW, run Stage 4 against a curated list of well-known
# Vietnamese employers' career pages and aggregate the openings. See
# `app/data/featured_companies.py`.

# Two-tier cache for the aggregated Stage-4 result:
#   L1 = in-process dict      → fastest, but lost when the dyno sleeps/restarts.
#   L2 = Redis (REDIS_URL)    → survives cold starts, so waking from sleep reads
#                               the last crawl instead of re-crawling 150 pages.
# Freshness is judged by the embedded timestamp, NOT the Redis TTL: Redis keeps
# the entry far longer (REDIS_TTL) so stale data is still available to serve
# immediately while a refresh runs in the background (stale-while-revalidate).
# Bump CACHE_VERSION (env) to invalidate ALL server caches after a deploy: the
# keys change namespace so old Redis entries are ignored. Set it to e.g. the
# Railway commit SHA ($RAILWAY_GIT_COMMIT_SHA) for automatic per-deploy busting,
# or just increment a number when you want a manual flush.
_CACHE_VERSION = os.getenv("CACHE_VERSION", "49")
_FEATURED_CACHE_TTL_SECONDS = 30 * 60          # how long a result counts as fresh
_FEATURED_REDIS_TTL_SECONDS = 24 * 60 * 60     # how long stale data survives in Redis
_FEATURED_CACHE_KEY = f"featured-jobs:v{_CACHE_VERSION}"
_featured_cache: dict[str, object] = {"at": 0.0, "data": None}

# Bound the Stage-4 fan-out. Fetching all ~150 featured companies at once opened
# ~150 Chromium contexts (and as many Gemini fallback calls) against the single
# shared browser → OOM → Railway returns 502 (the bug behind the empty
# "Find Jobs" page). Process at most this many concurrently. Raise once the dyno
# has more RAM. Override with FEATURED_FANOUT env if needed.
_FEATURED_FANOUT = max(1, int(os.getenv("FEATURED_FANOUT", "8")))
_featured_sema = asyncio.Semaphore(_FEATURED_FANOUT)

# Tuning / debug knobs.
_FEATURED_SLOW_S = float(os.getenv("FEATURED_SLOW_S", "15"))        # log per-company crawls slower than this
_FEATURED_COLD_WAIT_S = float(os.getenv("FEATURED_COLD_WAIT_S", "12"))  # max block on a fully-cold cache before returning "warming"

# A single in-flight refresh shared by all callers. Without this, every cold-cache
# request would launch its own 150-company crawl, multiplying the load.
_featured_refresh_task: "asyncio.Task | None" = None


async def _fetch_jobs_for(career_url: str) -> list[dict]:
    # The semaphore caps how many career pages crawl at the same time; the rest
    # await their turn instead of all hitting the browser at once.
    async with _featured_sema:
        t0 = time.time()
        try:
            jobs = await extract_jobs_from_career_page(career_url)
            elapsed = time.time() - t0
            # Slow pages are the ones that fell back to Playwright/LLM — surfacing
            # them tells us where the cold-crawl time actually goes.
            if elapsed > _FEATURED_SLOW_S:
                logger.warning(f"[featured] SLOW {elapsed:.1f}s ({len(jobs)} jobs) — {career_url}")
            # Cloudflare/bot-detected sites yield nothing server-side — fall back
            # to the latest browser-extension DOM capture for those hosts.
            if not jobs and capture_jobs.is_capture_host(career_url):
                cap = await capture_jobs.jobs_from_capture(career_url)
                if cap:
                    return cap
            return [j.__dict__ for j in jobs]
        except Exception as e:
            logger.warning(f"[featured] Stage 4 failed after {time.time() - t0:.1f}s for {career_url}: {e}")
            return []


async def _refresh_featured() -> list[dict]:
    """Crawl every featured company (concurrency-capped) and store in L1 + Redis.

    Run as one shared task so concurrent callers join the same crawl, and the
    caller awaits it under asyncio.shield so a client disconnect/timeout doesn't
    cancel a refresh that's almost done — the cache still warms for the next hit.
    """
    t0 = time.time()
    logger.info(
        f"[featured] refresh START — {len(FEATURED_COMPANIES)} companies, "
        f"max {_FEATURED_FANOUT} concurrent"
    )
    job_lists = await asyncio.gather(
        *[_fetch_jobs_for(c.career_url) for c in FEATURED_COMPANIES]
    )
    companies = [
        {
            "name": c.name,
            "homepage": c.homepage,
            "career_url": c.career_url,
            "jobs": jobs,
        }
        for c, jobs in zip(FEATURED_COMPANIES, job_lists)
    ]
    now = time.time()
    _featured_cache["data"] = companies
    _featured_cache["at"] = now
    # Persist to Redis so a future cold start serves this instead of re-crawling.
    await cache.set_json(
        _FEATURED_CACHE_KEY,
        {"at": now, "companies": companies},
        _FEATURED_REDIS_TTL_SECONDS,
    )
    total_jobs = sum(len(j) for j in job_lists)
    empty = sum(1 for j in job_lists if not j)
    logger.info(
        f"[featured] refresh DONE in {now - t0:.1f}s — "
        f"{len(companies)} companies, {total_jobs} jobs, {empty} empty/failed"
    )
    return companies


async def _read_featured_entry() -> "dict | None":
    """Best available cached entry as {"at", "companies"}, or None.

    Prefers the in-process L1 cache; falls back to Redis (L2) and warms L1 from
    it so the next same-process hit skips the round-trip.
    """
    mem_data = _featured_cache.get("data")
    mem_at = float(_featured_cache.get("at") or 0)
    best = {"at": mem_at, "companies": mem_data} if mem_data else None

    remote = await cache.get_json(_FEATURED_CACHE_KEY)
    if remote and float(remote.get("at") or 0) > (best["at"] if best else 0):
        best = remote
        _featured_cache["data"] = remote.get("companies")
        _featured_cache["at"] = remote.get("at")
    return best


def _ensure_refresh_task() -> asyncio.Task:
    """Return the shared refresh task, starting one if none is running."""
    global _featured_refresh_task
    if _featured_refresh_task is None or _featured_refresh_task.done():
        logger.info("[featured] starting background refresh task")
        _featured_refresh_task = asyncio.create_task(_refresh_featured())
    return _featured_refresh_task


async def warm_featured_cache() -> None:
    """Kick the crawl at app startup if the cache isn't fresh.

    Running it here (not on a user request) is what breaks the failure loop:
    the 150-page crawl no longer has to finish inside one request's timeout, and
    on Railway it isn't cancelled the moment the client gives up. Once it
    completes, Redis keeps the result so later cold starts serve instantly.
    """
    try:
        entry = await _read_featured_entry()
        if entry and time.time() - float(entry["at"]) < _FEATURED_CACHE_TTL_SECONDS:
            logger.info("[featured] warm-up skipped — cache already fresh")
            return
        logger.info("[featured] warm-up: triggering background refresh at startup")
        _ensure_refresh_task()
    except Exception as e:  # never let warm-up break startup
        logger.warning(f"[featured] warm-up failed (non-fatal): {e}")


@router.post("/featured-jobs")
async def featured_jobs(refresh: bool = False):
    """Aggregate jobs across all FEATURED_COMPANIES (parallel Stage 4).

    Never blocks on the full crawl: it serves cached data (fresh or stale) when
    available, and otherwise returns {"warming": true, "companies": []} fast so
    the client can poll instead of hanging until its request times out.

    Response:
        {
            "fetched_at": <unix seconds>,
            "from_cache": bool,
            "stale": bool,     # served stale while a refresh runs
            "warming": bool,   # no data yet; crawl in progress, poll again
            "companies": [ {"name", "homepage", "career_url", "jobs": [...]} ]
        }
    Pass `?refresh=true` to force a fresh crawl.
    """
    now = time.time()

    # Fast path: fresh L1 cache, no Redis round-trip.
    mem_data = _featured_cache.get("data")
    mem_at = float(_featured_cache.get("at") or 0)
    if not refresh and mem_data and now - mem_at < _FEATURED_CACHE_TTL_SECONDS:
        logger.info("[featured] serving L1 fresh")
        return {"fetched_at": mem_at, "from_cache": True, "stale": False,
                "warming": False, "companies": mem_data}

    entry = await _read_featured_entry()

    # Fresh entry (possibly from Redis after a cold start) → serve it.
    if not refresh and entry and now - float(entry["at"]) < _FEATURED_CACHE_TTL_SECONDS:
        logger.info("[featured] serving L2 (Redis) fresh")
        return {"fetched_at": entry["at"], "from_cache": True, "stale": False,
                "warming": False, "companies": entry["companies"]}

    # Need a refresh. Kick off (or join) the single shared crawl task.
    task = _ensure_refresh_task()

    # Stale-while-revalidate: serve any data we have (even expired) immediately.
    if not refresh and entry and entry.get("companies"):
        logger.info("[featured] serving STALE while revalidating")
        return {"fetched_at": entry["at"], "from_cache": True, "stale": True,
                "warming": False, "companies": entry["companies"]}

    # Fully cold (first ever run) or forced refresh. Wait only briefly — if the
    # crawl is nearly done we return real data, otherwise we hand back a warming
    # response so the client polls instead of blocking to its 120s timeout.
    fallback = entry.get("companies") if entry else []
    try:
        companies = await asyncio.wait_for(
            asyncio.shield(task), timeout=_FEATURED_COLD_WAIT_S
        )
        logger.info("[featured] cold crawl finished within wait window")
        return {"fetched_at": float(_featured_cache.get("at") or time.time()),
                "from_cache": False, "stale": False, "warming": False,
                "companies": companies}
    except asyncio.TimeoutError:
        logger.info(
            f"[featured] still warming after {_FEATURED_COLD_WAIT_S}s — "
            "returning warming response (crawl continues in background)"
        )
        return {"fetched_at": 0, "from_cache": bool(fallback),
                "stale": bool(fallback), "warming": True, "companies": fallback}


# ═══════════════════════════════════════════════════════════════════════════════
#  DYNAMIC DISCOVERY — grounded search by role → career pipeline
#  Alternative to the curated featured list: ask Gemini (google_search) which
#  companies are hiring for the candidate's role, then run Stage 1–4 on each.
#  Mirrors the featured-jobs caching (per role+location key) + warming contract.
# ═══════════════════════════════════════════════════════════════════════════════

_DISCOVER_TTL_SECONDS = 30 * 60
_DISCOVER_REDIS_TTL_SECONDS = 24 * 60 * 60
_DISCOVER_FANOUT = max(1, int(os.getenv("DISCOVER_FANOUT", "6")))
_discover_sema = asyncio.Semaphore(_DISCOVER_FANOUT)
_discover_mem: dict[str, dict] = {}            # cache key → {"at", "companies"}
_discover_tasks: dict[str, asyncio.Task] = {}  # cache key → in-flight refresh


def _discover_key(roles: list[str], domains: list[str], location: str) -> str:
    r = ",".join(sorted(x.strip().lower() for x in roles if x.strip()))
    d = ",".join(sorted(x.strip().lower() for x in domains if x.strip()))
    return f"discover:v{_CACHE_VERSION}:{r}|{d}|{location.strip().lower()}"


# Job boards / aggregators — a posting on one of these is NOT an official link,
# so we crawl it for the JD but resolve the company's own page for applying.
_AGGREGATOR_HOSTS = (
    "linkedin.com", "topcv.vn", "vietnamworks.com", "indeed.com", "glassdoor.com",
    "jobstreet.vn", "jobstreet.com", "careerbuilder.vn", "careerviet.vn", "itviec.com",
    "ybox.vn", "timviecnhanh.com", "jobsgo.vn", "123job.vn", "vieclam24h.vn",
    "joboko.com", "mywork.com.vn", "topdev.vn",
)


def _is_aggregator(host: str) -> bool:
    host = (host or "").lower()
    return any(host == a or host.endswith("." + a) for a in _AGGREGATOR_HOSTS)


async def _discover_company(company: dict) -> dict:
    """Build a company entry from grounded postings + its official career page.

    `company` = {"name", "postings": [{title, url}]}. The grounded postings are
    the role-specific openings — we keep them as the jobs (their URL is the real
    JD page used for scoring, even when it's an aggregator). We separately resolve
    the company's OWN site for display, and set each job's apply_url to the
    official posting when it lives on that domain, otherwise to the official
    career page — so an aggregator URL is crawled but never surfaced as the apply
    target.
    """
    async with _discover_sema:
        name = company.get("name") or ""
        postings = company.get("postings") or []
        t0 = time.time()

        # Dedupe postings.
        uniq: list[dict] = []
        seen: set[str] = set()
        for p in postings:
            url = (p.get("url") or "").strip()
            title = (p.get("title") or "").strip()
            if not url or not title or url in seen:
                continue
            seen.add(url)
            uniq.append({"title": title, "url": url})

        # Only resolve the company's official site when a posting lives on an
        # aggregator (so we have a non-aggregator apply link). Official postings
        # are applied to directly — which also skips a slow per-company crawl.
        need_official = (not uniq) or any(_is_aggregator(urlparse(p["url"]).netloc) for p in uniq)
        homepage = ""
        career_url = ""
        if need_official:
            try:
                result = await find_careers(company_name=name)
                homepage = result.resolution.website_url or ""
                career_url = result.chosen_career.url if result.chosen_career else homepage
            except Exception as e:
                logger.warning(f"[discover] official resolve failed for {name!r}: {e}")

        jobs: list[dict] = []
        for p in uniq:
            url = p["url"]
            host = urlparse(url).netloc
            if _is_aggregator(host):
                # Never surface the aggregator URL — apply at the official page.
                apply_url = career_url or homepage or url
            else:
                # Posting is on the company's own site → apply there directly.
                apply_url = url
                if not career_url:
                    career_url = f"{urlparse(url).scheme}://{host}"
            jobs.append({"title": p["title"], "url": url, "apply_url": apply_url, "location": ""})

        logger.info(
            f"[discover] {name!r} → {len(jobs)} postings, official={career_url or '∅'} "
            f"(resolved={need_official}) in {time.time() - t0:.1f}s"
        )
        return {
            "name": name,
            "homepage": homepage or career_url,
            "career_url": career_url,
            "jobs": jobs,
        }


async def _refresh_discover(roles: list[str], domains: list[str], strengths: list[str],
                            location: str, limit: int, key: str) -> list[dict]:
    t0 = time.time()
    logger.info(f"[discover] START roles={roles} domains={domains} loc={location!r} limit={limit}")
    # Job-first: grounded search for actual openings, then derive companies.
    # Blocking SDK call → run off the event loop.
    found = await asyncio.to_thread(discover_jobs_for_profile, roles, domains, strengths, location, limit)

    # Group postings by hiring company (dedup), keeping each posting's title+URL.
    by_company: dict[str, dict] = {}
    for j in found:
        comp = (j.get("company") or "").strip()
        title = (j.get("title") or "").strip()
        if not comp or not title:
            continue
        bucket = by_company.setdefault(comp.lower(), {"name": comp, "postings": []})
        bucket["postings"].append({"title": title, "url": (j.get("url") or "").strip()})
    inputs = list(by_company.values())[:limit]
    logger.info(
        f"[discover] grounded jobs → {len(found)} postings across "
        f"{len(by_company)} companies; resolving {len(inputs)}: "
        f"{[c['name'] for c in inputs]}"
    )
    if found and not inputs:
        logger.warning(f"[discover] {len(found)} postings had no usable company name: {found}")

    company_lists = await asyncio.gather(*[_discover_company(c) for c in inputs])
    # Keep only companies we could surface at least one official-linked job for.
    companies = [c for c in company_lists if c and c["jobs"]]

    now = time.time()
    _discover_mem[key] = {"at": now, "companies": companies}
    await cache.set_json(key, {"at": now, "companies": companies}, _DISCOVER_REDIS_TTL_SECONDS)
    total_jobs = sum(len(c["jobs"]) for c in companies)
    logger.info(
        f"[discover] DONE in {now - t0:.1f}s — {len(companies)} companies, {total_jobs} jobs"
    )
    return companies


@router.post("/discover")
async def discover_jobs(role: str = "", roles: str = "", domain: str = "",
                        strengths: str = "", location: str = "", limit: int = 8,
                        refresh: bool = False):
    """Find openings fitting a candidate profile (grounded search) + list jobs.

    Accepts a multi-signal profile (comma-separated): `roles` (target + adjacent),
    `domain`(s), `strengths`. `role` is kept for backward compatibility. Same
    response contract as /career/featured-jobs, cached per (roles, domains, loc).
    """
    def _split(s: str) -> list[str]:
        return [x.strip() for x in (s or "").split(",") if x.strip()]

    role_list = _split(roles) or _split(role)
    if not role_list:
        raise HTTPException(status_code=422, detail="role(s) required")
    domain_list = _split(domain)
    strength_list = _split(strengths)
    location = (location or "").strip()
    limit = max(1, min(int(limit or 8), 15))
    key = _discover_key(role_list, domain_list, location)
    now = time.time()

    # L1 fresh
    mem = _discover_mem.get(key)
    if not refresh and mem and now - float(mem["at"]) < _DISCOVER_TTL_SECONDS:
        logger.info(f"[discover] serving L1 fresh ({key})")
        return {"fetched_at": mem["at"], "from_cache": True, "stale": False,
                "warming": False, "companies": mem["companies"]}

    # L2 (Redis)
    remote = await cache.get_json(key)
    if remote and float(remote.get("at") or 0) > (float(mem["at"]) if mem else 0):
        _discover_mem[key] = remote
        mem = remote
    if not refresh and mem and now - float(mem["at"]) < _DISCOVER_TTL_SECONDS:
        logger.info(f"[discover] serving L2 fresh ({key})")
        return {"fetched_at": mem["at"], "from_cache": True, "stale": False,
                "warming": False, "companies": mem["companies"]}

    # Kick off (or join) the per-key refresh task.
    task = _discover_tasks.get(key)
    if task is None or task.done():
        task = asyncio.create_task(
            _refresh_discover(role_list, domain_list, strength_list, location, limit, key)
        )
        _discover_tasks[key] = task

    # Stale-while-revalidate.
    if not refresh and mem and mem.get("companies"):
        logger.info(f"[discover] serving STALE while revalidating ({key})")
        return {"fetched_at": mem["at"], "from_cache": True, "stale": True,
                "warming": False, "companies": mem["companies"]}

    # Cold: brief wait, then a warming response so the client polls.
    fallback = mem.get("companies") if mem else []
    try:
        companies = await asyncio.wait_for(asyncio.shield(task), timeout=_FEATURED_COLD_WAIT_S)
        return {"fetched_at": float((_discover_mem.get(key) or {}).get("at") or time.time()),
                "from_cache": False, "stale": False, "warming": False, "companies": companies}
    except asyncio.TimeoutError:
        logger.info(f"[discover] still warming after {_FEATURED_COLD_WAIT_S}s ({key})")
        return {"fetched_at": 0, "from_cache": bool(fallback),
                "stale": bool(fallback), "warming": True, "companies": fallback}


@router.get("/indeed-test")
async def indeed_test(q: str = "product manager", l: str = "Hà Nội", cc: str = "vn"):
    """DIAGNOSTIC (temporary): can THIS host scrape Indeed? Deploy to Railway and
    open /career/indeed-test to see whether the datacenter IP is blocked, how
    many real jobs come back, and whether a JD can be pulled from JSON-LD.
    Remove once we've decided on the discovery source."""
    from urllib.parse import quote
    from bs4 import BeautifulSoup
    from app.services.browser_pool import get_browser
    from app.services.crawler import crawl_url

    search_url = f"https://{cc}.indeed.com/jobs?q={quote(q)}&l={quote(l)}"
    report: dict = {"search_url": search_url}
    block_markers = ["captcha", "verify you are human", "cf-challenge", "px-captcha",
                     "unusual traffic", "just a moment", "additional verification", "hcaptcha"]

    browser = await get_browser()
    ctx = await browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        locale="vi-VN",
    )
    jobs: list[dict] = []
    try:
        page = await ctx.new_page()
        resp = await page.goto(search_url, timeout=40000, wait_until="domcontentloaded")
        await page.wait_for_timeout(3500)
        html = await page.content()
        txt = await page.evaluate("document.body ? document.body.innerText : ''")
        title = await page.title()
        report["status"] = resp.status if resp else None
        report["final_url"] = page.url
        report["page_title"] = title
        report["body_len"] = len(txt)
        report["blocked"] = any(m in (title + txt[:3000]).lower() for m in block_markers)

        soup = BeautifulSoup(html, "html.parser")
        seen: set[str] = set()
        for c in soup.select("div.job_seen_beacon, td.resultContent, [data-jk]"):
            jk = c.get("data-jk")
            if not jk:
                inner = c.select_one("[data-jk]")
                jk = inner.get("data-jk") if inner else None
            title_el = c.select_one("h2.jobTitle span, h2 span, a.jcs-JobTitle")
            comp = c.select_one("[data-testid='company-name'], span.companyName")
            t = title_el.get_text(strip=True) if title_el else ""
            if t and t not in seen:
                seen.add(t)
                jobs.append({
                    "title": t,
                    "company": comp.get_text(strip=True) if comp else "",
                    "jk": jk,
                })
        report["job_count"] = len(jobs)
        report["jobs_sample"] = jobs[:8]
    except Exception as e:
        report["error"] = str(e)[:200]
    finally:
        try:
            await ctx.close()
        except Exception:
            pass

    # Try pulling one JD (proves end-to-end: search → job page → JD via JSON-LD).
    jk = next((j["jk"] for j in jobs if j.get("jk")), None)
    if jk:
        jd_url = f"https://{cc}.indeed.com/viewjob?jk={jk}"
        report["jd_url"] = jd_url
        try:
            res = await crawl_url(jd_url)
            report["jd_len"] = res.cleaned_text_length
            report["jd_sample"] = (res.cleaned_text or "")[:400]
        except Exception as e:
            report["jd_error"] = str(e)[:200]

    return report
