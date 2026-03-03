"""
Smart Search Router
Uses Playwright to crawl SPA job sites, extract job links, and return job page content.
"""

import re
import random
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.crawler import try_http_fetch, try_playwright_fetch, clean_html, detect_needs_playwright

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

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
    method: str = ""
    debug: dict = {}


# URLs to skip — navigation, auth, static pages
SKIP_PATTERNS = [
    "/login", "/register", "/sign", "/auth", "/account",
    "/about", "/contact", "/faq", "/help", "/terms", "/privacy",
    "/employer", "/nha-tuyen-dung", "/blog", "/news",
    "/cong-ty/", "/company/", "/companies/",  # company pages, not job pages
    "/cart", "/checkout", "/pricing",
    ".css", ".js", ".png", ".jpg", ".svg", ".ico",
    "facebook.com", "google.com", "linkedin.com/share",
    "twitter.com", "youtube.com",
    "#", "javascript:", "mailto:", "tel:",
]


def extract_job_links_from_html(html: str, target_hostname: str) -> list[str]:
    """Extract job posting URLs from rendered HTML."""
    from bs4 import BeautifulSoup
    from urllib.parse import urlparse

    soup = BeautifulSoup(html, "html.parser")
    clean_target = target_hostname.replace("www.", "")

    all_links = []
    job_links = []

    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"].strip()
        if not href:
            continue

        # Skip obvious non-job links
        href_lower = href.lower()
        if any(skip in href_lower for skip in SKIP_PATTERNS):
            continue

        # Make relative URLs absolute
        if href.startswith("/"):
            href = f"https://{target_hostname}{href}"

        # Skip non-http links
        if not href.startswith("http"):
            continue

        try:
            parsed = urlparse(href)
            link_host = parsed.hostname or ""

            # Must be from target domain
            if clean_target not in link_host:
                continue

            path = parsed.path.lower().rstrip("/")
            link_text = a_tag.get_text(strip=True)

            all_links.append({"href": href, "path": path, "text": link_text[:80]})

            # Skip very short paths (homepage, category pages)
            if len(path) < 5:
                continue

            # Skip known non-job paths
            if path in ["/viec-lam", "/jobs", "/job", "/en", "/vi"]:
                continue

            # ── Job detection heuristics ──

            # Pattern 1: Explicit job path patterns
            job_path_patterns = [
                "/job/", "/jobs/", "/viec-lam/", "/work/",
                "/career/", "/position/", "/tin-tuyen-dung/",
                "/recruitment/", "/opening/", "/vacancy/",
            ]
            has_job_path = any(p in path for p in job_path_patterns)

            # Pattern 2: VietnamWorks style — ends with -jv (job view)
            ends_with_jv = path.endswith("-jv")

            # Pattern 3: Path has numeric ID (common for job detail pages)
            has_numeric_id = bool(re.search(r'[\-/]\d{3,}', path))

            # Pattern 4: URLs with descriptive slugs + ID suffixes
            # e.g. /software-engineer-12345 or /viec-lam/frontend-developer-kw
            slug_with_id = bool(re.search(r'/[a-z][\w-]{10,}-\d+', path))

            # Pattern 5: Link text looks like a job title (has reasonable length)
            text_looks_like_job = 10 < len(link_text) < 150

            # Score the link
            score = 0
            if has_job_path:
                score += 3
            if ends_with_jv:
                score += 3
            if has_numeric_id:
                score += 2
            if slug_with_id:
                score += 2
            if text_looks_like_job:
                score += 1

            if score >= 2 and href not in job_links:
                job_links.append(href)

        except Exception:
            continue

    logger.info(f"[extract_job_links] Total links on page: {len(all_links)}")
    logger.info(f"[extract_job_links] Job links found: {len(job_links)}")
    if all_links:
        logger.info(f"[extract_job_links] Sample links: {all_links[:10]}")

    return job_links[:20]


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
        if detect_needs_playwright(http_data):
            method = "playwright"
            pw_ok, pw_data = await try_playwright_fetch(search_url)
            if pw_ok:
                raw_html = pw_data
    else:
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
    debug_info["html_sample"] = raw_html[:2000]  # First 2000 chars for debug

    logger.info(f"[smart_crawl] Crawled {search_url} with {method}, got {len(raw_html)} chars")

    # Step 2: Extract job links from the HTML
    job_links = extract_job_links_from_html(raw_html, target_hostname)
    debug_info["job_links_found"] = len(job_links)
    debug_info["job_links"] = job_links[:10]

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
        job_page_text=cleaned_text[:15000],
        all_job_urls=job_links,
        method=method,
        debug=debug_info,
    )
