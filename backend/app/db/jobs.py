"""Repository for ``public.jobs`` — the searchable job index.

A job is unique per ``(company_id, external_id)`` so re-ingesting the same
posting refreshes it. The ``embedding`` (vector(768)) is written but never
SELECTed back into API payloads — it's huge and only used inside SQL for
cosine retrieval (``embedding <=> $query``).
"""
from __future__ import annotations

import logging
from typing import Optional, Sequence
from urllib.parse import urlparse

from app.db.pool import get_pool, row_to_dict, rows_to_dicts

# Friendly platform label from an apply URL's host — companies.ats_type is
# unreliable/empty, so we derive the "site type" from where the job actually
# applies. Known ATS hosts map to a name; everything else falls back to the
# registrable domain, which is a fine per-site grouping for apply testing.
_ATS_HOSTS = [
    ("myworkdayjobs.com", "Workday"), ("smartrecruiters.com", "SmartRecruiters"),
    ("lever.co", "Lever"), ("greenhouse.io", "Greenhouse"), ("ashbyhq.com", "Ashby"),
    ("recruitee.com", "Recruitee"), ("eightfold.ai", "Eightfold"), ("avature.net", "Avature"),
    ("oraclecloud.com", "Oracle HCM"), ("taleo.net", "Taleo"), ("icims.com", "iCIMS"),
    ("workable.com", "Workable"), ("phenompeople.com", "Phenom"), ("phenom.com", "Phenom"),
    ("successfactors.com", "SuccessFactors"), ("sapsf.com", "SuccessFactors"),
    ("base.vn", "base.vn"), ("talent.vn", "base.vn"), ("mokahr.com", "MokaHR"),
    ("odoo.com", "Odoo"), ("radancy", "Radancy"),
]


