"""Repository for ``public.feedback`` — user suggestions / support messages."""
from __future__ import annotations

from typing import Optional

from app.db.pool import get_pool, row_to_dict

_COLS = "id, user_id, email, message, rating, source, page_url, created_at"


async def create(
    *, user_id: Optional[str], email: Optional[str], message: str,
    rating: Optional[int] = None, source: Optional[str] = None,
    page_url: Optional[str] = None,
) -> dict:
    pool = await get_pool()
    sql = f"""
        INSERT INTO feedback (user_id, email, message, rating, source, page_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING {_COLS}
    """
    return row_to_dict(await pool.fetchrow(sql, user_id, email, message, rating, source, page_url))


async def list_recent(limit: int = 200) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        f"SELECT {_COLS} FROM feedback ORDER BY created_at DESC LIMIT $1", limit
    )
    return [row_to_dict(r) for r in rows]
