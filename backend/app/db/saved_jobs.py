"""Repository for ``public.saved_jobs`` — a user's bookmarked postings.

User-scoped. A saved job may or may not point at an indexed ``jobs`` row
(``job_id`` nullable) — out-of-universe postings are saved by URL + denormalized
company fields so the bookmark survives even if we never index the company.
"""
from __future__ import annotations

from typing import Optional

from app.db.pool import get_pool, row_to_dict, rows_to_dicts

_COLS = (
    "id, user_id, job_id, company_name, company_domain, ats_type, job_url, "
    "requirement_facts, in_universe, intent, is_live, last_verified_at, created_at"
)


async def save(
    *,
    user_id: str,
    job_id: Optional[str] = None,
    company_name: Optional[str] = None,
    company_domain: Optional[str] = None,
    ats_type: Optional[str] = None,
    job_url: Optional[str] = None,
    requirement_facts: Optional[dict] = None,
    in_universe: bool = False,
    intent: Optional[str] = None,
) -> dict:
    pool = await get_pool()
    sql = f"""
        INSERT INTO saved_jobs
            (user_id, job_id, company_name, company_domain, ats_type, job_url,
             requirement_facts, in_universe, intent)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING {_COLS}
    """
    return row_to_dict(
        await pool.fetchrow(
            sql, user_id, job_id, company_name, company_domain, ats_type, job_url,
            requirement_facts, in_universe, intent,
        )
    )


async def list_for_user(user_id: str) -> list[dict]:
    pool = await get_pool()
    return rows_to_dicts(
        await pool.fetch(
            f"SELECT {_COLS} FROM saved_jobs WHERE user_id = $1 ORDER BY created_at DESC",
            user_id,
        )
    )


async def get(saved_id: str, user_id: str) -> Optional[dict]:
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            f"SELECT {_COLS} FROM saved_jobs WHERE id = $1 AND user_id = $2",
            saved_id, user_id,
        )
    )


async def delete(saved_id: str, user_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM saved_jobs WHERE id = $1 AND user_id = $2", saved_id, user_id
    )
    return result.endswith("1")
