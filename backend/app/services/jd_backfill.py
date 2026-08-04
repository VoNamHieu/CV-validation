"""JD backfill — materialize the full job description into the store for jobs
whose list adapter shipped an empty description.

List adapters set description="" on purpose (fetching each posting's JD at list
time would be N extra HTTP calls per company per cron cycle). This phase fills it
in afterwards, but ONLY via the fast by-URL detail adapters
(jd_resolver.resolve_jd_detail_only) — each gates on the URL, so a job on a
platform with no detail adapter is an instant no-op (no HTTP), leaving it to the
on-demand crawl at promote time. So it converges: resolver-covered jobs get a
stored JD once, then drop out of the queue; the rest cost nothing.

The queue is "thin OR teaser-sized" (not just empty) because a list adapter that
stored a ~300-char marketing teaser made a row look filled to every consumer —
the JD never got fetched, and the row could never re-enter this queue.
"""
from __future__ import annotations

import asyncio
import logging

from app.db import jobs as jobs_repo

logger = logging.getLogger(__name__)

_MAX_JD_CHARS = 8000


async def jd_backfill(limit: int = 800, concurrency: int = 8) -> int:
    """Store a clean JD for active jobs missing one, via the fast detail adapters.
    Returns the number of jobs updated."""
    from app.services.jd_resolver import resolve_jd_detail_only

    todo = await jobs_repo.list_missing_jd(limit=limit)
    if not todo:
        return 0
    sem = asyncio.Semaphore(concurrency)

    async def _one(j: dict) -> int:
        async with sem:
            try:
                jd = await asyncio.wait_for(
                    asyncio.to_thread(resolve_jd_detail_only, j["source_url"]), timeout=15)
            except Exception:  # timeout / resolver error — leave for next cycle
                return 0
        # Only an IMPROVEMENT is written: a teaser-sized row is in the queue too,
        # and a resolver that comes back shorter must not overwrite it.
        if not jd or len(jd) < 100 or len(jd) <= (j.get("desc_len") or 0):
            return 0
        try:
            await jobs_repo.set_description(j["id"], jd[:_MAX_JD_CHARS])
            return 1
        except Exception as e:  # noqa: BLE001
            logger.info("jd backfill: job %s update failed: %s", j["id"], str(e)[:80])
            return 0

    results = await asyncio.gather(*[_one(j) for j in todo], return_exceptions=True)
    return sum(r for r in results if isinstance(r, int))
