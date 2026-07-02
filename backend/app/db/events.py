"""Repository for ``public.events`` — self-hosted funnel analytics."""
from __future__ import annotations

from typing import Optional

from app.db.pool import get_pool


async def record(
    *, user_id: Optional[str], session_id: str, event: str,
    page_url: Optional[str] = None, meta: Optional[dict] = None,
) -> None:
    """Append one funnel event. Fire-and-forget from the client's view."""
    pool = await get_pool()
    # Pass the dict as-is: the pool's jsonb codec encodes it. Pre-dumping here
    # double-encodes and stores a string scalar (see migration 007).
    await pool.execute(
        "INSERT INTO events (user_id, session_id, event, page_url, meta) "
        "VALUES ($1, $2, $3, $4, $5::jsonb)",
        user_id, session_id, event[:80], page_url, meta or None,
    )


async def funnel_counts(days: int = 30) -> dict[str, int]:
    """Distinct sessions that reached each event → {event: count}, within the
    last ``days`` days (``days <= 0`` = all time)."""
    pool = await get_pool()
    if days and days > 0:
        rows = await pool.fetch(
            "SELECT event, count(DISTINCT session_id) AS n FROM events "
            "WHERE created_at > now() - make_interval(days => $1) GROUP BY event",
            days,
        )
    else:
        rows = await pool.fetch(
            "SELECT event, count(DISTINCT session_id) AS n FROM events GROUP BY event"
        )
    return {r["event"]: r["n"] for r in rows}
