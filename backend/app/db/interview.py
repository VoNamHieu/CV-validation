"""Repository for ``public.interview_preps`` + ``public.practice_attempts``.

User-scoped. A dossier is cached per (user_id, job_ref, cv_hash); practice
attempts hang off a prep. Every query filters by ``user_id`` — the backend
bypasses RLS, so this is the access control.
"""
from __future__ import annotations

from typing import Optional

from app.db.pool import get_pool, row_to_dict, rows_to_dicts

_PREP_COLS = "id, user_id, job_ref, cv_hash, dossier, created_at, updated_at"
_ATTEMPT_COLS = (
    "id, user_id, prep_id, question_id, attempt_no, answer_text, "
    "self_reflection, checklist, created_at"
)


async def get_prep(user_id: str, job_ref: str, cv_hash: str) -> Optional[dict]:
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            f"SELECT {_PREP_COLS} FROM interview_preps "
            f"WHERE user_id = $1 AND job_ref = $2 AND cv_hash = $3",
            user_id, job_ref, cv_hash,
        )
    )


async def upsert_prep(user_id: str, job_ref: str, cv_hash: str, dossier: dict) -> dict:
    """Cache (or refresh) the dossier for the (user, application, cv_hash) triple."""
    pool = await get_pool()
    sql = f"""
        INSERT INTO interview_preps (user_id, job_ref, cv_hash, dossier)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, job_ref, cv_hash)
        DO UPDATE SET dossier = EXCLUDED.dossier, updated_at = now()
        RETURNING {_PREP_COLS}
    """
    return row_to_dict(await pool.fetchrow(sql, user_id, job_ref, cv_hash, dossier))


async def add_attempt(
    *,
    user_id: str,
    prep_id: str,
    question_id: str,
    attempt_no: int,
    answer_text: Optional[str] = None,
    self_reflection: Optional[str] = None,
    checklist: Optional[dict] = None,
) -> Optional[dict]:
    """Record a practice attempt. Returns None if the prep isn't the user's
    (ownership + insert are serialized in one transaction)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            owns = await conn.fetchval(
                "SELECT 1 FROM interview_preps WHERE id = $1 AND user_id = $2",
                prep_id, user_id,
            )
            if not owns:
                return None
            row = await conn.fetchrow(
                f"""INSERT INTO practice_attempts
                    (user_id, prep_id, question_id, attempt_no, answer_text,
                     self_reflection, checklist)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING {_ATTEMPT_COLS}""",
                user_id, prep_id, question_id, attempt_no, answer_text,
                self_reflection, checklist or {},
            )
            return row_to_dict(row)


async def list_attempts(user_id: str, prep_id: str) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"SELECT {_ATTEMPT_COLS} FROM practice_attempts "
        f"WHERE user_id = $1 AND prep_id = $2 ORDER BY attempt_no",
        user_id, prep_id,
    )
    return rows_to_dicts(rows)
