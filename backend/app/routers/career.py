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
from app.services.gemini_client import discover_companies_for_role
from app.services.url_validator import is_allowed_url
from app.data.featured_companies import FEATURED_COMPANIES

import asyncio
import os
import time

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
_FEATURED_CACHE_TTL_SECONDS = 30 * 60          # how long a result counts as fresh
_FEATURED_REDIS_TTL_SECONDS = 24 * 60 * 60     # how long stale data survives in Redis
_FEATURED_CACHE_KEY = "featured-jobs:v1"
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


def _discover_key(role: str, location: str) -> str:
    return f"discover:v1:{role.strip().lower()}:{location.strip().lower()}"


async def _discover_one(company: dict) -> dict:
    """Run the career pipeline (Stage 1–4) on one discovered company homepage."""
    async with _discover_sema:
        url = company.get("url") or ""
        try:
            result = await find_careers(homepage_url=url)
            return {
                "name": company.get("name") or result.resolution.company_name or "",
                "homepage": url,
                "career_url": result.chosen_career.url if result.chosen_career else url,
                "jobs": [j.__dict__ for j in result.jobs],
            }
        except Exception as e:
            logger.warning(f"[discover] pipeline failed for {url}: {e}")
            return {"name": company.get("name", ""), "homepage": url, "career_url": "", "jobs": []}


async def _refresh_discover(role: str, location: str, limit: int, key: str) -> list[dict]:
    t0 = time.time()
    logger.info(f"[discover] START role={role!r} loc={location!r} limit={limit}")
    # Grounded search is a blocking SDK call → run off the event loop.
    found = await asyncio.to_thread(discover_companies_for_role, role, location, limit)

    # Validate + dedupe the URLs Gemini returned before crawling anything.
    seen: set[str] = set()
    inputs: list[dict] = []
    for c in found:
        url = (c.get("url") or "").strip()
        if not url or not is_allowed_url(url) or url in seen:
            continue
        seen.add(url)
        inputs.append({"name": c.get("name", ""), "url": url})
    logger.info(f"[discover] grounded search → {len(found)} raw, {len(inputs)} valid companies")

    company_lists = await asyncio.gather(*[_discover_one(c) for c in inputs])
    companies = [c for c in company_lists if c]

    now = time.time()
    _discover_mem[key] = {"at": now, "companies": companies}
    await cache.set_json(key, {"at": now, "companies": companies}, _DISCOVER_REDIS_TTL_SECONDS)
    total_jobs = sum(len(c["jobs"]) for c in companies)
    logger.info(
        f"[discover] DONE in {now - t0:.1f}s — {len(companies)} companies, {total_jobs} jobs"
    )
    return companies


@router.post("/discover")
async def discover_jobs(role: str = "", location: str = "", limit: int = 8, refresh: bool = False):
    """Find companies hiring for `role` (grounded search) and list their jobs.

    Same response contract as /career/featured-jobs (companies + warming flag),
    cached per (role, location) so repeated searches are instant.
    """
    role = (role or "").strip()
    if not role:
        raise HTTPException(status_code=422, detail="role is required")
    location = (location or "").strip()
    limit = max(1, min(int(limit or 8), 15))
    key = _discover_key(role, location)
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
        task = asyncio.create_task(_refresh_discover(role, location, limit, key))
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
