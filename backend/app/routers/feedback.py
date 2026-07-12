"""Product feedback ingestion (``POST /feedback``).

Single endpoint for both the floating feedback widget and the top-up "support
us" screen. The caller must be signed in (the user is resolved from the JWT);
email is filled from their profile. Admins read submissions via /admin/feedback.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
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


class ContactBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    email: str = Field(..., min_length=3, max_length=200)
    message: str = Field(..., min_length=2, max_length=4000)
    page_url: Optional[str] = Field(default=None, max_length=400)


@router.post("/feedback/contact")
async def submit_contact(body: ContactBody):
    """PUBLIC — landing-page contact form (anonymous, no auth). Lands in the
    same ``feedback`` table (source='contact', user_id=NULL) so it surfaces in
    the admin feedback panel; the sender's name is folded into the message body
    (the table has no name column) and their email fills the email column so an
    admin can reply. Flood-protected by the global RateLimitMiddleware."""
    email = body.email.strip()
    if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=422, detail="Email không hợp lệ.")
    name = body.name.strip()
    msg = body.message.strip()
    stored = f"{msg}\n\n— {name}" if name else msg
    await feedback_repo.create(
        user_id=None, email=email, message=stored,
        rating=None, source="contact", page_url=body.page_url,
    )
    return {"ok": True}
