"""Report backend incidents from anywhere — fire-and-forget.

Thin wrapper over ``app/db/incidents.py`` that formats an exception into a row
and, crucially, swallows its OWN failures: recording an incident must never
raise into the code path that hit the original error. Used by the global
exception handler in ``main.py`` (unhandled system / DB errors) and available
for explicit reporting from services/routers.
"""
from __future__ import annotations

import logging
import traceback
from typing import Optional

from app.db import incidents as incidents_repo

logger = logging.getLogger(__name__)


async def report(
    incident_type: str,
    *,
    module: str,
    error: Optional[BaseException] = None,
    message: Optional[str] = None,
    severity: str = "error",
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
    code: Optional[str] = None,
    context: Optional[dict] = None,
) -> None:
    """Capture a backend incident. Never raises."""
    try:
        msg = message or (str(error) if error else None)
        stack = None
        if error is not None:
            stack = "".join(
                traceback.format_exception(type(error), error, error.__traceback__)
            )
            # asyncpg errors carry a sqlstate; surface it as the code.
            code = code or getattr(error, "sqlstate", None) or type(error).__name__
        await incidents_repo.record(
            incident_type=incident_type,
            source="backend",
            module=module,
            severity=severity,
            message=msg,
            code=code,
            stack=stack,
            context=context,
            user_id=user_id,
            session_id=session_id,
        )
    except Exception as e:  # noqa: BLE001 — logging must never break the flow
        logger.warning("[incidents] failed to record %s: %s", incident_type, str(e)[:160])
