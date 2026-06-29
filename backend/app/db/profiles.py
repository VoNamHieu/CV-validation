"""Repository for ``public.profiles`` — a thin mirror of ``auth.users``.

``id`` is a FK to ``auth.users(id)``, so a profile can only exist for a real
Supabase auth user. Created/refreshed on first sign-in (or by a Supabase
trigger); we expose upsert for the backend-managed path.
"""
from __future__ import annotations

from typing import Optional

from app.db.pool import get_pool, row_to_dict

_COLS = "id, email, created_at"


async def upsert(*, user_id: str, email: Optional[str] = None) -> dict:
    pool = await get_pool()
    sql = f"""
        INSERT INTO profiles (id, email) VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET email = COALESCE(EXCLUDED.email, profiles.email)
        RETURNING {_COLS}
    """
    return row_to_dict(await pool.fetchrow(sql, user_id, email))


async def get(user_id: str) -> Optional[dict]:
    pool = await get_pool()
    return row_to_dict(
        await pool.fetchrow(f"SELECT {_COLS} FROM profiles WHERE id = $1", user_id)
    )
