"""Read-only aggregation queries for the admin analytics dashboard.

Everything here is admin-gated at the router. Each metric is wrapped so a
missing/empty table degrades to a zero rather than 500-ing the whole dashboard
(the store tables — jobs/companies/applications — live in Supabase and may be
absent in a bare local DB). Windows use ``make_interval(days => $1)``; the
caller passes ``days`` (``<= 0`` → effectively all-time via a large span).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, TypeVar

from app.db import jobs as jobs_repo
from app.db.pool import get_pool

logger = logging.getLogger(__name__)

T = TypeVar("T")

# All-time is expressed as a very large day span so every query can share the
# same ``make_interval`` shape instead of branching SQL.
_ALL_TIME_DAYS = 36_500


async def _try(fn: Callable[[], Awaitable[T]], default: T) -> T:
    """Run one aggregation, swallowing errors (missing table, etc.) to a
    default so one absent source can't blank the dashboard."""
    try:
        return await fn()
    except Exception as e:  # noqa: BLE001
        logger.warning("analytics query failed: %s", str(e)[:160])
        return default


async def summary(days: int = 30) -> dict[str, Any]:
    """KPI counters + distributions for the dashboard, scoped to the last
    ``days`` days where a metric is time-bounded (totals stay all-time)."""
    pool = await get_pool()
    d = days if days and days > 0 else _ALL_TIME_DAYS
    win = "created_at > now() - make_interval(days => $1)"

    users_total = await _try(lambda: pool.fetchval("SELECT count(*) FROM profiles"), 0)
    users_new = await _try(
        lambda: pool.fetchval(f"SELECT count(*) FROM profiles WHERE {win}", d), 0
    )

    ev = await _try(
        lambda: pool.fetchrow(
            "SELECT count(*) AS events, count(DISTINCT session_id) AS sessions "
            f"FROM events WHERE {win}",
            d,
        ),
        None,
    )
    events_total = (ev and ev["events"]) or 0
    sessions = (ev and ev["sessions"]) or 0

    apps_total = await _try(lambda: pool.fetchval("SELECT count(*) FROM applications"), 0)
    apps_new = await _try(
        lambda: pool.fetchval(f"SELECT count(*) FROM applications WHERE {win}", d), 0
    )
    status_rows = await _try(
        lambda: pool.fetch("SELECT status, count(*) AS n FROM applications GROUP BY status"), []
    )
    apps_by_status = {r["status"]: r["n"] for r in status_rows}

    ledger_rows = await _try(
        lambda: pool.fetch(
            "SELECT reason, count(*) AS n, coalesce(sum(delta), 0) AS total "
            f"FROM credit_ledger WHERE {win} GROUP BY reason",
            d,
        ),
        [],
    )
    ledger_by_reason = {
        r["reason"]: {"count": r["n"], "total": int(r["total"])} for r in ledger_rows
    }
    credits_granted = sum(v["total"] for v in ledger_by_reason.values() if v["total"] > 0)
    credits_spent = -sum(v["total"] for v in ledger_by_reason.values() if v["total"] < 0)

    jobs_row = await _try(
        lambda: pool.fetchrow(
            "SELECT count(*) AS total, count(*) FILTER (WHERE is_active) AS active, "
            "count(*) FILTER (WHERE NOT is_active) AS dead FROM jobs"
        ),
        None,
    )
    companies_total = await _try(lambda: pool.fetchval("SELECT count(*) FROM companies"), 0)

    promo = await _try(
        lambda: pool.fetchrow(
            "SELECT count(*) AS total, count(*) FILTER (WHERE status = 'published') AS published, "
            "coalesce(sum(view_count), 0) AS views FROM promoted_jobs"
        ),
        None,
    )

    preps_total = await _try(lambda: pool.fetchval("SELECT count(*) FROM interview_preps"), 0)
    attempts_total = await _try(
        lambda: pool.fetchval("SELECT count(*) FROM practice_attempts"), 0
    )

    fb = await _try(
        lambda: pool.fetchrow("SELECT count(*) AS total, avg(rating)::float AS avg FROM feedback"),
        None,
    )
    rating_rows = await _try(
        lambda: pool.fetch(
            "SELECT rating, count(*) AS n FROM feedback WHERE rating IS NOT NULL GROUP BY rating"
        ),
        [],
    )
    rating_dist = {int(r["rating"]): r["n"] for r in rating_rows}

    top_events = [
        {"event": r["event"], "count": r["n"]}
        for r in await _try(
            lambda: pool.fetch(
                f"SELECT event, count(*) AS n FROM events WHERE {win} "
                "GROUP BY event ORDER BY n DESC LIMIT 12",
                d,
            ),
            [],
        )
    ]

    facets = await _try(jobs_repo.facet_values, {})

    return {
        "window_days": days,
        "users": {"total": users_total, "new": users_new},
        "engagement": {"sessions": sessions, "events": events_total},
        "applications": {"total": apps_total, "new": apps_new, "by_status": apps_by_status},
        "credits": {
            "granted": credits_granted,
            "spent": credits_spent,
            "by_reason": ledger_by_reason,
        },
        "jobs": {
            "total": (jobs_row and jobs_row["total"]) or 0,
            "active": (jobs_row and jobs_row["active"]) or 0,
            "dead": (jobs_row and jobs_row["dead"]) or 0,
            "companies": companies_total,
        },
        "promoted": {
            "total": (promo and promo["total"]) or 0,
            "published": (promo and promo["published"]) or 0,
            "views": int(promo["views"]) if promo and promo["views"] is not None else 0,
        },
        "interview": {"preps": preps_total, "attempts": attempts_total},
        "feedback": {
            "total": (fb and fb["total"]) or 0,
            "avg_rating": (fb and fb["avg"]) or None,
            "rating_dist": rating_dist,
        },
        "top_events": top_events,
        "facets": facets,
    }


