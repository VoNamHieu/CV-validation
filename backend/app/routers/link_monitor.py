"""Link-health monitor API.

  POST /monitor/report    frontend pipeline reports a job it failed on (passive)
  GET  /monitor/links     list the logged broken/suspect links (for the UI)
  POST /monitor/scan      actively validate featured-job URLs, log the bad ones
  POST /monitor/recheck   re-validate one URL and update its record
  POST /monitor/remove    drop one URL from the log
  POST /monitor/clear     wipe the log

/report comes from the user pipeline (any logged-in user); everything else is
the admin panel — recheck/scan fetch caller-supplied URLs server-side, so they
must never be anonymous, and every URL passes the SSRF guard first.

See app.services.link_health for the validation heuristics.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.services import link_health
from app.services.auth import get_current_user_id, require_admin
from app.services.url_validator import is_allowed_url

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/monitor", tags=["Link Monitor"])

_SCAN_CONCURRENCY = 12


class ReportPayload(BaseModel):
    url: str = Field(..., max_length=2000)
    company: str = Field("", max_length=200)
    title: str = Field("", max_length=300)
    reason: str = Field("", max_length=200)
    source: str = Field("pipeline", max_length=40)


class UrlPayload(BaseModel):
    url: str = Field(..., max_length=2000)
    title: str = Field("", max_length=300)


@router.post("/report")
async def report(p: ReportPayload, _user: str = Depends(get_current_user_id)):
    """Passive feed: log a job the pipeline already failed on. We don't re-fetch
    here — the pipeline's own failure IS the signal."""
    if not is_allowed_url(p.url):
        raise HTTPException(status_code=400, detail="URL not allowed")
    rec = await link_health.record(
        p.url, company=p.company, title=p.title, source=p.source or "pipeline",
        status="broken", reason=p.reason or "pipeline_error",
    )
    return {"ok": True, "record": rec}


@router.get("/links")
async def links(_admin: str = Depends(require_admin)):
    items = await link_health.list_links()
    broken = sum(1 for e in items if e.get("status") == "broken")
    return {"count": len(items), "broken": broken, "links": items}


@router.post("/scan")
async def scan(limit: int = Query(150, ge=1, le=1000), company: str = Query(""),
               _admin: str = Depends(require_admin)):
    """Validate featured-job URLs and log the broken/suspect ones. Bounded by
    `limit`; optionally filter to one company (substring, case-insensitive)."""
    from app.routers.career import _read_featured_entry

    entry = await _read_featured_entry()
    companies = (entry or {}).get("companies") or []

    jobs: list[dict] = []
    cfilter = company.strip().lower()
    for c in companies:
        cname = c.get("name", "")
        if cfilter and cfilter not in cname.lower():
            continue
        for j in c.get("jobs", []):
            url = (j.get("url") or "").strip()
            if url:
                jobs.append({"url": url, "title": j.get("title", ""), "company": cname})

    total_available = len(jobs)
    truncated = total_available > limit
    jobs = jobs[:limit]

    sem = asyncio.Semaphore(_SCAN_CONCURRENCY)

    async def check(job: dict) -> dict:
        async with sem:
            res = await link_health.validate_job_url(job["url"], job["title"])
        return {**job, **res}

    results = await asyncio.gather(*[check(j) for j in jobs])

    # URLs already in the log — an 'ok' result only gets written when it's one of
    # these (a recovery), so a healthy scan doesn't bloat the log with ok rows.
    logged = {e.get("url") for e in await link_health.list_links()}

    broken = unknown = ok = 0
    for r in results:
        st = r["status"]
        if st == "ok":
            ok += 1
            if r["url"] not in logged:
                continue
        elif st == "broken":
            broken += 1
        else:
            unknown += 1
        await link_health.record(
            r["url"], company=r["company"], title=r["title"], source="healthcheck",
            status=st, reason=r["reason"], http_code=r["http_code"], detail=r["detail"],
        )

    logger.info(f"[monitor] scan: {len(jobs)} checked, {broken} broken, "
                f"{unknown} unknown, {ok} ok (of {total_available} available)")
    return {"scanned": len(jobs), "total_available": total_available,
            "truncated": truncated, "broken": broken, "unknown": unknown, "ok": ok}


@router.post("/recheck")
async def recheck(p: UrlPayload, _admin: str = Depends(require_admin)):
    if not is_allowed_url(p.url):
        raise HTTPException(status_code=400, detail="URL not allowed")
    res = await link_health.validate_job_url(p.url, p.title)
    if res["status"] == "ok":
        # Recovered → keep a record marked ok so the user sees the transition.
        rec = await link_health.record(
            p.url, title=p.title, source="recheck", status="ok",
            reason=res["reason"], http_code=res["http_code"], detail=res["detail"],
        )
    else:
        rec = await link_health.record(
            p.url, title=p.title, source="recheck", status=res["status"],
            reason=res["reason"], http_code=res["http_code"], detail=res["detail"],
        )
    return {"ok": True, "record": rec}


@router.post("/remove")
async def remove(p: UrlPayload, _admin: str = Depends(require_admin)):
    removed = await link_health.remove(p.url)
    return {"ok": True, "removed": removed}


@router.post("/clear")
async def clear(_admin: str = Depends(require_admin)):
    n = await link_health.clear()
    return {"ok": True, "cleared": n}