def _platform_from_url(url: str) -> str:
    host = (urlparse(url or "").netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    for pat, name in _ATS_HOSTS:
        if pat in host:
            return name
    parts = host.split(".")
    # keep 3 labels for second-level TLDs (…com.vn, …co.uk), else the last 2
    if len(parts) >= 3 and parts[-2] in ("com", "co", "org", "net", "gov", "edu"):
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else (host or "khác")

logger = logging.getLogger(__name__)

# Anti-flap guard for deactivate_missing (see there). A feed run returning far
# fewer postings than the company currently has active is almost always a
# transient fetch failure, not a real mass-closure — pruning on it wipes good
# jobs. Skip the prune below these thresholds (mirrors career_compat's guard).
_PRUNE_MIN_BASELINE = 5         # ignore tiny boards (noise)
_PRUNE_DROP_RATIO = 0.6         # live set < 40% of active baseline → suspected flaky run

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


async def random_per_company(limit: int = 300) -> list[dict]:
    """ONE random ACTIVE job per company (each company = a distinct apply
    "site"), joined with its name / domain / ats_type. Powers the admin
    "test apply" panel: a representative live posting on every site so the
    extension's auto-apply can be exercised against each ATS / apply form.

    ``DISTINCT ON (company_id)`` with ``ORDER BY company_id, random()`` keeps the
    first row per company after a random shuffle → a random job for each. The
    outer query then re-orders alphabetically for a stable, scannable list."""
    pool = await get_pool()
    lim = max(1, min(limit, 2000))
    rows = await pool.fetch(
        """
        SELECT job_id, title, location, url, company, domain, ats_type
        FROM (
            SELECT DISTINCT ON (j.company_id)
                   j.id AS job_id, j.title AS title, j.location AS location,
                   j.source_url AS url, c.name AS company,
                   c.domain AS domain, c.ats_type AS ats_type
            FROM jobs j JOIN companies c ON c.id = j.company_id
            WHERE j.is_active = true
              AND j.source_url IS NOT NULL AND j.source_url <> ''
            ORDER BY j.company_id, random()
        ) t
        ORDER BY company NULLS LAST, domain NULLS LAST
        LIMIT $1
        """,
        lim,
    )
    out = rows_to_dicts(rows)
    for r in out:  # DB ats_type is empty → derive the apply-site platform from the URL
        r["ats_type"] = _platform_from_url(r.get("url") or "")
    return out


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


async def search_admin(
    *,
    q: Optional[str] = None,
    role_family: Optional[str] = None,
    industry: Optional[str] = None,
    seniority: Optional[str] = None,
    is_active: Optional[bool] = None,
    embedding: Optional[Sequence[float]] = None,
    sort: str = "hotness",
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Operator search over the whole job store (admin console).

    Unlike the public endpoints this sees dead rows too (``is_active=None``),
    joins the company name, and matches ``q`` as a keyword against
    title / company / location / description. When ``embedding`` is given the
    result is ordered by cosine distance instead (rows without a vector are
    excluded, as in ``search_semantic``). Returns ``(rows, total)`` where total
    counts all matches before LIMIT/OFFSET."""
    pool = await get_pool()
    cols = ", ".join(f"j.{c.strip()}" for c in _COLS.split(","))
    conds: list[str] = []
    args: list = []
    if is_active is not None:
        args.append(is_active)
        conds.append(f"j.is_active = ${len(args)}")
    if q and q.strip():
        args.append(f"%{q.strip()}%")
        n = len(args)
        conds.append(
            f"(j.title ILIKE ${n} OR c.name ILIKE ${n} "
            f"OR j.location ILIKE ${n} OR j.description ILIKE ${n})"
        )
    for col, val in (("role_family", role_family), ("industry", industry), ("seniority", seniority)):
        if val:
            args.append(val)
            conds.append(f"j.{col} = ${len(args)}")

    # Operator-selectable sort (keyword mode only — semantic forces distance
    # below). Whitelisted → the value never reaches SQL as raw text.
    _SORT_MAP = {
        "hotness": "j.hotness DESC, j.created_at DESC",
        "created_at": "j.created_at DESC",
        "title": "j.title ASC",
        "company_name": "c.name ASC NULLS LAST, j.created_at DESC",
        "location": "j.location ASC NULLS LAST, j.created_at DESC",
    }
    order = _SORT_MAP.get(sort, _SORT_MAP["hotness"])
    dist_col = ""
    if embedding is not None:
        args.append(list(embedding))
        n = len(args)
        conds.append("j.embedding IS NOT NULL")
        dist_col = f", (j.embedding <=> ${n}) AS distance"
        order = f"j.embedding <=> ${n}"

    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    args.extend([limit, offset])
    sql = (
        f"SELECT {cols}, c.name AS company_name, c.career_url, "
        # Latest promoted landing page for this job (if any) → the panel shows
        # "đã có trang truyền thông" + its status/link, not just session-created ones.
        f"pr.slug AS promoted_slug, pr.status AS promoted_status, pr.id AS promoted_id, "
        f"COUNT(*) OVER() AS total{dist_col} "
        f"FROM jobs j LEFT JOIN companies c ON c.id = j.company_id "
        f"LEFT JOIN LATERAL (SELECT p.id, p.slug, p.status FROM promoted_jobs p "
        f"WHERE p.job_id = j.id ORDER BY p.created_at DESC LIMIT 1) pr ON true "
        f"{where} ORDER BY {order} LIMIT ${len(args)-1} OFFSET ${len(args)}"
    )
    rows = rows_to_dicts(await pool.fetch(sql, *args))
    total = int(rows[0].pop("total")) if rows else 0
    for r in rows:
        r.pop("total", None)
    return rows, total


async def list_unembedded(*, limit: int = 1000) -> list[dict]:
    """Active jobs still missing their vector (embedding backfill queue)."""
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT id, title, description, must_have FROM jobs "
        "WHERE is_active AND embedding IS NULL ORDER BY created_at DESC LIMIT $1",
        limit,
    )
    return rows_to_dicts(rows)


async def set_embedding(job_id: str, embedding: Sequence[float]) -> None:
    pool = await get_pool()
    await pool.execute(
        "UPDATE jobs SET embedding = $2::vector, indexed_at = now() WHERE id = $1",
        job_id, list(embedding),
    )


async def facet_values() -> dict:
    """Distinct facet values actually present in the store — feeds the admin
    search filters so dropdowns never offer an empty facet."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT 'role_family' AS facet, role_family AS value, count(*) AS n
          FROM jobs WHERE role_family IS NOT NULL GROUP BY role_family
        UNION ALL
        SELECT 'industry', industry, count(*) FROM jobs
          WHERE industry IS NOT NULL GROUP BY industry
        UNION ALL
        SELECT 'seniority', seniority, count(*) FROM jobs
          WHERE seniority IS NOT NULL GROUP BY seniority
        ORDER BY facet, n DESC
        """
    )
    out: dict[str, list[dict]] = {"role_family": [], "industry": [], "seniority": []}
    for r in rows:
        out[r["facet"]].append({"value": r["value"], "count": r["n"]})
    return out


async def list_for_facet(*, limit: int = 500) -> list[dict]:
    """Active jobs reshaped for the in-memory facet engine (app.search.facet).

    Joins the company so each dict carries the keys ``score_job`` expects:
    ``title, location, company, career_url, description, industry, url`` plus
    ``role_family`` / ``seniority`` for display, and ``company_domain`` /
    ``has_logo`` so surfaces can render the company's uploaded logo. No
    embedding, no logo bytes."""
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT j.title, j.location, j.source_url AS url, j.description,
               j.role_family, j.industry, j.seniority, j.required_years_min,
               j.must_have, c.name AS company, c.career_url,
               c.domain AS company_domain, (c.logo_b64 IS NOT NULL) AS has_logo
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
    the next successful ingest (``upsert`` sets is_active=true).

    Anti-flap guard: even a NON-empty but suspiciously-small feed (e.g. the
    adapter fell to a render/capture fallback that only sees page 1) must not
    prune. When the live set collapses to <40% of what the company currently has
    active, treat the run as flaky and skip the prune — the good jobs stay live
    and a later healthy run reconciles. Genuine one-off closures are still caught
    per-job by the link-health scan / apply-gate, so nothing leaks permanently."""
    if not company_id or not live_external_ids:
        return 0
    pool = await get_pool()
    live = set(live_external_ids)
    active_now = await pool.fetchval(
        "SELECT count(*) FROM jobs WHERE company_id = $1 AND is_active", company_id) or 0
    if active_now >= _PRUNE_MIN_BASELINE and len(live) < active_now * (1 - _PRUNE_DROP_RATIO):
        logger.warning(
            "[jobs] deactivate_missing skipped for company %s: feed returned %d vs %d active "
            "(suspected flaky run — not pruning)", company_id, len(live), active_now)
        return 0
    rows = await pool.fetch(
        "UPDATE jobs SET is_active = false, dead_reason = 'left_feed', "
        "last_verified_at = now() "
        "WHERE company_id = $1 AND is_active "
        "AND NOT (external_id = ANY($2::text[])) "
        "RETURNING id",
        company_id, list(live_external_ids),
    )
    return len(rows)


async def purge_dead(grace_hours: int = 20) -> int:
    """Hard-DELETE jobs that have stayed dead past the grace window.

    A job is purged only when it's both inactive AND hasn't been seen alive in
    any feed for ``grace_hours``. ``last_seen_at`` is bumped by ``upsert`` every
    time a live posting is re-ingested, so a job still present in ANY feed can
    never be older than one cron cycle — only genuinely-gone postings age out.
    The grace window (~3 cycles at the 8h cadence) is the safety net the soft-
    deactivate model gave us for free: a single transient bad fetch that drops a
    job for one cycle won't delete it — the next good ingest re-upserts it
    (``is_active=true``, ``last_seen_at=now()``) and it's protected again.

    ``promoted_jobs.job_id`` is a soft ref (no FK) and ``saved_jobs`` snapshots
    its own copy, so this never orphans a live landing page or a user's saved
    job. ``promoted.delete_dead`` runs earlier each cycle and clears a landing
    page the moment its job first goes inactive — long before this purge fires.
    Returns rows deleted."""
    pool = await get_pool()
    rows = await pool.fetch(
        "DELETE FROM jobs WHERE NOT is_active "
        "AND last_seen_at IS NOT NULL "
        "AND last_seen_at < now() - make_interval(hours => $1) "
        "RETURNING id",
        grace_hours,
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
