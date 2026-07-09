"""Repository for ``public.incidents`` — the system-wide incident log.

Mirrors ``app/db/events.py`` (append-only, service-role writes) for the write
path, and ``app/db/analytics.py``'s ``_try`` wrapper for the read path so one
failing aggregate can't blank the admin panel. Callers on the write side are
expected to swallow errors (see ``app/services/incidents.py`` and the
``POST /incidents`` router) — an incident-log outage must never break a request.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Awaitable, Callable, Optional, TypeVar

from app.db.pool import get_pool

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Field caps — an incident row must never be able to bloat the table.
_MSG_MAX = 500
_STACK_MAX = 4000
_CODE_MAX = 80
_MODULE_MAX = 120

# Whitelists — anything outside these is coerced so the columns stay clean even
# if a client sends garbage.
INCIDENT_TYPES = {"system_error", "extension_error", "api_error", "db_error"}
SOURCES = {"backend", "frontend", "extension"}
SEVERITIES = {"error", "warning"}


def _clip(s: Optional[str], n: int) -> Optional[str]:
    return s[:n] if s else s


async def _try(fn: Callable[[], Awaitable[T]], default: T) -> T:
    try:
        return await fn()
    except Exception as e:  # noqa: BLE001
        logger.warning("incidents query failed: %s", str(e)[:160])
        return default


async def record(
    *,
    incident_type: str,
    source: str,
    module: Optional[str] = None,
    severity: str = "error",
    message: Optional[str] = None,
    code: Optional[str] = None,
    stack: Optional[str] = None,
    context: Optional[dict] = None,
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
) -> None:
    """Append one incident. Does NOT swallow — the caller decides (they always
    do, since logging must never break the flow)."""
    pool = await get_pool()
    itype = incident_type if incident_type in INCIDENT_TYPES else "system_error"
    src = source if source in SOURCES else "backend"
    sev = severity if severity in SEVERITIES else "error"
    await pool.execute(
        "INSERT INTO incidents "
        "(incident_type, source, module, severity, message, code, stack, context, user_id, session_id) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)",
        itype, src, _clip(module, _MODULE_MAX), sev,
        _clip(message, _MSG_MAX), _clip(code, _CODE_MAX), _clip(stack, _STACK_MAX),
        context or None, user_id, session_id,
    )


async def list_recent(
    *,
    incident_type: Optional[str] = None,
    source: Optional[str] = None,
    resolved: Optional[bool] = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Recent incidents (newest first) + total count, filterable. Returns
    ``(rows, total)`` where total counts all matches before LIMIT/OFFSET."""
    pool = await get_pool()
    conds: list[str] = []
    args: list = []
    if incident_type:
        args.append(incident_type)
        conds.append(f"incident_type = ${len(args)}")
    if source:
        args.append(source)
        conds.append(f"source = ${len(args)}")
    if resolved is not None:
        args.append(resolved)
        conds.append(f"resolved = ${len(args)}")
    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    args.extend([limit, offset])

    async def _run() -> tuple[list[dict], int]:
        rows = await pool.fetch(
            "SELECT id, incident_type, source, module, severity, message, code, stack, "
            "context, resolved, resolved_at, resolved_by, user_id, session_id, created_at, "
            f"COUNT(*) OVER() AS total FROM incidents {where} "
            f"ORDER BY created_at DESC LIMIT ${len(args)-1} OFFSET ${len(args)}",
            *args,
        )
        total = int(rows[0]["total"]) if rows else 0
        out = []
        for r in rows:
            d = dict(r)
            d.pop("total", None)
            # asyncpg returns jsonb as a str — decode so the API emits an object.
            if isinstance(d.get("context"), str):
                try:
                    d["context"] = json.loads(d["context"])
                except (ValueError, TypeError):
                    pass
            out.append(d)
        return out, total

    return await _try(_run, ([], 0))


async def summary(days: int = 7) -> dict[str, Any]:
    """Counts by type / source / top module + totals, over the last ``days``
    days (``days <= 0`` = all time). Each aggregate degrades to empty on error."""
    pool = await get_pool()
    win = "created_at > now() - make_interval(days => $1)" if days and days > 0 else "true"
    d = days if days and days > 0 else 0
    arg = [d] if days and days > 0 else []

    async def _counts(col: str) -> dict[str, int]:
        rows = await _try(
            lambda: pool.fetch(
                f"SELECT {col} AS k, count(*) AS n FROM incidents WHERE {win} "
                f"GROUP BY {col} ORDER BY n DESC",
                *arg,
            ),
            [],
        )
        return {(r["k"] or "unknown"): r["n"] for r in rows}

    by_type = await _counts("incident_type")
    by_source = await _counts("source")
    # _counts already orders by count desc and dict preserves that order.
    top_modules = [
        {"module": k, "count": n}
        for k, n in list((await _counts("module")).items())[:10]
    ]
    total = await _try(
        lambda: pool.fetchval(f"SELECT count(*) FROM incidents WHERE {win}", *arg), 0
    )
    unresolved = await _try(
        lambda: pool.fetchval("SELECT count(*) FROM incidents WHERE NOT resolved"), 0
    )
    return {
        "window_days": days,
        "total": total or 0,
        "unresolved": unresolved or 0,
        "by_type": by_type,
        "by_source": by_source,
        "top_modules": top_modules,
    }


async def resolve(incident_id: str, *, resolved_by: str, note: Optional[str] = None) -> bool:
    """Mark one incident resolved (idempotent). Returns True if a row matched."""
    pool = await get_pool()
    # Merge the resolution note into context without clobbering existing keys.
    status = await pool.execute(
        "UPDATE incidents SET resolved = true, resolved_at = now(), resolved_by = $2, "
        "context = coalesce(context, '{}'::jsonb) || jsonb_build_object('resolution_note', $3::text) "
        "WHERE id = $1",
        incident_id, resolved_by, note,
    )
    # asyncpg returns e.g. "UPDATE 1"
    return status.rsplit(" ", 1)[-1] != "0"


async def prune(*, resolved_older_than_days: int = 30, any_older_than_days: int = 180) -> int:
    """Delete resolved incidents older than N days and any incident older than M
    days, so the table can't grow unbounded. Returns rows deleted."""
    pool = await get_pool()
    status = await pool.execute(
        "DELETE FROM incidents WHERE "
        "(resolved AND created_at < now() - make_interval(days => $1)) "
        "OR created_at < now() - make_interval(days => $2)",
        resolved_older_than_days, any_older_than_days,
    )
    try:
        return int(status.rsplit(" ", 1)[-1])
    except (ValueError, IndexError):
        return 0
