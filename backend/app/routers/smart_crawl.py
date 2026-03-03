"""
Smart Search Router
Uses Playwright to crawl SPA job sites, extract job links, and return job page content.
"""

import re
import random
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.crawler import try_http_fetch, try_playwright_fetch, clean_html, detect_needs_playwright

router = APIRouter(prefix="/crawl", tags=["Smart Crawl"])


class SmartCrawlRequest(BaseModel):
    url: str
    search_keyword: str = ""
    search_url: str = ""


class SmartCrawlResponse(BaseModel):
    success: bool
    selected_job_url: str = ""
    job_page_text: str = ""
    all_job_urls: list[str] = []
    method: str = ""  # "http" or "playwright"
    debug: dict = {}


def extract_job_links_from_html(html: str, target_hostname: str) -> list[str]:
    """Extract job posting URLs from HTML using regex on <a href> tags."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    links = []

    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"]

        # Skip empty, fragment, and javascript links
        if not href or href.startswith("#") or href.startswith("javascript:"):
            continue

        # Make relative URLs absolute
        if href.startswith("/"):
            href = f"https://{target_hostname}{href}"

        # Skip non-http links
        if not href.startswith("http"):
            continue

        # Check if the link is from the target site
        try:
            from urllib.parse import urlparse
            parsed = urlparse(href)
            link_host = parsed.hostname or ""

            # Must be same domain
            clean_target = target_hostname.replace("www.", "")
            if clean_target not in link_host:
                continue

            # Job link heuristics — common URL patterns for job postings
            path = parsed.path.lower()
            job_patterns = [
                "/job/", "/jobs/", "/viec-lam/", "/work/",
                "/career/", "/position/", "/tin-tuyen-dung/",
                "/recruitment/", "/opening/", "/vacancy/",
            ]

            # Check path for job patterns
            is_job = any(p in path for p in job_patterns)

            # Also check for numeric IDs in path (common for job pages)
            has_id = bool(re.search(r'/\d{4,}', path))

            # Check inner text for job-related content
            link_text = a_tag.get_text(strip=True).lower()
            text_has_job_signal = len(link_text) > 10 and len(link_text) < 200

            if is_job or (has_id and text_has_job_signal):
                # Deduplicate
                if href not in links:
                    links.append(href)

        except Exception:
            continue

    return links[:20]  # Max 20 links


@router.post("/smart-search", response_model=SmartCrawlResponse)
async def smart_crawl(req: SmartCrawlRequest):
    """
    Crawl a job search results page (with Playwright fallback) and extract job links.
    Then crawl a random job page and return its content.
    """
    search_url = req.search_url or req.url
    if not search_url:
        raise HTTPException(status_code=400, detail="url or search_url is required")

    from urllib.parse import urlparse
    target_hostname = urlparse(req.url).hostname or ""

    debug_info = {
        "search_url": search_url,
        "target_hostname": target_hostname,
    }

    # Step 1: Crawl the search results page
    method = "http"
    http_ok, http_data = try_http_fetch(search_url)
    raw_html = ""

    if http_ok:
        raw_html = http_data
        # Check if page needs JS rendering
        if detect_needs_playwright(http_data):
            method = "playwright"
            pw_ok, pw_data = await try_playwright_fetch(search_url)
            if pw_ok:
                raw_html = pw_data
    else:
        # HTTP failed, go straight to Playwright
        method = "playwright"
        pw_ok, pw_data = await try_playwright_fetch(search_url)
        if pw_ok:
            raw_html = pw_data
        else:
            return SmartCrawlResponse(
                success=False,
                debug={**debug_info, "error": f"HTTP: {http_data}, Playwright: {pw_data}"}
            )

    debug_info["search_page_html_length"] = len(raw_html)
    debug_info["method"] = method

    # Step 2: Extract job links from the HTML
    job_links = extract_job_links_from_html(raw_html, target_hostname)
    debug_info["job_links_found"] = len(job_links)
    debug_info["job_links"] = job_links[:5]  # Log first 5

    if not job_links:
        return SmartCrawlResponse(
            success=False,
            all_job_urls=[],
            method=method,
            debug={**debug_info, "error": "No job links found on search page"}
        )

    # Step 3: Pick a random job
    selected_url = random.choice(job_links[:10])
    debug_info["selected_job_url"] = selected_url

    # Step 4: Crawl the selected job page
    job_html = ""
    http_ok2, http_data2 = try_http_fetch(selected_url)
    if http_ok2:
        job_html = http_data2
        if detect_needs_playwright(http_data2):
            pw_ok2, pw_data2 = await try_playwright_fetch(selected_url)
            if pw_ok2:
                job_html = pw_data2
    else:
        pw_ok2, pw_data2 = await try_playwright_fetch(selected_url)
        if pw_ok2:
            job_html = pw_data2

    if not job_html:
        return SmartCrawlResponse(
            success=False,
            selected_job_url=selected_url,
            all_job_urls=job_links,
            method=method,
            debug={**debug_info, "error": "Could not fetch the selected job page"}
        )

    # Step 5: Clean the job page HTML
    cleaned_text = clean_html(job_html)
    debug_info["job_page_text_length"] = len(cleaned_text)

    return SmartCrawlResponse(
        success=True,
        selected_job_url=selected_url,
        job_page_text=cleaned_text[:15000],  # Limit for Gemini context
        all_job_urls=job_links,
        method=method,
        debug=debug_info,
    )
