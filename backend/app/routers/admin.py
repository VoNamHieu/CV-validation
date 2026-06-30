"""Admin API (``/admin``) — operator tooling, gated by an email allowlist.

Access is restricted to the addresses in the ``ADMIN_EMAILS`` env var
(comma-separated). The caller's email is read from their ``profiles`` row
(resolved from the verified JWT ``sub``), so admin status can't be spoofed by a
header. When ``ADMIN_EMAILS`` is empty, the whole surface is closed (403).
"""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import credits as credits_repo
from app.db import events as events_repo
from app.db import feedback as feedback_repo
from app.db import profiles as profiles_repo
from app.services.auth import get_current_user_id

router = APIRouter(prefix="/admin", tags=["Admin"])

# Hard cap per grant so a typo can't mint a fortune.
MAX_GRANT = 100_000


def _admin_emails() -> set[str]:
    return {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}


async def require_admin(user_id: str = Depends(get_current_user_id)) -> str:
    """Dependency → the caller's user id, only if they're an allowlisted admin."""
    allow = _admin_emails()
    if not allow:
        raise HTTPException(status_code=403, detail="Admin surface is disabled")
    profile = await profiles_repo.get(user_id)
    email = ((profile or {}).get("email") or "").lower()
    if email not in allow:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user_id


@router.get("/check")
async def check(_admin: str = Depends(require_admin)):
    """Cheap probe the frontend uses to gate the admin page (200 = admin)."""
    return {"ok": True}


@router.get("/users/lookup")
async def lookup_user(
    email: str = Query(..., min_length=3),
    _admin: str = Depends(require_admin),
):
    """Resolve a user by email and return their current credit balance."""
    uid = await profiles_repo.find_id_by_email(email)
    if not uid:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy người dùng với email '{email}'")
    return {"user_id": uid, "email": email, "balance": await credits_repo.get_balance(uid)}


class GrantBody(BaseModel):
    email: str = Field(..., min_length=3)
    amount: int = Field(..., description="Credits to add (positive)")
    reason: str = "admin_grant"


@router.post("/credits/grant")
async def grant_credits(body: GrantBody, _admin: str = Depends(require_admin)):
    """Add credits to a target user (looked up by email)."""
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Số credit phải lớn hơn 0")
    if body.amount > MAX_GRANT:
        raise HTTPException(status_code=400, detail=f"Tối đa {MAX_GRANT:,} credit mỗi lần")

    uid = await profiles_repo.find_id_by_email(body.email)
    if not uid:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy người dùng với email '{body.email}'")

    reason = (body.reason or "admin_grant").strip()[:64] or "admin_grant"
    balance = await credits_repo.grant(uid, body.amount, reason=reason)
    return {
        "user_id": uid,
        "email": body.email,
        "granted": body.amount,
        "balance": balance,
        "reason": reason,
    }


@router.get("/feedback")
async def list_feedback(_admin: str = Depends(require_admin)):
    """Recent user feedback / support messages (newest first)."""
    return await feedback_repo.list_recent(limit=200)


@router.get("/analytics/funnel")
async def analytics_funnel(_admin: str = Depends(require_admin)):
    """Distinct sessions per funnel event → {event: count} for FunnelPanel."""
    return await events_repo.funnel_counts()
