"""Product feedback ingestion (``POST /feedback``).

Single endpoint for both the floating feedback widget and the top-up "support
us" screen. The caller must be signed in (the user is resolved from the JWT);
email is filled from their profile. Admins read submissions via /admin/feedback.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.db import feedback as feedback_repo
from app.db import profiles as profiles_repo
from app.services.auth import get_current_user_id

router = APIRouter(tags=["Feedback"])


class FeedbackBody(BaseModel):
    message: str = Field(..., min_length=2, max_length=4000)
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    source: Optional[str] = Field(default=None, max_length=40)
    page_url: Optional[str] = Field(default=None, max_length=400)


@router.post("/feedback")
async def submit_feedback(body: FeedbackBody, user_id: str = Depends(get_current_user_id)):
    prof = await profiles_repo.get(user_id)
    return await feedback_repo.create(
        user_id=user_id, email=(prof or {}).get("email"),
        message=body.message.strip(), rating=body.rating,
        source=body.source or "general", page_url=body.page_url,
    )
