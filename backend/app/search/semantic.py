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
from app.search.embed import embed_jobs, embed_query, build_job_doc, strip_title_noise
from app.search.taxonomy import _norm
from app.search.ranker import rerank

logger = logging.getLogger(__name__)

_NS = "emb:v1"
_TTL = 7 * 24 * 3600
# Hard cap on how many jobs we embed+rerank in one query (cost/latency bound).
_MAX_RERANK = 250


def _h(s: str) -> str:
    return hashlib.sha1((s or "").encode("utf-8")).hexdigest()[:20]


async def _get_many(keys: list[str]) -> dict[str, list[float]]:
    pairs = await asyncio.gather(*(cache.get_json(f"{_NS}:{k}") for k in keys))
    return {k: v for k, v in zip(keys, pairs) if v}


async def rerank_bucket(jobs: list[dict], query_text: str, top: int = 60) -> list[dict]:
    """Embed (cached) a bucket of facet matches + the query, then rerank.
    Returns the full list with the bucket reordered ahead of the tail.

    The bucket must cover the whole PRIMARY tier, not a fixed `top`: within a
    facet-score tie (e.g. 193 Operations jobs all at 1.0) the first `top` are in
    arbitrary order, so a fixed cutoff can drop the genuinely-relevant jobs (an
    import/export role among generic Ops) BEFORE the cosine tie-breaker runs.
    Capped at _MAX_RERANK for cost; we log if a tier is bigger than that."""
    if not jobs or not query_text:
        return jobs
    # Strip rank words from the query too, so it matches the doc side (which
    # embeds the de-ranked title) — domain-vs-domain cosine, not rank-vs-rank.
    query_text = strip_title_noise(query_text)
    n_primary = sum(1 for j in jobs if (j.get("_facet") or {}).get("is_primary"))
    eff_top = min(max(top, n_primary), _MAX_RERANK)
    if n_primary > _MAX_RERANK:
        logger.info(f"[semantic] primary tier {n_primary} > cap {_MAX_RERANK} — "
                    f"reranking first {_MAX_RERANK}, rest stay in facet order")
    bucket, tail = jobs[:eff_top], jobs[eff_top:]

    # Pull literal phrase-matches out of the tail into the bucket, so an exact
    # "xuất nhập khẩu"-in-title job buried in a non-primary/low position still
    # gets reranked and floated to the top tier (ranker marks it _literal). This
    # is the hybrid: keyword recall on top of the semantic engine.
    qn = _norm(query_text)
    if len(qn) >= 4 and tail:
        in_bucket = set(map(id, bucket))
        pulled = [j for j in tail
                  if id(j) not in in_bucket and qn in _norm(j.get("title", ""))]
        if pulled:
            pulled_ids = set(map(id, pulled))
            bucket = bucket + pulled
            tail = [j for j in tail if id(j) not in pulled_ids]

    # Title + JD snippet make the vector discriminative; many ATS adapters
    # populate `description`, search-result-only jobs leave it blank (→ title-only).
    docs = [build_job_doc(j.get("title", ""), jd=j.get("description", "")) for j in bucket]
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

    reranked = rerank(qv, bucket, query_phrase=query_text)
    if logger.isEnabledFor(logging.INFO):
        # with_JD vs title_only exposes vector quality: a title-only bucket makes
        # cosine nearly flat → semantic can't discriminate (the usual "semantic
        # feels off" cause). cos/fin per top job shows if cosine is doing anything.
        with_jd = sum(1 for j in bucket if (j.get("description") or "").strip())
        logger.info(
            "[semantic] q=%r bucket=%d with_JD=%d title_only=%d | top: %s",
            query_text[:60], len(bucket), with_jd, len(bucket) - with_jd,
            " · ".join(
                f"{(j.get('title') or '')[:28]}[cos={j.get('_cos')},fin={j.get('_final')}]"
                for j in reranked[:6]
            ),
        )
    return reranked + tail
