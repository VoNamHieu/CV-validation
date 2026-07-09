"""Admin API (``/admin``) — operator tooling, gated by an email allowlist.

Access is restricted to the addresses in the ``ADMIN_EMAILS`` env var
(comma-separated). The caller's email is read from their ``profiles`` row
(resolved from the verified JWT ``sub``), so admin status can't be spoofed by a
header. When ``ADMIN_EMAILS`` is empty, the whole surface is closed (403).
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import admin_members as admin_members_repo
from app.db import analytics as analytics_repo
from app.db import credits as credits_repo
from app.db import events as events_repo
from app.db import feedback as feedback_repo
from app.db import incidents as incidents_repo
from app.db import jobs as jobs_repo
from app.db import profiles as profiles_repo
from app.services.auth import (
    get_admin_identity,
    require_admin,
    require_super_admin,
    super_admin_emails,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])

# Hard cap per grant so a typo can't mint a fortune.
MAX_GRANT = 100_000


@router.get("/check")
async def check(admin: dict = Depends(get_admin_identity)):
    """Cheap probe the frontend uses to gate the admin page (200 = admin).
    Returns the caller's role so the UI can hide member-only-forbidden actions
    (``super`` = env ADMIN_EMAILS, ``member`` = UI-granted)."""
    return {"ok": True, "role": admin["role"], "email": admin["email"]}


# ── Admin members (UI-granted admins) ─────────────────────────────────────────
# SUPER admins come from the ADMIN_EMAILS env and are shown read-only. MEMBER
# admins are rows only a SUPER admin can add or remove; members get full admin
# rights but can't touch the roster — so a grant can't escalate or lock out the
# env-configured operators. Any admin may VIEW the roster.


@router.get("/members")
async def list_members(_admin: str = Depends(require_admin)):
    """The full admin roster: env SUPER admins (read-only) + UI-granted members."""
    return {
        "super_admins": sorted(super_admin_emails()),
        "members": await admin_members_repo.list_all(),
    }


class MemberBody(BaseModel):
    email: str = Field(..., min_length=3, max_length=200)


@router.post("/members")
async def add_member(body: MemberBody, admin: dict = Depends(get_admin_identity)):
    """Grant member admin to an email (full rights except removing members).
    SUPER-admin only — members can view the roster but not change it, so admin
    grants can't escalate past the env-configured operators. Idempotent."""
    if admin["role"] != "super":
        raise HTTPException(
            status_code=403,
            detail="Chỉ super admin (cấu hình ở backend) mới được cấp quyền",
        )
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Email không hợp lệ")
    if email in super_admin_emails():
        raise HTTPException(
            status_code=400,
            detail="Email này đã là super admin (cấu hình ở backend)",
        )
    row = await admin_members_repo.add(email, added_by=admin["email"])
    return row


@router.delete("/members/{email}")
async def remove_member(email: str, _admin: str = Depends(require_super_admin)):
    """Revoke member admin. SUPER-admin only — members can't remove anyone."""
    removed = await admin_members_repo.remove(email.strip().lower())
    if not removed:
        raise HTTPException(status_code=404, detail="Không tìm thấy thành viên này")
    return {"ok": True, "email": email.strip().lower()}


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