async def top_optimizers(days: int = 0, limit: int = 20) -> list[dict[str, Any]]:
    """Leaderboard: users who optimized their CV for the most jobs. Each
    ``applications`` row is one job the user tailored a CV for, so we count
    all of a user's applications (status progresses tailored→submitted→…, so
    filtering by status would undercount). All-time by default; pass
    ``days > 0`` to window on when the application was created."""
    pool = await get_pool()
    d = days if days and days > 0 else _ALL_TIME_DAYS
    lim = max(1, min(limit, 100))
    rows = await _try(
        lambda: pool.fetch(
            "SELECT p.email AS email, count(a.id) AS n "
            "FROM applications a JOIN profiles p ON p.id = a.user_id "
            "WHERE a.created_at > now() - make_interval(days => $1) "
            "GROUP BY p.id, p.email "
            "ORDER BY n DESC, p.email ASC "
            "LIMIT $2",
            d,
            lim,
        ),
        [],
    )
    return [{"email": r["email"], "jobs": int(r["n"])} for r in rows]


async def timeseries(days: int = 30) -> dict[str, Any]:
    """Daily series over the last ``days`` days (clamped 1–365) for the four
    headline trends. Zero-filled against a complete date spine so the frontend
    can plot a continuous line without gaps."""
    pool = await get_pool()
    d = max(1, min(days, 365))
    win = "created_at > now() - make_interval(days => $1)"

    today = datetime.now(timezone.utc).date()
    spine = [today - timedelta(days=i) for i in range(d - 1, -1, -1)]

    async def series(sql: str) -> dict:
        rows = await _try(lambda: pool.fetch(sql, d), [])
        return {r["d"]: r["n"] for r in rows}

    signups = await series(
        f"SELECT created_at::date AS d, count(*) AS n FROM profiles WHERE {win} GROUP BY d"
    )
    sessions = await series(
        "SELECT created_at::date AS d, count(DISTINCT session_id) AS n "
        f"FROM events WHERE {win} GROUP BY d"
    )
    applications = await series(
        f"SELECT created_at::date AS d, count(*) AS n FROM applications WHERE {win} GROUP BY d"
    )
    spend = await series(
        "SELECT created_at::date AS d, -sum(delta) AS n FROM credit_ledger "
        f"WHERE reason = 'spend' AND {win} GROUP BY d"
    )

    def fill(m: dict) -> list[int]:
        return [int(m.get(day, 0) or 0) for day in spine]

    return {
        "dates": [day.isoformat() for day in spine],
        "signups": fill(signups),
        "sessions": fill(sessions),
        "applications": fill(applications),
        "spend": fill(spend),
    }
