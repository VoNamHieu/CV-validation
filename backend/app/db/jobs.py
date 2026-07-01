"""Repository for ``public.jobs`` — the searchable job index.

A job is unique per ``(company_id, external_id)`` so re-ingesting the same
posting refreshes it. The ``embedding`` (vector(768)) is written but never
SELECTed back into API payloads — it's huge and only used inside SQL for
cosine retrieval (``embedding <=> $query``).
"""
from __future__ import annotations

from typing import Optional, Sequence

from app.db.pool import get_pool, row_to_dict, rows_to_dicts

# Every column EXCEPT embedding — reads must not haul the vector around.
_COLS = (
    "id, company_id, external_id, title, location, description, role_family, "
    "industry, seniority, required_years_min, must_have, source_url, content_hash, "
    "is_active, last_seen_at, last_verified_at, dead_reason, indexed_at, apply_count, "
    "bookmark_count, hotness, created_at"
)


async def upsert(
    *,
    company_id: Optional[str],
    external_id: str,
    title: str,
    location: Optional[str] = None,
    description: Optional[str] = None,
    role_family: Optional[str] = None,
    industry: Optional[str] = None,
    seniority: Optional[str] = None,
    required_years_min: Optional[int] = None,
    must_have: Optional[list] = None,
    source_url: Optional[str] = None,
    content_hash: Optional[str] = None,
    embedding: Optional[Sequence[float]] = None,
) -> dict:
    """Insert/refresh a job keyed by (company_id, external_id).

    Marks the row active and bumps ``last_seen_at``; ``indexed_at`` is set when
    an embedding is supplied. ``embedding`` is COALESCEd so a metadata-only
    re-sweep doesn't wipe a previously computed vector."""
    pool = await get_pool()
    sql = f"""
        INSERT INTO jobs
            (company_id, external_id, title, location, description, role_family,
             industry, seniority, required_years_min, must_have, source_url,
             content_hash, embedding, is_active, last_seen_at, indexed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::vector, true, now(),
                CASE WHEN $13::vector IS NULL THEN NULL ELSE now() END)
        ON CONFLICT (company_id, external_id) DO UPDATE SET
            title              = EXCLUDED.title,
            location           = COALESCE(EXCLUDED.location, jobs.location),
            description        = COALESCE(EXCLUDED.description, jobs.description),
            role_family        = COALESCE(EXCLUDED.role_family, jobs.role_family),
            industry           = COALESCE(EXCLUDED.industry, jobs.industry),
            seniority          = COALESCE(EXCLUDED.seniority, jobs.seniority),
            required_years_min = COALESCE(EXCLUDED.required_years_min, jobs.required_years_min),
            must_have          = COALESCE(EXCLUDED.must_have, jobs.must_have),
            source_url         = COALESCE(EXCLUDED.source_url, jobs.source_url),
            content_hash       = COALESCE(EXCLUDED.content_hash, jobs.content_hash),
            embedding          = COALESCE(EXCLUDED.embedding, jobs.embedding),
            indexed_at         = CASE WHEN EXCLUDED.embedding IS NULL THEN jobs.indexed_at ELSE now() END,
            is_active          = true,
            dead_reason        = NULL,
            last_seen_at       = now()
        RETURNING {_COLS}
    """
    return row_to_dict(
        await pool.fetchrow(
            sql, company_id, external_id, title, location, description, role_family,
            industry, seniority, required_years_min, must_have, source_url,
            content_hash, embedding,
        )
    )


async def get(job_id: str) -> Optional[dict]:
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(f"SELECT {_COLS} FROM jobs WHERE id = $1", job_id)
    )


