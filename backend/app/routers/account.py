"""User-scoped API (``/me``) — CV profiles, saved jobs, applications, profile.

Every endpoint depends on ``get_current_user_id`` and threads that id into the
repository, which filters on it. The backend bypasses RLS, so this dependency
*is* the access control.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.db import applications, cv_profiles, profiles, saved_jobs
from app.services.auth import get_current_user_id

router = APIRouter(prefix="/me", tags=["Account"])


# ── profile ────────────────────────────────────────────────────────────────
@router.get("")
async def get_profile(user_id: str = Depends(get_current_user_id)):
    return await profiles.get(user_id) or {"id": user_id, "email": None}


# ── consent ──────────────────────────────────────────────────────────────────
class AcceptTerms(BaseModel):
    version: str


@router.post("/accept-terms")
async def accept_terms(
    body: AcceptTerms, user_id: str = Depends(get_current_user_id)
):
    """Layer 1 — record the mandatory Terms + Privacy acceptance from signup."""
    return await profiles.accept_terms(user_id=user_id, version=body.version)


@router.post("/agent-consent")
async def agent_consent(user_id: str = Depends(get_current_user_id)):
    """Layer 2 — record the separate just-in-time consent for the auto-apply
    agent (shown the first time the user enables it)."""
    return await profiles.set_agent_consent(user_id=user_id)


@router.delete("/account")
async def delete_account(user_id: str = Depends(get_current_user_id)):
    """Permanently delete the account and all associated data (Privacy §5)."""
    await profiles.delete_account(user_id)
    return {"deleted": True}


# ── cv profiles ────────────────────────────────────────────────────────────
class CvProfileCreate(BaseModel):
    structured: dict
    raw_cv_url: Optional[str] = None
    embedding: Optional[list[float]] = None
    make_active: bool = True


@router.get("/cv-profiles")
async def list_cv_profiles(user_id: str = Depends(get_current_user_id)):
    return await cv_profiles.list_for_user(user_id)


@router.get("/cv-profiles/active")
async def active_cv_profile(user_id: str = Depends(get_current_user_id)):
    row = await cv_profiles.get_active(user_id)
    if not row:
        raise HTTPException(status_code=404, detail="No active CV profile")
    return row


@router.post("/cv-profiles")
async def create_cv_profile(
    body: CvProfileCreate, user_id: str = Depends(get_current_user_id)
):
    return await cv_profiles.create(user_id=user_id, **body.model_dump())


@router.put("/cv-profiles/{profile_id}/activate")
async def activate_cv_profile(
    profile_id: str, user_id: str = Depends(get_current_user_id)
):
    row = await cv_profiles.set_active(profile_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="CV profile not found")
    return row


@router.delete("/cv-profiles/{profile_id}")
async def delete_cv_profile(
    profile_id: str, user_id: str = Depends(get_current_user_id)
):
    if not await cv_profiles.delete(profile_id, user_id):
        raise HTTPException(status_code=404, detail="CV profile not found")
    return {"deleted": True}


# ── saved jobs ─────────────────────────────────────────────────────────────
class SavedJobCreate(BaseModel):
    job_id: Optional[str] = None
    company_name: Optional[str] = None
    company_domain: Optional[str] = None
    ats_type: Optional[str] = None
    job_url: Optional[str] = None
    requirement_facts: Optional[dict] = None
    in_universe: bool = False
    intent: Optional[str] = None


@router.get("/saved-jobs")
async def list_saved_jobs(user_id: str = Depends(get_current_user_id)):
    return await saved_jobs.list_for_user(user_id)


@router.post("/saved-jobs")
async def save_job(body: SavedJobCreate, user_id: str = Depends(get_current_user_id)):
    return await saved_jobs.save(user_id=user_id, **body.model_dump())


@router.delete("/saved-jobs/{saved_id}")
async def delete_saved_job(saved_id: str, user_id: str = Depends(get_current_user_id)):
    if not await saved_jobs.delete(saved_id, user_id):
        raise HTTPException(status_code=404, detail="Saved job not found")
    return {"deleted": True}


# ── applications ───────────────────────────────────────────────────────────
class ApplicationCreate(BaseModel):
    cv_profile_id: Optional[str] = None
    job_id: Optional[str] = None
    saved_job_id: Optional[str] = None
    company_name: Optional[str] = None
    job_title: Optional[str] = None
    role_family: Optional[str] = None
    seniority: Optional[str] = None
    jd_facts: Optional[dict] = None
    source_url: Optional[str] = None
    tailored_cv: Optional[dict] = None
    fit_score: Optional[int] = None
    fit_breakdown: Optional[dict] = None
    status: str = "tailored"
    notes: Optional[str] = None


class StatusUpdate(BaseModel):
    status: str


class NotesUpdate(BaseModel):
    notes: Optional[str] = None


class CvUpdate(BaseModel):
    tailored_cv: Optional[dict] = None


@router.get("/applications")
async def list_applications(
    status: Optional[str] = Query(default=None),
    user_id: str = Depends(get_current_user_id),
):
    return await applications.list_for_user(user_id, status=status)


@router.post("/applications")
async def create_application(
    body: ApplicationCreate, user_id: str = Depends(get_current_user_id)
):
    try:
        return await applications.create(user_id=user_id, **body.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/applications/{app_id}")
async def get_application(app_id: str, user_id: str = Depends(get_current_user_id)):
    row = await applications.get(app_id, user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Application not found")
    return row


@router.patch("/applications/{app_id}/status")
async def update_application_status(
    app_id: str, body: StatusUpdate, user_id: str = Depends(get_current_user_id)
):
    try:
        row = await applications.update_status(app_id, user_id, body.status)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not row:
        raise HTTPException(status_code=404, detail="Application not found")
    return row


@router.patch("/applications/{app_id}/notes")
async def update_application_notes(
    app_id: str, body: NotesUpdate, user_id: str = Depends(get_current_user_id)
):
    row = await applications.update_notes(app_id, user_id, body.notes)
    if not row:
        raise HTTPException(status_code=404, detail="Application not found")
    return row


@router.patch("/applications/{app_id}/cv")
async def update_application_cv(
    app_id: str, body: CvUpdate, user_id: str = Depends(get_current_user_id)
):
    row = await applications.update_cv(app_id, user_id, body.tailored_cv)
    if not row:
        raise HTTPException(status_code=404, detail="Application not found")
    return row


@router.delete("/applications/{app_id}")
async def delete_application(app_id: str, user_id: str = Depends(get_current_user_id)):
    if not await applications.delete(app_id, user_id):
        raise HTTPException(status_code=404, detail="Application not found")
    return {"deleted": True}
