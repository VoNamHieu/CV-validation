"""Phase-2 wiring: rerank a facet bucket with embeddings, cached so each job
embeds ~once (content-hash key) — the 80/20 of an index without the store.

In production this moves to index-time (embed on crawl, store the vector); here
we embed the top facet bucket at query-time but reuse via Redis so repeated
searches over the same pool don't re-embed. CV-query vector cached per text.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging

from app.services import cache
from app.search.embed import embed_jobs, embed_query, build_job_doc
from app.search.ranker import rerank

logger = logging.getLogger(__name__)

_NS = "emb:v1"
_TTL = 7 * 24 * 3600


def _h(s: str) -> str:
    return hashlib.sha1((s or "").encode("utf-8")).hexdigest()[:20]


async def _get_many(keys: list[str]) -> dict[str, list[float]]:
    pairs = await asyncio.gather(*(cache.get_json(f"{_NS}:{k}") for k in keys))
    return {k: v for k, v in zip(keys, pairs) if v}


async def rerank_bucket(jobs: list[dict], query_text: str, top: int = 60) -> list[dict]:
    """Embed (cached) the top `top` facet matches + the query, then rerank.
    Returns the full list with the bucket reordered ahead of the tail."""
    if not jobs or not query_text:
        return jobs
    bucket, tail = jobs[:top], jobs[top:]

    docs = [build_job_doc(j.get("title", "")) for j in bucket]
    keys = [_h(d) for d in docs]
    cached = await _get_many(keys)
    miss = [i for i, k in enumerate(keys) if k not in cached]
    if miss:
        try:
            vecs = await asyncio.to_thread(embed_jobs, [docs[i] for i in miss])
        except Exception as e:
            logger.info(f"[semantic] embed jobs failed: {str(e)[:80]}")
            return jobs  # degrade: keep facet order
        for i, v in zip(miss, vecs):
            cached[keys[i]] = v
            await cache.set_json(f"{_NS}:{keys[i]}", v, _TTL)
    for j, k in zip(bucket, keys):
        j["_vec"] = cached.get(k)

    qk = _h(query_text)
    qv = await cache.get_json(f"{_NS}:q:{qk}")
    if not qv:
        try:
            qv = await asyncio.to_thread(embed_query, query_text[:2000])
        except Exception as e:
            logger.info(f"[semantic] embed query failed: {str(e)[:80]}")
            return jobs
        await cache.set_json(f"{_NS}:q:{qk}", qv, _TTL)

    return rerank(qv, bucket) + tail
