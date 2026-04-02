"""
Smart Search Router — LLM-powered job link extraction
Uses Playwright to crawl SPA job sites, then GPT-5 to identify job posting URLs.
"""

import json
import re
import random
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from bs4 import BeautifulSoup
from urllib.parse import urlparse
from app.services.crawler import try_http_fetch, try_playwright_fetch, clean_html, detect_needs_playwright, extract_json_ld as _extract_jsonld_job
from app.services.openai_client import get_raw_client, MODEL, is_overloaded
from app.services.url_validator import is_allowed_url

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

router = APIRouter(prefix="/crawl", tags=["Smart Crawl"])




# ── Models ──
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


# ── Step 1: Extract all candidate links from HTML ──
SKIP_PATTERNS = [
    "/login", "/register", "/sign", "/auth", "/account",
    "/about", "/contact", "/faq", "/help", "/terms", "/privacy",
    "/employer", "/nha-tuyen-dung", "/blog", "/news",
    "/cart", "/checkout", "/pricing",
    ".css", ".js", ".png", ".jpg", ".svg", ".ico",
    "facebook.com", "google.com", "linkedin.com/share",
    "twitter.com", "youtube.com",
    "#", "javascript:", "mailto:", "tel:",
]


def extract_candidate_links(html: str, target_hostname: str) -> list[dict]:
    """
    Extract all links from HTML that belong to the target domain.
    Returns list of {url, text} for LLM analysis.
    """
    soup = BeautifulSoup(html, "html.parser")
    clean_target = target_hostname.replace("www.", "")
    seen = set()
    candidates = []

    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"].strip()
        if not href:
            continue

        href_lower = href.lower()
        if any(skip in href_lower for skip in SKIP_PATTERNS):
            continue

        # Make relative URLs absolute
        if href.startswith("/"):
            href = f"https://{target_hostname}{href}"

        if not href.startswith("http"):
            continue

        try:
            parsed = urlparse(href)
            link_host = parsed.hostname or ""
            if clean_target not in link_host:
                continue

            path = parsed.path.rstrip("/")
            if len(path) < 3:
                continue

            # Deduplicate — use path without query params for dedup
            clean_url = f"{parsed.scheme}://{parsed.hostname}{path}"
            if clean_url in seen:
                continue
            seen.add(clean_url)

            link_text = a_tag.get_text(strip=True)[:100]

            # If link text is empty (SPA rendering), derive from URL slug
            if not link_text:
                slug = path.rsplit("/", 1)[-1]
                # Remove common suffixes like -jv, -jd, numeric IDs
                slug_clean = re.sub(r'-\d+(-jv|-jd)?$', '', slug)
                link_text = slug_clean.replace("-", " ").strip().title()

            candidates.append({"url": clean_url, "text": link_text})

        except Exception:
            continue

    logger.info(f"[extract_candidates] Found {len(candidates)} candidate links on {target_hostname}")
    return candidates[:100]  # Cap at 100 for LLM context


# ── Step 2: Ask GPT-5 to identify job posting URLs ──
async def llm_identify_job_links(
    candidates: list[dict],
    search_keyword: str,
    target_hostname: str,
) -> list[str]:
    """
    Use GPT-5 to identify which URLs are individual job posting pages.
    Returns list of job posting URLs.
    """
    if not candidates:
        return []

    # Build compact link list for LLM
    link_list = "\n".join(
        f"{i+1}. URL: {c['url']}  |  Text: {c['text']}"
        for i, c in enumerate(candidates[:60])  # Max 60 links to keep prompt small
    )

    prompt = f"""You are analyzing a job search results page from {target_hostname}.
The user searched for: "{search_keyword}"

Below is a list of links found on the page. Your task is to identify which URLs are links to INDIVIDUAL JOB POSTING pages (where you can read a single job description).

RULES:
- ONLY select URLs that lead to a SINGLE job posting detail page
- DO NOT select: search result pages, category pages, company profile pages, blog posts, login pages, homepage
- Look at both the URL pattern and the link text to determine if it's a job posting
- A job posting URL typically contains: a job title slug, a numeric ID, or a path like /job/, /viec-lam/, etc.
- Company pages (e.g. /cong-ty/, /company/) are NOT job postings
- Search pages (e.g. /tim-viec-lam-*, /search?) are NOT job postings

LINKS:
{link_list}

Return a JSON object with key "urls" containing an array of the URLs that are individual job postings.
Example: {{"urls": ["https://example.com/job/123", "https://example.com/viec-lam/title-456"]}}
If no job posting URLs found, return: {{"urls": []}}"""

    try:
        client = get_raw_client()
        logger.info(f"[llm_identify_jobs] Calling {MODEL}...")
        response = client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "You identify job posting URLs from a list of links. Always respond in JSON format."},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
        )

        text = response.choices[0].message.content or ""
        text = text.strip()
        logger.info(f"[llm_identify_jobs] Raw LLM response: {text[:500]}")

        parsed = json.loads(text)
        job_urls = parsed.get("urls", parsed) if isinstance(parsed, dict) else parsed

        if not isinstance(job_urls, list):
            logger.warning(f"[llm_identify_jobs] LLM returned non-list: {type(job_urls)}")
            return []

        # Validate URLs exist in candidates
        candidate_urls = {c["url"] for c in candidates}
        validated = [u for u in job_urls if isinstance(u, str) and u in candidate_urls]

        logger.info(f"[llm_identify_jobs] LLM identified {len(validated)} job URLs from {len(candidates)} candidates")
        return validated[:20]

    except Exception as e:
        logger.error(f"[llm_identify_jobs] LLM error: {e}")
        return []


