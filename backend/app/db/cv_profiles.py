"""Repository for ``public.cv_profiles`` — a user's parsed CVs.

User-scoped: every function takes ``user_id`` and filters on it (we bypass RLS,
so this is the access control). ``structured`` is the CVSchema JSON; ``embedding``
(vector(768)) is the CV's query-side vector, written but never read back.
"""
from __future__ import annotations

from typing import Optional, Sequence

from app.db.pool import get_pool, row_to_dict, rows_to_dicts, with_deadlock_retry

_COLS = "id, user_id, raw_cv_url, structured, is_active, created_at"


async def create(
    *,
    user_id: str,
    structured: dict,
    raw_cv_url: Optional[str] = None,
    embedding: Optional[Sequence[float]] = None,
    make_active: bool = True,
) -> dict:
    """Insert a CV profile. When ``make_active`` (default), deactivate the
    user's other CVs first so exactly one stays active."""
    async def _op() -> dict:
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                # Serialize concurrent creates for the SAME user. Two racing
                # make_active inserts deadlocked (40P01) on the deactivate-UPDATE
                # + the one-active-per-user index locking each other's rows in
                # opposite order. A txn-scoped advisory lock (auto-released on
                # commit) makes same-user creates run one at a time; different
                # users don't contend.
                await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", user_id)
                if make_active:
                    await conn.execute(
                        "UPDATE cv_profiles SET is_active = false WHERE user_id = $1",
                        user_id,
                    )
                row = await conn.fetchrow(
                    f"""INSERT INTO cv_profiles (user_id, raw_cv_url, structured, embedding, is_active)
                        VALUES ($1, $2, $3, $4, $5) RETURNING {_COLS}""",
                    user_id,
                    raw_cv_url,
                    structured,
                    list(embedding) if embedding is not None else None,
                    make_active,
                )
        return row_to_dict(row)

    # Advisory lock kills the create↔set_active deadlock; the retry is the cheap
    # net for any *other* 40P01 source (e.g. an FK share-lock racing a cron job).
    return await with_deadlock_retry(_op)


async def get_active(user_id: str) -> Optional[dict]:
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            f"SELECT {_COLS} FROM cv_profiles WHERE user_id = $1 AND is_active "
            f"ORDER BY created_at DESC LIMIT 1",
            user_id,
        )
    )


async def get(profile_id: str, user_id: str) -> Optional[dict]:
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(
            f"SELECT {_COLS} FROM cv_profiles WHERE id = $1 AND user_id = $2",
            profile_id, user_id,
        )
    )


async def list_for_user(user_id: str) -> list[dict]:
    pool = await get_pool()
    return rows_to_dicts(
        await pool.fetch(
            f"SELECT {_COLS} FROM cv_profiles WHERE user_id = $1 ORDER BY created_at DESC",
            user_id,
        )
    )


async def set_active(profile_id: str, user_id: str) -> Optional[dict]:
    """Make one CV active and deactivate the rest. Returns it, or None if it
    doesn't belong to the user."""
    async def _op() -> Optional[dict]:
        pool = await get_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                # Same per-user serialization as create() — this UPDATE rewrites
                # all of the user's is_active rows, so a concurrent
                # create/set_active for the same user would deadlock (40P01)
                # without the shared lock.
                await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", user_id)
                owned = await conn.fetchval(
                    "SELECT 1 FROM cv_profiles WHERE id = $1 AND user_id = $2",
                    profile_id, user_id,
                )
                if not owned:
                    return None
                await conn.execute(
                    "UPDATE cv_profiles SET is_active = (id = $1) WHERE user_id = $2",
                    profile_id, user_id,
                )
                row = await conn.fetchrow(
                    f"SELECT {_COLS} FROM cv_profiles WHERE id = $1", profile_id
                )
        return row_to_dict(row)

    return await with_deadlock_retry(_op)


async def delete(profile_id: str, user_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM cv_profiles WHERE id = $1 AND user_id = $2", profile_id, user_id
    )
    return result.endswith("1")
