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
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.db import companies, jobs, promoted
from app.services.auth import get_current_user_id, require_admin
from app.services.url_validator import is_allowed_url

logger = logging.getLogger(__name__)

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
    q: Optional[str] = None,
    limit: int = Query(100, le=500),
    offset: int = 0,
):
    return await companies.list_companies(
        in_universe=in_universe, q=q, limit=limit, offset=offset)


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
    company_logo: Optional[dict] = None
    if job.get("company_id"):
        company = await companies.get(job["company_id"])
        company_name = (company or {}).get("name") or ""
        # Reuse this company's stored logo (uploaded on an earlier promoted page)
        # so a new page auto-shows the brand without re-uploading.
        company_logo = await companies.get_logo(job["company_id"])

    # Materialize the JD now — a public landing page renders server-side, but
    # many stored jobs keep an empty description (SPA/Phenom/Workday expose the
    # JD only at apply-time). Best-effort: ATS API → full crawl.
    from app.services.jd_resolver import resolve_full_jd
    full_jd = await resolve_full_jd(job.get("source_url") or "", job.get("description") or "")
    if full_jd and len(full_jd) > len(job.get("description") or ""):
        job = {**job, "description": full_jd}
    snapshot = promoted.build_snapshot(job, company_name=company_name)
    # Seed the logo from the company (if it has one) so the page shows the brand
    # out of the box. An explicit upload via PATCH still overrides it later.
    if company_logo and company_logo.get("logo_b64"):
        snapshot["logo_b64"] = company_logo["logo_b64"]
        snapshot["logo_mime"] = company_logo.get("logo_mime") or "image/png"
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
    # Strip the (potentially large) logo bytes from the list; expose has_logo so
    # the panel can show/preview without shipping every base64 blob.
    rows = await promoted.list_pages(limit=limit, offset=offset)
    for r in rows:
        snap = r.get("snapshot") or {}
        snap["has_logo"] = bool(snap.pop("logo_b64", None))
    return rows


@router.get("/promoted/featured")
async def list_promoted_featured(limit: int = Query(12, le=24)):
    """PUBLIC — recent published promoted pages for the landing featured strip."""
    return await promoted.list_featured(limit=limit)


@router.get("/promoted/sitemap")
async def promoted_sitemap():
    """PUBLIC — slug + updated_at of published pages, for the frontend sitemap.xml."""
    return await promoted.list_sitemap()


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
    # View counting moved to a client beacon (POST /promoted/{slug}/view): the /j
    # page is now cached/prerendered, so a per-read increment here would either be
    # skipped (cache hit) or, worse, count every no-JS crawler. The beacon only
    # fires from a real browser.
    return promoted.public_view(row)


@router.post("/promoted/{slug}/view")
async def count_promoted_view(slug: str):
    """PUBLIC — count one human view, fired by a client beacon on /j/<slug>.
    Best-effort: an unknown/draft slug just no-ops (0 rows updated)."""
    await promoted.increment_view(slug)
    return {"ok": True}


@router.get("/promoted/related/{slug}")
async def get_promoted_related(slug: str, response: Response):
    """PUBLIC — cross-links shown on the /j/ page: other PUBLISHED promoted pages
    with the same role (elsewhere) + more roles at the same company. Computes the
    match keys from THIS row's snapshot server-side (never trusts the client) and
    returns only safe card fields (no source_url / logo bytes). The current row
    itself may be a draft (preview) — related items are always published."""
    row = await promoted.get_by_slug(slug)
    if not row:
        return {"same_company": [], "similar_role": []}
    snap = row.get("snapshot") or {}
    company = snap.get("company_name") or ""
    role_family = snap.get("role_family") or ""
    same_company = await promoted.list_same_company(company, exclude_slug=slug, limit=10)
    similar_role = await promoted.list_similar_role(
        role_family, company_name=company, exclude_slug=slug, limit=10)
    response.headers["Cache-Control"] = "public, max-age=300"
    return {"same_company": same_company, "similar_role": similar_role}


@router.get("/promoted/logo-by-slug/{slug}")
async def get_promoted_logo(slug: str, preview: Optional[str] = None):
    """PUBLIC — serve the uploaded company logo as image bytes (real URL, usable
    as og:image + <img src>). Same publish/preview gate as the page."""
    import base64
    from fastapi import Response
    row = await promoted.get_by_slug(slug)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    is_preview = bool(preview) and preview == str(row.get("id"))
    if row.get("status") != "published" and not is_preview:
        raise HTTPException(status_code=404, detail="Not found")
    snap = row.get("snapshot") or {}
    b64 = snap.get("logo_b64")
    if not b64:
        raise HTTPException(status_code=404, detail="No logo")
    try:
        data = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=404, detail="Bad logo")
    return Response(content=data, media_type=snap.get("logo_mime") or "image/png",
                   headers={"Cache-Control": "public, max-age=300"})


# Logo base64 cap (~700KB b64 ≈ 512KB image) — keeps the snapshot JSON sane.
_MAX_LOGO_B64 = 750_000