@router.get("/jobs/search")
async def search_jobs(
    q: Optional[str] = Query(None, max_length=200, description="Keyword over title/company/location/description"),
    mode: str = Query("keyword", pattern="^(keyword|semantic)$"),
    role_family: Optional[str] = Query(None, max_length=64),
    industry: Optional[str] = Query(None, max_length=64),
    seniority: Optional[str] = Query(None, max_length=32),
    status: str = Query("all", pattern="^(all|active|dead)$"),
    sort: str = Query("hotness", pattern="^(hotness|created_at|title|company_name|location)$"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _admin: str = Depends(require_admin),
):
    """Operator search over the whole job store (dead rows included).

    ``mode=semantic`` embeds ``q`` server-side and orders by cosine distance
    (rows without a vector are excluded); default keyword mode is a plain
    ILIKE match ordered by hotness."""
    embedding = None
    if mode == "semantic":
        if not (q and q.strip()):
            raise HTTPException(status_code=400, detail="Semantic mode cần từ khoá tìm kiếm")
        from app.search.embed import embed_query
        embedding = await asyncio.to_thread(embed_query, q.strip())

    is_active = {"all": None, "active": True, "dead": False}[status]
    rows, total = await jobs_repo.search_admin(
        q=None if mode == "semantic" else q,
        role_family=role_family,
        industry=industry,
        seniority=seniority,
        is_active=is_active,
        embedding=embedding,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return {"total": total, "results": rows}


@router.get("/jobs/facets")
async def job_facets(_admin: str = Depends(require_admin)):
    """Distinct role_family / industry / seniority values (with counts) present
    in the store — populates the admin search filter dropdowns."""
    return await jobs_repo.facet_values()


# ── Crawl trigger — ATS ingest + embedding backfill, as ONE shared background
# task (same pattern as the featured-crawl refresh in career.py). The ingest
# sweeps every featured company's ATS feed and can run for minutes, far past
# the 60s frontend proxy timeout, so the POST only kicks it off and the panel
# polls /jobs/ingest/status.
_ingest_task: Optional[asyncio.Task] = None
_ingest_last: dict = {}


async def _run_ingest(render: bool) -> None:
    global _ingest_last
    t0 = time.time()
    _ingest_last = {"at": t0, "phase": "crawling", "stats": None, "error": None}
    try:
        from app.services.embed_backfill import embed_backfill
        from app.services.job_ingest import ingest_featured_ats

        stats = await ingest_featured_ats(render=render)
        _ingest_last["phase"] = "embedding"
        stats["jobs_embedded"] = await embed_backfill()
        _ingest_last.update(phase="done", stats=stats)
    except Exception as e:  # noqa: BLE001
        logger.exception("admin ingest failed")
        _ingest_last.update(phase="error", error=str(e)[:300])
    finally:
        _ingest_last["duration_s"] = round(time.time() - t0, 1)


@router.post("/jobs/ingest")
async def trigger_ingest(
    render: bool = Query(False, description="Also render bespoke pages (slower, catches embedded ATS)"),
    _admin: str = Depends(require_admin),
):
    """Kick the store crawl: pull every featured company's ATS feed into
    ``public.jobs`` (upsert + liveness diff), then backfill embeddings for any
    job missing a vector. No-op (returns running state) if one is in flight."""
    global _ingest_task
    if _ingest_task and not _ingest_task.done():
        return {"started": False, "running": True, "last": _ingest_last or None}
    _ingest_task = asyncio.create_task(_run_ingest(render))
    return {"started": True, "running": True, "last": _ingest_last or None}


@router.get("/jobs/ingest/status")
async def ingest_status(_admin: str = Depends(require_admin)):
    """Poll target for the admin panel while a crawl runs."""
    running = bool(_ingest_task and not _ingest_task.done())
    return {"running": running, "last": _ingest_last or None}


@router.get("/analytics/funnel")
async def analytics_funnel(
    days: int = Query(30, ge=0, le=3650, description="Time window in days; 0 = all time"),
    _admin: str = Depends(require_admin),
):
    """Distinct sessions per funnel event → {event: count} for FunnelPanel,
    restricted to the last `days` days (0 = all time)."""
    return await events_repo.funnel_counts(days=days)


@router.get("/analytics/summary")
async def analytics_summary(
    days: int = Query(30, ge=0, le=3650, description="Time window in days; 0 = all time"),
    _admin: str = Depends(require_admin),
):
    """KPI counters + distributions for the comprehensive analytics dashboard."""
    return await analytics_repo.summary(days=days)


@router.get("/analytics/timeseries")
async def analytics_timeseries(
    days: int = Query(30, ge=1, le=365, description="Time window in days (1–365)"),
    _admin: str = Depends(require_admin),
):
    """Daily trend series (signups / sessions / applications / credit spend)."""
    return await analytics_repo.timeseries(days=days)


@router.get("/analytics/top-optimizers")
async def analytics_top_optimizers(
    days: int = Query(0, ge=0, le=3650, description="Time window in days; 0 = all time"),
    limit: int = Query(20, ge=1, le=100, description="Number of top users to return"),
    _admin: str = Depends(require_admin),
):
    """Leaderboard of users who optimized their CV for the most jobs."""
    return await analytics_repo.top_optimizers(days=days, limit=limit)


# ── Incident log (system / API / DB / extension errors) ──


@router.get("/incidents")
async def list_incidents(
    incident_type: Optional[str] = Query(None, max_length=40),
    source: Optional[str] = Query(None, max_length=20),
    resolved: Optional[bool] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _admin: str = Depends(require_admin),
):
    """Recent incidents (newest first) + total, filterable by type/source/resolved."""
    rows, total = await incidents_repo.list_recent(
        incident_type=incident_type, source=source, resolved=resolved,
        limit=limit, offset=offset,
    )
    return {"total": total, "results": rows}


@router.get("/incidents/summary")
async def incidents_summary(
    days: int = Query(7, ge=0, le=3650, description="Time window in days; 0 = all time"),
    _admin: str = Depends(require_admin),
):
    """Incident counts by type / source / top module for the dashboard."""
    return await incidents_repo.summary(days=days)


class ResolveIncidentBody(BaseModel):
    resolution_note: Optional[str] = Field(default=None, max_length=500)


@router.post("/incidents/{incident_id}/resolve")
async def resolve_incident(
    incident_id: str,
    body: ResolveIncidentBody,
    identity: dict = Depends(get_admin_identity),
):
    """Mark an incident resolved, stamping the acting admin's email."""
    ok = await incidents_repo.resolve(
        incident_id, resolved_by=identity["email"], note=body.resolution_note,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Không tìm thấy incident")
    return {"ok": True}
