"""Periodic store refresh — meant to run as a Railway Cron service.

Three jobs, in order:
  1. ``ingest_featured_ats`` — re-pull every featured company's ATS feed into
     the store (upsert new, refresh existing, deactivate ones that vanished,
     embed the unindexed). This is what keeps search fresh + prunes dead rows.
  2. a compat probe over every featured company that came back with 0 jobs
     this run (known-ATS feed gone quiet, OR no adapter at all yet) — tells
     apart "the company genuinely has 0 matching postings right now" from
     "our adapter/crawl for this company broke" from "nobody's built an
     adapter for this bespoke site yet, but it does render real jobs"
     (mirrors POST /compat/scan, minus the admin HTTP hop). link_health (#3)
     only catches dead JOB-DETAIL links; this catches the company/feed level
     going dark — for ALL featured companies, not just already-ATS ones.
  3. a link-health scan over the featured cache — validate job URLs and log the
     broken/suspect ones (mirrors POST /monitor/scan, minus the admin HTTP hop).

Runs as a ONE-OFF process (starts, works, exits) — exactly Railway's cron model.
No HTTP, no admin token: it calls the service layer directly. Needs the same
env as the web service (DATABASE_URL, GEMINI_API_KEY, …).

Invoke (Railway cron "Custom Start Command", WORKDIR /app):
    python -m app.tasks.cron_refresh
"""
from __future__ import annotations

import asyncio
import logging
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cron_refresh")

# How many featured job URLs to health-check per run (bounded — keep the cron short).
_SCAN_LIMIT = int(os.getenv("CRON_SCAN_LIMIT", "300"))
_SCAN_CONCURRENCY = 12
_COMPAT_CONCURRENCY = 4  # compat probe renders (SPA sniff) — keep light


async def _compat_check(empty_companies: list[dict]) -> dict:
    """For every featured company this run's ingest found 0 jobs for —
    known-ATS feed gone quiet, or no adapter at all — escalate to the full
    compat probe (adds render + SPA-sniff + capture-check) and log the
    verdict. Distinguishes "empty feed" (fine — e.g. a company simply has no
    VN openings right now) from "needs_new_adapter"/"unsupported" (broken or
    never-built extractor) from "supported_render" (a real adapter would
    work, nobody's written one yet)."""
    if not empty_companies:
        return {"checked": 0, "flagged": 0}

    from app.services import career_compat

    sem = asyncio.Semaphore(_COMPAT_CONCURRENCY)

    async def check(c: dict) -> dict:
        async with sem:
            res = await career_compat.probe(c["career_url"])
        await career_compat.record(c["career_url"], res, company=c["name"], source="cron")
        return {**c, **res}

    results = await asyncio.gather(*[check(c) for c in empty_companies], return_exceptions=True)
    flagged = [r for r in results if isinstance(r, dict) and not r.get("usable")]
    for r in flagged:
        logger.warning("[cron] %s (%s) ATS feed empty — verdict=%s detail=%s",
                        r["name"], r.get("ats"), r.get("verdict"), r.get("detail"))
    return {"checked": len(empty_companies), "flagged": len(flagged)}


async def _link_scan() -> dict:
    """Validate featured job URLs and log broken/suspect ones. Self-contained
    mirror of the /monitor/scan route (no admin dependency)."""
    from app.routers.career import _read_featured_entry
    from app.services import link_health

    entry = await _read_featured_entry()
    companies = (entry or {}).get("companies") or []
    jobs: list[dict] = []
    for c in companies:
        cname = c.get("name", "")
        for j in c.get("jobs", []):
            url = (j.get("url") or "").strip()
            if url:
                jobs.append({"url": url, "title": j.get("title", ""), "company": cname})
    jobs = jobs[:_SCAN_LIMIT]

    sem = asyncio.Semaphore(_SCAN_CONCURRENCY)

    async def check(job: dict) -> dict:
        async with sem:
            res = await link_health.validate_job_url(job["url"], job["title"])
        return {**job, **res}

    results = await asyncio.gather(*[check(j) for j in jobs], return_exceptions=True)
    logged = {e.get("url") for e in await link_health.list_links()}

    broken = unknown = ok = 0
    for r in results:
        if isinstance(r, Exception) or not isinstance(r, dict):
            continue
        st = r.get("status")
        if st == "ok":
            ok += 1
            if r["url"] not in logged:
                continue  # don't bloat the log with healthy rows
        elif st == "broken":
            broken += 1
        else:
            unknown += 1
        await link_health.record(
            r["url"], company=r.get("company", ""), title=r.get("title", ""),
            source="cron", status=st, reason=r.get("reason", ""),
            http_code=r.get("http_code"), detail=r.get("detail", ""),
        )
    return {"scanned": len(jobs), "broken": broken, "unknown": unknown, "ok": ok}


async def main() -> None:
    from app.db.pool import close_pool
    from app.services.browser_pool import close_browser

    try:
        from app.services.job_ingest import ingest_featured_ats
        logger.info("[cron] ingest_featured_ats starting…")
        ingest = await ingest_featured_ats(render=False)
        logger.info("[cron] ingest done: %s", ingest)

        empty = ingest.get("ats_feed_empty") or []
        logger.info("[cron] compat check starting (%d empty known-ATS feed(s))…", len(empty))
        compat = await _compat_check(empty)
        logger.info("[cron] compat check done: %s", compat)

        logger.info("[cron] link scan starting (limit=%s)…", _SCAN_LIMIT)
        scan = await _link_scan()
        logger.info("[cron] link scan done: %s", scan)

        # Prune promoted landing pages whose backing job just went inactive
        # (deactivate_missing ran during ingest above) — a closed posting
        # shouldn't keep a public "apply" page.
        from app.db import promoted
        dead = await promoted.delete_dead()
        logger.info("[cron] promoted cleanup: deleted %d dead page(s)%s",
                    len(dead), (" — " + ", ".join(dead[:20])) if dead else "")
    except Exception:
        logger.exception("[cron] refresh failed")
        raise
    finally:
        await close_browser()
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
