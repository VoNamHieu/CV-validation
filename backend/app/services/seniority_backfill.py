"""Seniority backfill — reclassify active jobs that have a description but no
seniority band, using the description-aware classifier (title had no level word,
but the body sometimes states it). Shared by the admin ingest trigger and the
cron refresh so both stay in step with embed_backfill.

Idempotent: only writes a level when the classifier now resolves one, and only
touches rows still null (see jobs_repo.list_missing_seniority). A row we still
can't read stays null — a missing band beats a wrong one.
"""
from __future__ import annotations

import logging

from app.db import jobs as jobs_repo

logger = logging.getLogger(__name__)


async def seniority_backfill(limit: int = 2000) -> int:
    """Fill in seniority for null-band jobs from their description. Returns the
    number of rows newly classified."""
    from app.search.taxonomy import classify_seniority

    todo = await jobs_repo.list_missing_seniority(limit=limit)
    if not todo:
        return 0
    n = 0
    for j in todo:
        level = classify_seniority(j.get("title") or "", j.get("description"))
        if not level:
            continue
        try:
            await jobs_repo.set_seniority(j["id"], level)
            n += 1
        except Exception as e:  # noqa: BLE001
            logger.info("seniority backfill: job %s failed: %s", j["id"], str(e)[:80])
    return n
