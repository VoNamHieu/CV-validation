from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.topcv_crawler import search_topcv

router = APIRouter(prefix="/topcv", tags=["TopCV"])


class TopCVSearchRequest(BaseModel):
    keyword: str
    location: str = ""
    max_pages: int = 1


class TopCVJobResponse(BaseModel):
    title: str
    company: str
    salary: str
    location: str
    experience: str
    url: str
    date_posted: str


class TopCVSearchResponse(BaseModel):
    keyword: str
    location: str
    total_jobs: int
    pages_crawled: int
    jobs: list[TopCVJobResponse]
    latency_ms: int
    error: str


@router.post("/search", response_model=TopCVSearchResponse)
async def search_jobs(req: TopCVSearchRequest):
    """
    Search TopCV for jobs using Playwright + JSON-LD extraction.
    Requires Playwright to be installed locally.
    """
    if not req.keyword.strip():
        raise HTTPException(status_code=400, detail="Keyword is required.")
    if req.max_pages < 1 or req.max_pages > 5:
        raise HTTPException(status_code=400, detail="max_pages must be 1-5.")

    result = await search_topcv(
        keyword=req.keyword.strip(),
        location=req.location.strip(),
        max_pages=req.max_pages,
    )

    return result.to_dict()
