"""Career-page compatibility API — can our pipeline pull jobs from a target
career page, and if not, why?

  POST /compat/probe      probe one career URL, log the verdict
  POST /compat/scan       probe the featured companies' career_url pool
  GET  /compat/results    list logged probe verdicts (for the UI)
  POST /compat/recheck    re-probe one URL and update its record
  POST /compat/remove     drop one URL from the log
  POST /compat/clear      wipe the log

See app.services.career_compat for the ladder/diagnostic logic.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.services import career_compat

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/compat", tags=["Career Compatibility"])

# SPA-sniff rungs spin Playwright, so keep the fan-out modest. career_compat
# only renders pages that already look careerish, but cap concurrency anyway.
_SCAN_CONCURRENCY = 4


class UrlPayload(BaseModel):
    url: str = Field(..., max_length=2000)
    company: str = Field("", max_length=200)


@router.post("/probe")
async def probe(p: UrlPayload):
    """Probe one career URL and log the verdict."""
    res = await career_compat.probe(p.url)
    rec = await career_compat.record(p.url, res, company=p.company, source="probe")
    return {"ok": True, "record": rec}


@router.post("/scan")
async def scan(limit: int = Query(100, ge=1, le=500), company: str = Query("")):
    """Probe the featured companies' own career pages and log each verdict.
    Bounded by `limit`; optionally filter to one company (substring, ci)."""
    from app.data.featured_companies import FEATURED_COMPANIES

    cfilter = company.strip().lower()
    targets: list[dict] = []
    for c in FEATURED_COMPANIES:
        if cfilter and cfilter not in c.name.lower():
            continue
        url = (getattr(c, "career_url", "") or "").strip()
        if url:
            targets.append({"url": url, "company": c.name})

    total_available = len(targets)
    truncated = total_available > limit
    targets = targets[:limit]

    sem = asyncio.Semaphore(_SCAN_CONCURRENCY)

    async def check(t: dict) -> dict:
        async with sem:
            res = await career_compat.probe(t["url"])
        await career_compat.record(t["url"], res, company=t["company"], source="scan")
        return {**t, **res}

    results = await asyncio.gather(*[check(t) for t in targets])

    by_verdict: dict[str, int] = {}
    for r in results:
        by_verdict[r["verdict"]] = by_verdict.get(r["verdict"], 0) + 1
    usable = sum(1 for r in results if r["usable"])

    logger.info(f"[compat] scan: {len(results)} probed, {usable} usable, "
                f"breakdown={by_verdict} (of {total_available} available)")
    return {"scanned": len(results), "total_available": total_available,
            "truncated": truncated, "usable": usable, "by_verdict": by_verdict,
            "results": results}


@router.get("/results")
async def results():
    items = await career_compat.list_results()
    usable = sum(1 for e in items if e.get("usable"))
    return {"count": len(items), "usable": usable, "results": items}


@router.post("/recheck")
async def recheck(p: UrlPayload):
    res = await career_compat.probe(p.url)
    rec = await career_compat.record(p.url, res, company=p.company, source="recheck")
    return {"ok": True, "record": rec}


@router.post("/remove")
async def remove(p: UrlPayload):
    removed = await career_compat.remove(p.url)
    return {"ok": True, "removed": removed}


@router.post("/clear")
async def clear():
    n = await career_compat.clear()
    return {"ok": True, "cleared": n}
