"""Catalog API — the public job/company universe (``/store``).

Reads are open; writes (upserts + the ingest trigger) are operator tooling and
require an allowlisted admin — the service-role DSN bypasses RLS, so an open
upsert would let anyone poison the catalog every user searches over. The
apply-time liveness gate (``/jobs/verify``) fetches a caller-supplied URL, so
it requires a logged-in user and an SSRF-checked URL. Semantic search accepts
either a raw ``query`` (embedded server-side) or a precomputed ``embedding``.
"""
from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import companies, jobs, promoted
from app.services.auth import get_current_user_id, require_admin
from app.services.url_validator import is_allowed_url

router = APIRouter(prefix="/store", tags=["Store"])


# ── companies ──────────────────────────────────────────────────────────────
class CompanyUpsert(BaseModel):
    name: str
    domain: Optional[str] = None
    industry: Optional[str] = None
    career_url: Optional[str] = None
    ats_type: Optional[str] = None
    in_universe: bool = False
    segment: Optional[str] = None
    demand_score: int = 0


@router.get("/companies")
async def list_companies(
    in_universe: Optional[bool] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
):
    return await companies.list_companies(in_universe=in_universe, limit=limit, offset=offset)


@router.post("/companies")
async def upsert_company(body: CompanyUpsert, _admin: str = Depends(require_admin)):
    return await companies.upsert(**body.model_dump())


@router.get("/companies/{company_id}")
async def get_company(company_id: str):
    row = await companies.get(company_id)
    if not row:
        raise HTTPException(status_code=404, detail="Company not found")
    return row


# ── jobs ───────────────────────────────────────────────────────────────────
class JobUpsert(BaseModel):
    company_id: Optional[str] = None
    external_id: str
    title: str
    location: Optional[str] = None
    description: Optional[str] = None
    role_family: Optional[str] = None
    industry: Optional[str] = None
    seniority: Optional[str] = None
    must_have: Optional[list] = None
    source_url: Optional[str] = None
    content_hash: Optional[str] = None
    embedding: Optional[list[float]] = None


class JobSearch(BaseModel):
    query: Optional[str] = Field(default=None, description="Free text; embedded server-side")
    embedding: Optional[list[float]] = Field(default=None, description="Precomputed 768-d vector")
    role_family: Optional[str] = None
    industry: Optional[str] = None
    limit: int = 20


@router.get("/jobs")
async def list_jobs(
    role_family: Optional[str] = None,
    industry: Optional[str] = None,
    seniority: Optional[str] = None,
    is_active: bool = True,
    limit: int = Query(50, le=200),
    offset: int = 0,
):
    return await jobs.list_facet(
        role_family=role_family, industry=industry, seniority=seniority,
        is_active=is_active, limit=limit, offset=offset,
    )


@router.post("/jobs")
async def upsert_job(body: JobUpsert, _admin: str = Depends(require_admin)):
    return await jobs.upsert(**body.model_dump())


@router.post("/ingest-featured")
async def ingest_featured(render: bool = False, limit: Optional[int] = None,
                          _admin: str = Depends(require_admin)):
    """Slice-1 ingest trigger: pull ATS feeds for featured companies into the
    store (structured, incl. required_years_min). On-demand — no scheduler yet.
    `render=true` also renders bespoke pages to catch embedded ATS."""
    from app.services.job_ingest import ingest_featured_ats
    return await ingest_featured_ats(render=render, limit=limit)


class JobVerify(BaseModel):
    url: str = Field(..., max_length=2000)
    title: str = Field("", max_length=300)


@router.post("/jobs/verify")
async def verify_job(body: JobVerify, _user: str = Depends(get_current_user_id)):
    """Apply-time liveness gate: is this posting still open? Reuses the link-health
    validator. FAIL-OPEN — only 'broken' blocks; 'unknown' (couldn't determine)
    returns alive so we never wrongly block a live job. A confirmed-dead result
    also feeds the broken-log and deactivates the store row so search stops
    showing it."""
    if not is_allowed_url(body.url):
        raise HTTPException(status_code=400, detail="URL not allowed")
    from app.services import link_health
    res = await link_health.validate_job_url(body.url, body.title)
    status = res.get("status")
    alive = status != "broken"
    if not alive:
        try:
            await link_health.record(
                body.url, title=body.title, source="apply-gate", status=status,
                reason=res.get("reason", ""), http_code=res.get("http_code"),
                detail=res.get("detail", ""),
            )
        except Exception:  # noqa: BLE001
            pass
        try:
            await jobs.mark_dead_by_url(body.url, "apply_gate_dead")
        except Exception:  # noqa: BLE001
            pass
    return {"alive": alive, "status": status, "reason": res.get("reason", "")}


