"""Credits API (``/credits``) — balance + atomic spend.

The cost map is **server-side authoritative** — the client names an action and
(for per-variant work) a unit count, never a price. Spending requires a valid
user (JWT or dev header); insufficient balance returns HTTP 402.
"""
from __future__ import annotations

import hmac
import os

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from app.db import credits as credits_repo
from app.services.auth import get_current_user_id

router = APIRouter(prefix="/credits", tags=["Credits"])

# Authoritative per-action cost (credits). Grounded in measured Gemini cost:
# light/extraction ≈ 1, score ≈ 4, optimize ≈ 5 per generated variant.
COSTS: dict[str, int] = {
    "parse_pdf": 1,
    "extract_cv": 1,
    "extract_jd": 1,
    "search_profile": 1,
    "smart_search": 1,
    "rank_jobs": 1,
    "extract_job_links": 1,
    "map_form": 1,
    "agent_plan": 1,
    "score": 4,
    "optimize": 5,   # × units (number of variants)
    "tailor": 5,     # × units
    "gap_report": 5,  # one deep reasoning report (Pro tier)
    "cover_letter": 3,  # per-job tailored cover letter (judge tier)
    "practice": 2,  # interview practice-answer eval (judge tier); dossier gen is free

    # Flat per-job fee for extension auto-apply — covers ALL the agent-plan +
    # map-form LLM calls that job makes (charged once when the job starts, not
    # per step), so cost stays predictable for the user.
    "auto_apply": 3,
}


class SpendBody(BaseModel):
    action: str
    units: int = 1   # multiplier for per-variant actions (optimize/tailor)
    # Optional idempotency key (a UUID minted by the SERVER-SIDE caller, one
    # per user action). Replaying the same key never double-debits and is what
    # a refund correlates to. Never echoed to the browser.
    request_id: str | None = None


class RefundBody(BaseModel):
    request_id: str


# Shared secret proving a refund request came from OUR server (the Next.js API
# layer), not a browser. The backend is publicly reachable, and refund with
# only user-JWT auth would let anyone reclaim a spend AFTER receiving the AI
# result. Unset → refunds are disabled (fail closed), spends are unaffected.
_INTERNAL_KEY = os.getenv("CREDITS_INTERNAL_KEY", "")


@router.get("/balance")
async def balance(user_id: str = Depends(get_current_user_id)):
    return {"balance": await credits_repo.get_balance(user_id), "signup_grant": credits_repo.SIGNUP_GRANT}


@router.get("/costs")
async def costs():
    return COSTS


@router.post("/request-topup")
async def request_topup(user_id: str = Depends(get_current_user_id)):
    """First request grants a one-time free top-up; subsequent requests return
    requires_payment=True so the client shows bank-transfer details."""
    return await credits_repo.request_topup(user_id)


@router.post("/spend")
async def spend(body: SpendBody, user_id: str = Depends(get_current_user_id)):
    base = COSTS.get(body.action)
    if base is None:
        raise HTTPException(status_code=400, detail=f"Unknown action '{body.action}'")
    cost = base * max(1, body.units)
    ok, bal = await credits_repo.spend(user_id, body.action, cost,
                                       request_id=body.request_id or None)
    if not ok:
        raise HTTPException(
            status_code=402,
            detail={"error": "insufficient_credits", "needed": cost, "balance": bal},
        )
    return {"balance": bal, "spent": cost, "action": body.action}


@router.post("/refund")
async def refund(
    body: RefundBody,
    user_id: str = Depends(get_current_user_id),
    x_internal_key: str | None = Header(default=None),
):
    """Reverse a spend whose AI work failed. Requires BOTH the user's auth
    (whose ledger) and the server-only internal key (who may ask) — compared
    constant-time so the key can't be probed byte-by-byte."""
    if not _INTERNAL_KEY or not hmac.compare_digest(x_internal_key or "", _INTERNAL_KEY):
        raise HTTPException(status_code=403, detail="Refunds are server-initiated only")
    return await credits_repo.refund(user_id, body.request_id)
