"""Periodic store refresh — meant to run as a Railway Cron service.

Four steps, in order — each wrapped in its own try/except (one step failing
logs and moves on; it does NOT abort the rest, since with restartPolicyType =
"NEVER" a hard-abort just means the whole refresh waits 8 hours):

  1. ``ingest_featured_ats`` — two-phase pull of every featured company's ATS
     feed into the store (see job_ingest.py's docstring for the phase split).
     Phase 2 (render + SPA-sniff) only runs when CRON_RENDER=1, and records a
     compat verdict straight from its own render result for every company it
     touches — there's no separate compat-probe step anymore, since that
     would just redo the same render/sniff work a moment later.
  2. ``embed_backfill`` — vectorize any job still missing its embedding, so
     it's reachable by semantic search (shared with the admin ingest trigger
     — see app/services/embed_backfill.py).
  3. a link-health scan over a RANDOM sample of the featured cache — validate
     job URLs and log the broken/suspect ones (mirrors POST /monitor/scan,
     minus the admin HTTP hop). Random, not a fixed prefix slice, so every
     job gets a turn across enough runs instead of only ever checking the
     same first 300.
  4. prune promoted landing pages whose backing job just went inactive.

The whole run is capped by an overall timeout (_TOTAL_TIMEOUT) — a stuck
render/DB call fails the run instead of blocking the next 8h cycle forever.

Runs as a ONE-OFF process (starts, works, exits) — exactly Railway's cron model.
No HTTP, no admin token: it calls the service layer directly. Needs the same
env as the web service (DATABASE_URL, GEMINI_API_KEY, …), plus:
  CRON_RENDER=1        — enable phase 2 (render + SPA-sniff) for companies
                         phase 1 left empty. Off by default (cheap-pass only).
  CRON_RENDER_LIMIT     — cap how many phase-1-empty companies phase 2
                         renders this run (unset = all of them). Meant for a
                         controlled first rollout, not steady-state use.

Invoke (Railway cron "Custom Start Command", WORKDIR /app):
    python -m app.tasks.cron_refresh
"""
from __future__ import annotations

import asyncio
import logging
import os
import random

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cron_refresh")

# How many featured job URLs to health-check per run (bounded — keep the cron short).
_SCAN_LIMIT = int(os.getenv("CRON_SCAN_LIMIT", "300"))
_SCAN_CONCURRENCY = 12
_TOTAL_TIMEOUT = 90 * 60  # hard ceiling for the whole run; cadence is 8h


async def _link_scan() -> dict:
    """Validate a random sample of featured job URLs and log broken/suspect
    ones. Self-contained mirror of the /monitor/scan route (no admin dep).

    Random sample, not jobs[:_SCAN_LIMIT] — a fixed prefix slice would only
    ever re-check the same first N URLs every run (stably ordered cache),
    leaving everything past that index never health-checked."""
    from app.routers.career import _read_featured_entry
    from app.services import link_health

    # cache.get_json swallows its own errors and returns None either way, so
    # an empty read here is ambiguous: "no cache yet" (fine) vs. "Redis had a
    # transient timeout" (should retry, not silently report a 0-job scan as
    # if it were a clean, complete run — this has been observed live: a
    # single Upstash read timeout zeroed out the whole scan for a cycle).
    # One short retry is cheap and fixes the common transient case; if the
    # cache is genuinely empty it just costs an extra ~cheap read.
    entry = await _read_featured_entry()
    if not entry:
        await asyncio.sleep(2)
        entry = await _read_featured_entry()
        if not entry:
            logger.warning("[cron] link scan: featured cache read empty after retry — "
                           "either genuinely no cache yet, or Redis is unreachable")
    companies = (entry or {}).get("companies") or []
    jobs: list[dict] = []
    for c in companies:
        cname = c.get("name", "")
        for j in c.get("jobs", []):
            url = (j.get("url") or "").strip()
            if url:
                jobs.append({"url": url, "title": j.get("title", ""), "company": cname})
    jobs = random.sample(jobs, min(len(jobs), _SCAN_LIMIT))

    sem = asyncio.Semaphore(_SCAN_CONCURRENCY)

    async def check(job: dict) -> dict:
        async with sem:
            res = await link_health.validate_job_url(job["url"], job["title"])
        return {**job, **res}

    results = await asyncio.gather(*[check(j) for j in jobs], return_exceptions=True)
    logged = {e.get("url") for e in await link_health.list_links()}

    broken = unknown = ok = failed = 0
    for r in results:
        if isinstance(r, BaseException):
            # A systemic failure (Redis down, DNS broken in the container)
            # must NOT look like a clean small run — count it, don't drop it.
            failed += 1
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
    if failed:
        sample = next((r for r in results if isinstance(r, BaseException)), None)
        logger.warning("[cron] link scan: %d/%d check(s) raised an exception (sample: %s)",
                       failed, len(jobs), str(sample)[:200])
    return {"scanned": len(jobs), "broken": broken, "unknown": unknown, "ok": ok, "failed": failed}


async def _run() -> None:
    render = os.getenv("CRON_RENDER") == "1"
    render_limit_env = os.getenv("CRON_RENDER_LIMIT")
    render_limit = int(render_limit_env) if render_limit_env else None

    try:
        from app.services.job_ingest import ingest_featured_ats
        logger.info("[cron] ingest_featured_ats starting… (render=%s, render_limit=%s)",
                   render, render_limit)
        ingest = await ingest_featured_ats(render=render, render_limit=render_limit)
        logger.info("[cron] ingest done: %s", ingest)
    except Exception:
        logger.exception("[cron] ingest_featured_ats failed — continuing with remaining steps")

    try:
        from app.services.embed_backfill import embed_backfill
        logger.info("[cron] embedding backfill starting…")
        embedded = await embed_backfill()
        logger.info("[cron] embedding backfill done: %d job(s) embedded", embedded)
    except Exception:
        logger.exception("[cron] embedding backfill failed — continuing with remaining steps")

    try:
        logger.info("[cron] link scan starting (limit=%s)…", _SCAN_LIMIT)
        scan = await _link_scan()
        logger.info("[cron] link scan done: %s", scan)
    except Exception:
        logger.exception("[cron] link scan failed — continuing with remaining steps")

    try:
        # Prune promoted landing pages whose backing job just went inactive
        # (deactivate_missing ran during ingest above) — a closed posting
        # shouldn't keep a public "apply" page.
        from app.db import promoted
        dead = await promoted.delete_dead()
        logger.info("[cron] promoted cleanup: deleted %d dead page(s)%s",
                   len(dead), (" — " + ", ".join(dead[:20])) if dead else "")
    except Exception:
        logger.exception("[cron] promoted cleanup failed")


async def main() -> None:
    from app.db.pool import close_pool
    from app.services.browser_pool import close_browser

    try:
        await asyncio.wait_for(_run(), timeout=_TOTAL_TIMEOUT)
    except asyncio.TimeoutError:
        logger.error("[cron] refresh exceeded %ds hard timeout — aborting this run", _TOTAL_TIMEOUT)
    finally:
        await close_browser()
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