async def _mirror_logo_to_company(page_row: dict, logo_b64: str, logo_mime: Optional[str]) -> None:
    """Save a promoted page's uploaded logo as the linked company's source logo
    (page.job_id → jobs.company_id → companies). Best-effort: a failure here must
    never break saving the page, so it's swallowed with a log line."""
    try:
        job_id = page_row.get("job_id")
        if not job_id:
            return
        job = await jobs.get(job_id)
        company_id = (job or {}).get("company_id")
        if not company_id:
            return
        await companies.set_logo(company_id, logo_b64=logo_b64, logo_mime=logo_mime)
    except Exception:  # noqa: BLE001
        logger.info("mirror promoted logo → company failed", exc_info=True)


@router.patch("/promoted/{page_id}")
async def patch_promoted(page_id: str, body: PromotePatch, _admin: str = Depends(require_admin)):
    logo_b64 = None
    if body.snapshot is not None:
        b64 = body.snapshot.get("logo_b64")
        if isinstance(b64, str) and len(b64) > _MAX_LOGO_B64:
            raise HTTPException(status_code=413, detail="Logo quá lớn (tối đa ~512KB).")
        if isinstance(b64, str) and b64:
            logo_b64 = b64
    row = await promoted.update(page_id, **body.model_dump(exclude_none=True))
    if not row:
        raise HTTPException(status_code=404, detail="Page not found")
    # A fresh logo upload becomes the company's source logo (reused on other
    # pages + surfaces). Only when the PATCH actually carried logo bytes.
    if logo_b64:
        await _mirror_logo_to_company(row, logo_b64, body.snapshot.get("logo_mime"))
    return row


@router.get("/companies/{company_id}/logo")
async def get_company_logo(company_id: str):
    """PUBLIC — serve a company's stored logo as image bytes (real URL, usable as
    <img src>). 404 when the company has no uploaded logo (callers fall back to
    the Clearbit-from-domain guess or a letter avatar)."""
    import base64
    from fastapi import Response
    logo = await companies.get_logo(company_id)
    b64 = (logo or {}).get("logo_b64")
    if not b64:
        raise HTTPException(status_code=404, detail="No logo")
    try:
        data = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=404, detail="Bad logo")
    return Response(content=data, media_type=(logo or {}).get("logo_mime") or "image/png",
                    headers={"Cache-Control": "public, max-age=300"})


class CompanyLogoUpload(BaseModel):
    logo_b64: str                          # base64 payload (no data: prefix)
    logo_mime: Optional[str] = None        # e.g. image/png, image/jpeg


@router.post("/companies/{company_id}/logo")
async def set_company_logo(
    company_id: str, body: CompanyLogoUpload, _admin: str = Depends(require_admin),
):
    """Admin: attach a source logo to a company. Stored inline (base64) exactly
    like the promoted-page upload, then reused everywhere the company shows up
    (promoted pages seed from it, surfaces render it via the GET logo endpoint)
    instead of falling back to a letter avatar. Client downscales to ≤256px."""
    if not await companies.get(company_id):
        raise HTTPException(status_code=404, detail="Company not found")
    b64 = (body.logo_b64 or "").strip()
    if not b64:
        raise HTTPException(status_code=400, detail="Thiếu ảnh logo.")
    if len(b64) > _MAX_LOGO_B64:
        raise HTTPException(status_code=413, detail="Logo quá lớn (tối đa ~512KB).")
    await companies.set_logo(company_id, logo_b64=b64, logo_mime=body.logo_mime)
    return {"id": company_id, "has_logo": True}


@router.get("/companies/logo-by-domain/{domain}")
async def get_company_logo_by_domain(domain: str):
    """PUBLIC — serve a company's uploaded logo by DOMAIN (real URL, usable as an
    <img src>). Lets surfaces that only know a domain (landing marquee, featured
    groups) prefer the uploaded brand; 404 when none, so callers fall back to a
    Clearbit-from-domain guess or a letter avatar."""
    import base64
    from fastapi import Response
    logo = await companies.get_logo_by_domain(domain)
    b64 = (logo or {}).get("logo_b64")
    if not b64:
        raise HTTPException(status_code=404, detail="No logo")
    try:
        data = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=404, detail="Bad logo")
    return Response(content=data, media_type=(logo or {}).get("logo_mime") or "image/png",
                    headers={"Cache-Control": "public, max-age=300"})


@router.delete("/companies/{company_id}/logo")
async def delete_company_logo(company_id: str, _admin: str = Depends(require_admin)):
    """Admin: remove a company's stored logo (falls back to the letter avatar)."""
    ok = await companies.clear_logo(company_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Company not found")
    return {"id": company_id, "has_logo": False}


@router.delete("/promoted/{page_id}")
async def delete_promoted(page_id: str, _admin: str = Depends(require_admin)):
    ok = await promoted.delete(page_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Page not found")
    return {"deleted": True}