async def list_facet(
    *,
    role_family: Optional[str] = None,
    industry: Optional[str] = None,
    seniority: Optional[str] = None,
    is_active: bool = True,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Phase-1 facet listing: filter by role_family / industry / seniority,
    newest-and-hottest first. No embedding involved."""
    pool = await get_pool()
    conds = ["is_active = $1"]
    args: list = [is_active]
    if role_family:
        args.append(role_family)
        conds.append(f"role_family = ${len(args)}")
    if industry:
        args.append(industry)
        conds.append(f"industry = ${len(args)}")
    if seniority:
        args.append(seniority)
        conds.append(f"seniority = ${len(args)}")
    args.extend([limit, offset])
    sql = (
        f"SELECT {_COLS} FROM jobs WHERE {' AND '.join(conds)} "
        f"ORDER BY hotness DESC, created_at DESC LIMIT ${len(args)-1} OFFSET ${len(args)}"
    )
    return rows_to_dicts(await pool.fetch(sql, *args))


async def search_semantic(
    *,
    embedding: Sequence[float],
    limit: int = 20,
    role_family: Optional[str] = None,
    industry: Optional[str] = None,
) -> list[dict]:
    """Phase-2 vector retrieval over active jobs (cosine distance, HNSW).

    Returns each job dict plus a ``distance`` key (lower = closer). Optional
    facet pre-filters narrow the candidate set before the ANN scan."""
    pool = await get_pool()
    conds = ["is_active = true", "embedding IS NOT NULL"]
    args: list = [list(embedding)]
    if role_family:
        args.append(role_family)
        conds.append(f"role_family = ${len(args)}")
    if industry:
        args.append(industry)
        conds.append(f"industry = ${len(args)}")
    args.append(limit)
    sql = (
        f"SELECT {_COLS}, (embedding <=> $1) AS distance FROM jobs "
        f"WHERE {' AND '.join(conds)} ORDER BY embedding <=> $1 LIMIT ${len(args)}"
    )
    return rows_to_dicts(await pool.fetch(sql, *args))


async def list_for_facet(*, limit: int = 500) -> list[dict]:
    """Active jobs reshaped for the in-memory facet engine (app.search.facet).

    Joins the company so each dict carries the keys ``score_job`` expects:
    ``title, location, company, career_url, description, industry, url`` plus
    ``role_family`` / ``seniority`` for display. No embedding."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT j.title, j.location, j.source_url AS url, j.description,
               j.role_family, j.industry, j.seniority, j.required_years_min,
               j.must_have, c.name AS company, c.career_url
        FROM jobs j
        LEFT JOIN companies c ON c.id = j.company_id
        WHERE j.is_active
        ORDER BY j.hotness DESC, j.created_at DESC
        LIMIT $1
        """,
        limit,
    )
    return rows_to_dicts(rows)


async def deactivate_missing(company_id: str, live_external_ids: Sequence[str]) -> int:
    """ATS diff (v1 liveness): mark a company's active jobs dead when they're no
    longer in its current feed. Returns rows deactivated.

    Empty ``live_external_ids`` → no-op: a transient fetch that returns nothing
    must NOT wipe a company's whole pool. Reactivation happens automatically on
    the next successful ingest (``upsert`` sets is_active=true)."""
    if not company_id or not live_external_ids:
        return 0
    pool = await get_pool()
    rows = await pool.fetch(
        "UPDATE jobs SET is_active = false, dead_reason = 'left_feed', "
        "last_verified_at = now() "
        "WHERE company_id = $1 AND is_active "
        "AND NOT (external_id = ANY($2::text[])) "
        "RETURNING id",
        company_id, list(live_external_ids),
    )
    return len(rows)


async def mark_dead_by_url(source_url: str, reason: str) -> int:
    """Deactivate any active job with this source_url (apply-time gate found it
    dead). Returns rows affected (0 if the url isn't in the store)."""
    if not source_url:
        return 0
    pool = await get_pool()
    rows = await pool.fetch(
        "UPDATE jobs SET is_active = false, dead_reason = $2, last_verified_at = now() "
        "WHERE source_url = $1 AND is_active RETURNING id",
        source_url, reason,
    )
    return len(rows)


async def mark_dead(job_id: str, reason: str) -> None:
    pool = await get_pool()
    await pool.execute(
        "UPDATE jobs SET is_active = false, dead_reason = $2, last_verified_at = now() "
        "WHERE id = $1",
        job_id, reason,
    )


async def touch_verified(job_id: str) -> None:
    """Confirm a job is still live (content-based link monitor pass)."""
    pool = await get_pool()
    await pool.execute(
        "UPDATE jobs SET is_active = true, dead_reason = NULL, last_verified_at = now() "
        "WHERE id = $1",
        job_id,
    )
