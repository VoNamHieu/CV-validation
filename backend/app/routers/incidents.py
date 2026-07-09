"""Client incident ingest (``POST /incidents``).

Fire-and-forget from the browser and the extension — the channel for
``api_error`` (frontend API-call failures) and ``extension_error`` (extension
connection failures). Works anonymously (errors can fire before login); the
user is attached when a JWT is present. Always returns ok so the reporter can
never break the app. Public like ``/events`` — abuse is bounded by the global
rate-limit middleware + client-side dedup + the field caps in the repo.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.db import incidents as incidents_repo
from app.services.auth import get_optional_user_id

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Incidents"])


class IncidentBody(BaseModel):
    # 'api_error' | 'extension_error' | 'system_error' — validated against the
    # whitelist in the repo (unknown → coerced), so keep the field permissive.
    incident_type: str = Field(..., min_length=1, max_length=40)
    source: str = Field(default="frontend", max_length=20)
    module: Optional[str] = Field(default=None, max_length=120)
    severity: str = Field(default="error", max_length=20)
    message: Optional[str] = Field(default=None, max_length=1000)
    code: Optional[str] = Field(default=None, max_length=80)
    stack: Optional[str] = Field(default=None, max_length=8000)
    context: Optional[dict] = None
    session_id: Optional[str] = Field(default=None, max_length=80)


@router.post("/incidents")
async def ingest_incident(
    body: IncidentBody, user_id: Optional[str] = Depends(get_optional_user_id)
):
    try:
        await incidents_repo.record(
            incident_type=body.incident_type,
            source=body.source,
            module=body.module,
            severity=body.severity,
            message=body.message,
            code=body.code,
            stack=body.stack,
            context=body.context,
            user_id=user_id,
            session_id=body.session_id,
        )
    except Exception as e:  # never surface incident-log failures to the client
        logger.info(f"[incidents] ingest failed: {str(e)[:80]}")
    return {"ok": True}
