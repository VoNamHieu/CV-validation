"""Repository for ``public.admin_members`` — UI-granted admins.

Rows here are "member" admins: full admin rights except removing members
(enforced in the router via ``require_super_admin``). SUPER admins live in the
``ADMIN_EMAILS`` env var, never in this table. All emails are lowercased so the
lookup matches ``require_admin``'s case-insensitive email resolution.
"""
from __future__ import annotations

from typing import Optional

from app.db.pool import get_pool, row_to_dict, rows_to_dicts

_COLS = "email, added_by, created_at"


async def list_all() -> list[dict]:
    """All member admins, newest first."""
    pool = await get_pool()
    return rows_to_dicts(
        await pool.fetch(f"SELECT {_COLS} FROM admin_members ORDER BY created_at DESC")
    )


async def is_member(email: str) -> bool:
    """True if ``email`` (any case) is a UI-granted member admin."""
    pool = await get_pool()
    return bool(
        await pool.fetchval(
            "SELECT 1 FROM admin_members WHERE email = lower($1)", email
        )
    )


async def add(email: str, *, added_by: Optional[str]) -> dict:
    """Grant member admin to ``email``. Idempotent — re-adding keeps the
    original ``added_by``/``created_at`` and just returns the existing row."""
    pool = await get_pool()
    sql = f"""
        INSERT INTO admin_members (email, added_by) VALUES (lower($1), $2)
        ON CONFLICT (email) DO NOTHING
        RETURNING {_COLS}
    """
    row = row_to_dict(await pool.fetchrow(sql, email, added_by))
    if row is None:  # already existed (DO NOTHING) — fetch it
        row = row_to_dict(
            await pool.fetchrow(
                f"SELECT {_COLS} FROM admin_members WHERE email = lower($1)", email
            )
        )
    return row


async def remove(email: str) -> bool:
    """Revoke member admin. Returns True if a row was removed."""
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM admin_members WHERE email = lower($1)", email
    )
    # asyncpg returns e.g. "DELETE 1"
    return result.rsplit(" ", 1)[-1] != "0"
