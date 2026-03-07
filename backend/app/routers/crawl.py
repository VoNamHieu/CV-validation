from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.crawler import crawl_url
from app.services.url_validator import is_allowed_url

router = APIRouter(prefix="/crawl", tags=["Crawl Testing"])


class CrawlRequest(BaseModel):
    urls: list[str]


class CrawlResultResponse(BaseModel):
    url: str
    http_success: bool
    needs_playwright: bool
    has_json_ld: bool
    json_ld_data: dict | None = None
    raw_html_length: int
    cleaned_text: str
    cleaned_text_length: int
    error: str
    latency_ms: int


class CrawlTestResponse(BaseModel):
    results: list[CrawlResultResponse]
    summary: dict


@router.post("/test", response_model=CrawlTestResponse)
async def test_crawl(req: CrawlRequest):
    """
    Test crawling a batch of URLs.
    Returns per-URL results + aggregate summary stats.
    """
    if not req.urls:
        raise HTTPException(status_code=400, detail="At least one URL is required.")
    if len(req.urls) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 URLs per request.")

    results = []
    for url in req.urls:
        url = url.strip()
        if not url:
            continue
        # ── SSRF Protection (B1) ──
        if not is_allowed_url(url):
            raise HTTPException(status_code=400, detail=f"URL not allowed: {url}")
        result = await crawl_url(url)
        results.append(result.to_dict())

    total = len(results)
    if total == 0:
        raise HTTPException(status_code=400, detail="No valid URLs provided.")

    summary = {
        "total": total,
        "json_ld_count": sum(1 for r in results if r["has_json_ld"]),
        "json_ld_pct": round(sum(1 for r in results if r["has_json_ld"]) / total * 100),
        "http_ok_count": sum(1 for r in results if r["http_success"] and not r["needs_playwright"]),
        "http_ok_pct": round(sum(1 for r in results if r["http_success"] and not r["needs_playwright"]) / total * 100),
        "playwright_count": sum(1 for r in results if r["needs_playwright"]),
        "playwright_pct": round(sum(1 for r in results if r["needs_playwright"]) / total * 100),
        "avg_latency_ms": round(sum(r["latency_ms"] for r in results) / total),
    }

    return CrawlTestResponse(results=results, summary=summary)
