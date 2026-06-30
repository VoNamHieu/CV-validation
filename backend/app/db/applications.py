"""Repository for ``public.applications`` — the tailor→apply→outcome funnel.

User-scoped. ``status`` is constrained by a CHECK to the funnel stages; the
``trg_applications_touch`` trigger maintains ``updated_at`` so we never set it
ourselves.
"""
from __future__ import annotations

from typing import Optional

from app.db.pool import get_pool, row_to_dict, rows_to_dicts

STATUSES = (
    "tailored", "filled", "submitted", "callback", "interview", "offer", "rejected",
)

_COLS = (
    "id, user_id, cv_profile_id, job_id, saved_job_id, company_name, job_title, "
    "role_family, seniority, jd_facts, source_url, tailored_cv, fit_score, "
    "fit_breakdown, status, notes, outcome_at, anonymized_at, created_at, updated_at"
)


async def create(
    *,
    user_id: str,
    cv_profile_id: Optional[str] = None,
    job_id: Optional[str] = None,
    saved_job_id: Optional[str] = None,
    company_name: Optional[str] = None,
    job_title: Optional[str] = None,
    role_family: Optional[str] = None,
    seniority: Optional[str] = None,
    jd_facts: Optional[dict] = None,
    source_url: Optional[str] = None,
    tailored_cv: Optional[dict] = None,
    fit_score: Optional[int] = None,
    fit_breakdown: Optional[dict] = None,
    status: str = "tailored",
    notes: Optional[str] = None,
) -> dict:
    if status not in STATUSES:
        raise ValueError(f"invalid status {status!r}; expected one of {STATUSES}")
    pool = await get_pool()
    sql = f"""
        INSERT INTO applications
            (user_id, cv_profile_id, job_id, saved_job_id, company_name, job_title,
             role_family, seniority, jd_facts, source_url, tailored_cv, fit_score,
             fit_breakdown, status, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING {_COLS}
    """
    return row_to_dict(
        await pool.fetchrow(
            sql, user_id, cv_profile_id, job_id, saved_job_id, company_name, job_title,
            role_family, seniority, jd_facts, source_url, tailored_cv, fit_score,
            fit_breakdown, status, notes,
        )
    )


async def list_for_user(
    user_id: str, *, status: Optional[str] = None
) -> list[dict]:
    pool = await get_pool()
    if status:
        rows = await pool.fetch(
            f"SELECT {_COLS} FROM applications WHERE user_id = $1 AND status = $2 "
            f"ORDER BY updated_at DESC",
            user_id, status,
        )
    else:
        rows = await pool.fetch(
            f"SELECT {_COLS} FROM applications WHERE user_id = $1 ORDER BY updated_at DESC",
            user_id,
        )
    return rows_to_dicts(rows)


async def get(app_id: str, user_id: str) -> Optional[dict]:
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            f"SELECT {_COLS} FROM applications WHERE id = $1 AND user_id = $2",
            app_id, user_id,
        )
    )


async def update_status(app_id: str, user_id: str, status: str) -> Optional[dict]:
    """Advance the funnel stage. Stamps ``outcome_at`` on terminal outcomes."""
    if status not in STATUSES:
        raise ValueError(f"invalid status {status!r}; expected one of {STATUSES}")
    terminal = status in ("offer", "rejected")
    pool = await get_pool()
    sql = f"""
        UPDATE applications
        SET status = $3,
            outcome_at = CASE WHEN $4 THEN now() ELSE outcome_at END
        WHERE id = $1 AND user_id = $2
        RETURNING {_COLS}
    """
    return row_to_dict(await pool.fetchrow(sql, app_id, user_id, status, terminal))


async def update_notes(app_id: str, user_id: str, notes: Optional[str]) -> Optional[dict]:
    """Set the free-text note on an application (empty string clears it)."""
    pool = await get_pool()
    sql = f"""
        UPDATE applications SET notes = $3
        WHERE id = $1 AND user_id = $2
        RETURNING {_COLS}
    """
    return row_to_dict(await pool.fetchrow(sql, app_id, user_id, notes))


async def delete(app_id: str, user_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM applications WHERE id = $1 AND user_id = $2", app_id, user_id
    )
    return result.endswith("1")
