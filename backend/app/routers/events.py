"""Funnel-event ingest (``POST /events``).

Fire-and-forget from the client. Works anonymously (events fire before login,
e.g. landing → "entered"); the user is attached when a JWT is present. Always
returns ok so analytics can never break the app.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.db import events as events_repo
from app.services.auth import get_optional_user_id

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Events"])


class EventBody(BaseModel):
    event: str = Field(..., min_length=1, max_length=80)
    session_id: str = Field(..., min_length=1, max_length=80)
    page_url: Optional[str] = Field(default=None, max_length=400)
    meta: Optional[dict] = None


@router.post("/events")
async def ingest_event(body: EventBody, user_id: Optional[str] = Depends(get_optional_user_id)):
    try:
        await events_repo.record(
            user_id=user_id, session_id=body.session_id, event=body.event,
            page_url=body.page_url, meta=body.meta,
        )
    except Exception as e:  # never surface analytics failures to the client
        logger.info(f"[events] ingest failed: {str(e)[:80]}")
    return {"ok": True}
