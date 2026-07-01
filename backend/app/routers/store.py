"""Catalog API — the public job/company universe (``/store``).

Reads are open; writes (upserts) are ingestion endpoints the crawler/indexer
calls. Semantic search accepts either a raw ``query`` (embedded server-side) or
a precomputed ``embedding``.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.db import companies, jobs

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
async def upsert_company(body: CompanyUpsert):
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
async def upsert_job(body: JobUpsert):
    return await jobs.upsert(**body.model_dump())


@router.post("/ingest-featured")
async def ingest_featured(render: bool = False, limit: Optional[int] = None):
    """Slice-1 ingest trigger: pull ATS feeds for featured companies into the
    store (structured, incl. required_years_min). On-demand — no scheduler yet.
    `render=true` also renders bespoke pages to catch embedded ATS."""
    from app.services.job_ingest import ingest_featured_ats
    return await ingest_featured_ats(render=render, limit=limit)


@router.post("/jobs/search")
async def search_jobs(body: JobSearch):
    vec = body.embedding
    if vec is None:
        if not body.query:
            raise HTTPException(status_code=400, detail="Provide `query` or `embedding`")
        from app.search.embed import embed_query
        vec = embed_query(body.query)
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
