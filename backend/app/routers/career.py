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

# Cache the aggregated result in-process so the demo doesn't pay the Stage 4
# cost on every CV upload. 30 minutes is short enough that newly-posted jobs
# show up within the same demo session, long enough to keep clicks snappy.
_FEATURED_CACHE_TTL_SECONDS = 30 * 60
_featured_cache: dict[str, object] = {"at": 0.0, "data": None}

# Bound the Stage-4 fan-out. Fetching all ~150 featured companies at once opened
# ~150 Chromium contexts (and as many Gemini fallback calls) against the single
# shared browser → OOM → Railway returns 502 (the bug behind the empty
# "Find Jobs" page). Process at most this many concurrently. Raise once the dyno
# has more RAM. Override with FEATURED_FANOUT env if needed.
_FEATURED_FANOUT = max(1, int(os.getenv("FEATURED_FANOUT", "8")))
_featured_sema = asyncio.Semaphore(_FEATURED_FANOUT)

# A single in-flight refresh shared by all callers. Without this, every cold-cache
# request would launch its own 150-company crawl, multiplying the load.
_featured_refresh_task: "asyncio.Task | None" = None


async def _fetch_jobs_for(career_url: str) -> list[dict]:
    # The semaphore caps how many career pages crawl at the same time; the rest
    # await their turn instead of all hitting the browser at once.
    async with _featured_sema:
        try:
            jobs = await extract_jobs_from_career_page(career_url)
            return [j.__dict__ for j in jobs]
        except Exception as e:
            logger.warning(f"[featured] Stage 4 failed for {career_url}: {e}")
            return []


async def _refresh_featured() -> list[dict]:
    """Crawl every featured company (concurrency-capped) and store in the cache.

    Run as one shared task so concurrent callers join the same crawl, and the
    caller awaits it under asyncio.shield so a client disconnect/timeout doesn't
    cancel a refresh that's almost done — the cache still warms for the next hit.
    """
    logger.info(
        f"[featured] refreshing {len(FEATURED_COMPANIES)} companies "
        f"(max {_FEATURED_FANOUT} concurrent)"
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
    _featured_cache["data"] = companies
    _featured_cache["at"] = time.time()
    return companies


@router.post("/featured-jobs")
async def featured_jobs(refresh: bool = False):
    """Aggregate jobs across all FEATURED_COMPANIES (parallel Stage 4).

    Response:
        {
            "fetched_at": <unix seconds>,
            "from_cache": bool,
            "companies": [
                {"name": ..., "homepage": ..., "career_url": ..., "jobs": [...]}
            ]
        }
    Pass `?refresh=true` to bust the in-memory TTL cache.
    """
    global _featured_refresh_task

    now = time.time()
    cached = _featured_cache.get("data")
    cached_at = float(_featured_cache.get("at") or 0)
    if (not refresh and cached
            and now - cached_at < _FEATURED_CACHE_TTL_SECONDS):
        return {"fetched_at": cached_at, "from_cache": True, "companies": cached}

    # Join the in-flight refresh if one exists, otherwise start one. Sharing a
    # single task dedupes concurrent cold-cache requests.
    if _featured_refresh_task is None or _featured_refresh_task.done():
        _featured_refresh_task = asyncio.create_task(_refresh_featured())
    task = _featured_refresh_task

    # shield: if THIS request is cancelled (client timeout/disconnect) the crawl
    # keeps running and still populates the cache for the next request.
    companies = await asyncio.shield(task)
    return {
        "fetched_at": float(_featured_cache.get("at") or time.time()),
        "from_cache": False,
        "companies": companies,
    }