# ── Step 2b: Heuristic fallback — pattern-based job URL detection ──
# Common job URL patterns by site
JOB_URL_PATTERNS = [
    # VietnamWorks: slug-ending-in-<id>-jv
    re.compile(r'/[a-z0-9-]+-\d+-jv$', re.I),
    # TopCV: /viec-lam/<slug>
    re.compile(r'/viec-lam/[a-z0-9-]+-\d+', re.I),
    # Generic: /job/<id>, /jobs/<slug>
    re.compile(r'/jobs?/[a-z0-9-]*\d{4,}', re.I),
    # CareerBuilder VN: /viec-lam/<slug>.html
    re.compile(r'/viec-lam/[a-z0-9-]+\.html$', re.I),
    # Indeed: /viewjob or /rc/clk
    re.compile(r'/(viewjob|rc/clk)\?', re.I),
    # LinkedIn: /jobs/view/<id>
    re.compile(r'/jobs/view/\d+', re.I),
]


def _heuristic_job_links(candidates: list[dict], target_hostname: str) -> list[str]:
    """
    Fallback: identify job URLs using URL patterns when LLM fails.
    Useful when link text is empty (SPA sites).
    """
    job_urls = []
    for c in candidates:
        url = c["url"]
        parsed = urlparse(url)
        path = parsed.path + ("?" + parsed.query if parsed.query else "")

        for pattern in JOB_URL_PATTERNS:
            if pattern.search(path):
                job_urls.append(url)
                break

    logger.info(f"[heuristic_job_links] Found {len(job_urls)} job URLs from {len(candidates)} candidates")
    return job_urls[:20]

# ── Main endpoint ──
@router.post("/smart-search", response_model=SmartCrawlResponse)
async def smart_crawl(req: SmartCrawlRequest):
    """
    1. Crawl search page (HTTP → Playwright fallback)
    2. Extract candidate links
    3. Ask GPT-5 to identify job posting URLs
    4. Pick random job, crawl it, return cleaned text
    """
    search_url = req.search_url or req.url
    if not search_url:
        raise HTTPException(status_code=400, detail="url or search_url is required")

    # ── SSRF Protection (B1) ──
    if not is_allowed_url(search_url):
        raise HTTPException(status_code=400, detail="URL not allowed")
    if req.url and not is_allowed_url(req.url):
        raise HTTPException(status_code=400, detail="URL not allowed")

    target_hostname = urlparse(req.url).hostname or ""
    debug_info = {
        "search_url": search_url,
        "target_hostname": target_hostname,
    }

    # ── Step 1: Crawl the search results page ──
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
    logger.info(f"[smart_crawl] Crawled {search_url} with {method}, got {len(raw_html)} chars")

    # ── Step 2: Extract candidate links ──
    candidates = extract_candidate_links(raw_html, target_hostname)
    debug_info["candidate_links_count"] = len(candidates)
    debug_info["candidate_sample"] = candidates[:5]

    if not candidates:
        return SmartCrawlResponse(
            success=False,
            method=method,
            debug={**debug_info, "error": "No links found on search page"}
        )

    # ── Step 3: GPT-5 identifies job posting URLs ──
    job_links = await llm_identify_job_links(candidates, req.search_keyword, target_hostname)
    debug_info["job_links_found"] = len(job_links)
    debug_info["job_links"] = job_links[:10]

    if not job_links:
        # Fallback: heuristic pattern matching for common job URL patterns
        logger.info("[smart_crawl] LLM found nothing, trying heuristic fallback...")
        job_links = _heuristic_job_links(candidates, target_hostname)
        debug_info["heuristic_job_links"] = len(job_links)
        debug_info["fallback"] = "heuristic"

    if not job_links:
        debug_info["fallback"] = "No jobs found by LLM or heuristic"
        return SmartCrawlResponse(
            success=False,
            all_job_urls=[],
            method=method,
            debug=debug_info,
        )

    # ── Step 4: Pick a random job ──
    selected_url = random.choice(job_links[:10])
    debug_info["selected_job_url"] = selected_url

    # ── Step 5: Crawl the selected job page ──
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

    # ── Step 6: Clean and return ──
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


# ── Single-page fetch endpoint (Playwright fallback for job detail pages) ──
class FetchPageRequest(BaseModel):
    url: str


class FetchPageResponse(BaseModel):
    success: bool
    text: str = ""
    method: str = ""
    error: str = ""
    jsonLd: dict | None = None





@router.post("/fetch-page", response_model=FetchPageResponse)
async def fetch_page(req: FetchPageRequest):
    """
    Fetch a single URL with HTTP → Playwright fallback.
    Also extracts JSON-LD JobPosting data when available.
    """
    if not req.url:
        raise HTTPException(status_code=400, detail="url is required")

    # ── SSRF Protection (B1) ──
    if not is_allowed_url(req.url):
        raise HTTPException(status_code=400, detail="URL not allowed")

    # Try HTTP first
    http_ok, http_data = try_http_fetch(req.url)
    if http_ok and not detect_needs_playwright(http_data):
        jsonld = _extract_jsonld_job(http_data)
        cleaned = clean_html(http_data)
        if len(cleaned) >= 200 or jsonld:
            return FetchPageResponse(success=True, text=cleaned[:15000], method="http", jsonLd=jsonld)

    # Playwright fallback
    logger.info(f"[fetch_page] Using Playwright for: {req.url}")
    pw_ok, pw_data = await try_playwright_fetch(req.url)
    if pw_ok:
        jsonld = _extract_jsonld_job(pw_data)
        cleaned = clean_html(pw_data)
        return FetchPageResponse(success=True, text=cleaned[:15000], method="playwright", jsonLd=jsonld)

    return FetchPageResponse(
        success=False,
        error=f"HTTP: {http_data if not http_ok else 'thin content'} | Playwright: {pw_data if not pw_ok else 'failed'}"
    )