@router.post("/jobs/search")
async def search_jobs(body: JobSearch):
    vec = body.embedding
    if vec is None:
        if not body.query:
            raise HTTPException(status_code=400, detail="Provide `query` or `embedding`")
        from app.search.embed import embed_query
        # Blocking Gemini embed call → off the event loop.
        vec = await asyncio.to_thread(embed_query, body.query)
    return await jobs.search_semantic(
        embedding=vec, limit=body.limit,
        role_family=body.role_family, industry=body.industry,
    )


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    row = await jobs.get(job_id)
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return row


# ── Promoted job landing pages ("trang truyền thông") ────────────────────────
# Admin publishes a job from the store as a self-hosted public page. Writes are
# admin-only; the by-slug read is OPEN (the public page) and only ever serves a
# `published` row with internal snapshot fields stripped.
class PromoteCreate(BaseModel):
    job_id: str
    slug: Optional[str] = None            # auto from title+company when omitted
    status: str = "draft"                 # draft-first: review before going public
    template: str = "default"


class PromotePatch(BaseModel):
    slug: Optional[str] = None
    status: Optional[str] = None
    template: Optional[str] = None
    snapshot: Optional[dict] = None
    og_image_url: Optional[str] = None


@router.post("/promoted")
async def promote_job(body: PromoteCreate, admin: str = Depends(require_admin)):
    job = await jobs.get(body.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    company_name = ""
    if job.get("company_id"):
        company = await companies.get(job["company_id"])
        company_name = (company or {}).get("name") or ""

    # Materialize the JD now — a public landing page renders server-side, but
    # many stored jobs keep an empty description (SPA/Phenom/Workday expose the
    # JD only at apply-time). Best-effort: ATS API → full crawl.
    from app.services.jd_resolver import resolve_full_jd
    full_jd = await resolve_full_jd(job.get("source_url") or "", job.get("description") or "")
    if full_jd and len(full_jd) > len(job.get("description") or ""):
        job = {**job, "description": full_jd}
    snapshot = promoted.build_snapshot(job, company_name=company_name)
    jd_chars = len(snapshot.get("description") or "")

    # Idempotent re-create: refresh the snapshot on the existing page instead of
    # minting a second link for the same job. Preserve the existing status —
    # re-running must NOT silently un-publish a live page back to draft.
    existing = await promoted.get_by_job(body.job_id)
    if existing:
        row = await promoted.update(existing["id"], snapshot=snapshot,
                                    template=body.template)
        return {**row, "reused": True, "jd_chars": jd_chars}

    base = body.slug or f"{snapshot['title']}-{company_name}"
    slug = await promoted.unique_slug(base)
    row = await promoted.create(
        slug=slug, job_id=body.job_id, snapshot=snapshot,
        status=body.status, template=body.template, created_by=admin,
    )
    return {**row, "reused": False, "jd_chars": jd_chars}


@router.get("/promoted")
async def list_promoted(
    limit: int = Query(100, le=500), offset: int = 0,
    _admin: str = Depends(require_admin),
):
    return await promoted.list_pages(limit=limit, offset=offset)


@router.get("/promoted/by-slug/{slug}")
async def get_promoted_public(slug: str, preview: Optional[str] = None):
    """PUBLIC — the landing page read. Only PUBLISHED pages are served, EXCEPT
    when `preview` matches the row's own id: admins preview a draft via the real
    /j/ page by appending ?preview=<id> (the id is a random uuid only the admin
    list exposes, so it doubles as the preview token). Preview reads don't count
    as views. Internal fields (source_url) are always stripped by public_view()."""
    row = await promoted.get_by_slug(slug)
    if not row:
        raise HTTPException(status_code=404, detail="Page not found")
    is_preview = bool(preview) and preview == str(row.get("id"))
    if row.get("status") != "published" and not is_preview:
        raise HTTPException(status_code=404, detail="Page not found")
    if not is_preview:
        await promoted.increment_view(slug)
    return promoted.public_view(row)


@router.patch("/promoted/{page_id}")
async def patch_promoted(page_id: str, body: PromotePatch, _admin: str = Depends(require_admin)):
    row = await promoted.update(page_id, **body.model_dump(exclude_none=True))
    if not row:
        raise HTTPException(status_code=404, detail="Page not found")
    return row


@router.delete("/promoted/{page_id}")
async def delete_promoted(page_id: str, _admin: str = Depends(require_admin)):
    ok = await promoted.delete(page_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Page not found")
    return {"deleted": True}
