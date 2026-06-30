"""Credits API (``/credits``) — balance + atomic spend.

The cost map is **server-side authoritative** — the client names an action and
(for per-variant work) a unit count, never a price. Spending requires a valid
user (JWT or dev header); insufficient balance returns HTTP 402.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
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
    # Flat per-job fee for extension auto-apply — covers ALL the agent-plan +
    # map-form LLM calls that job makes (charged once when the job starts, not
    # per step), so cost stays predictable for the user.
    "auto_apply": 3,
}


class SpendBody(BaseModel):
    action: str
    units: int = 1   # multiplier for per-variant actions (optimize/tailor)


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
    ok, bal = await credits_repo.spend(user_id, body.action, cost)
    if not ok:
        raise HTTPException(
            status_code=402,
            detail={"error": "insufficient_credits", "needed": cost, "balance": bal},
        )
    return {"balance": bal, "spent": cost, "action": body.action}
