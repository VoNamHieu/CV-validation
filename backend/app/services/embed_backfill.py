"""Embedding backfill — shared by the admin ingest trigger and the cron
refresh, so both vectorize the same way instead of drifting."""
from __future__ import annotations

import asyncio
import logging

from app.db import jobs as jobs_repo

logger = logging.getLogger(__name__)


async def embed_backfill(limit: int = 1000) -> int:
    """Vectorize active jobs still missing an embedding so they show up in
    semantic search. Returns rows embedded."""
    from app.search.embed import build_job_doc, embed_jobs

    todo = await jobs_repo.list_unembedded(limit=limit)
    if not todo:
        return 0
    docs = [
        build_job_doc(j["title"], jd=j.get("description") or "", must_have=j.get("must_have"))
        for j in todo
    ]
    vectors = await asyncio.to_thread(embed_jobs, docs)
    n = 0
    for j, vec in zip(todo, vectors):
        if not vec:
            continue
        try:
            await jobs_repo.set_embedding(j["id"], vec)
            n += 1
        except Exception as e:  # noqa: BLE001
            logger.info("embed backfill: job %s failed: %s", j["id"], str(e)[:80])
    return n
