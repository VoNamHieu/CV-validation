"""
Smart Search Router — LLM-powered job link extraction
Uses Playwright to crawl SPA job sites, then Gemini Pro to identify job posting URLs.
"""

import os
import json
import random
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from bs4 import BeautifulSoup
from urllib.parse import urlparse
from google import genai
from dotenv import load_dotenv
from app.services.crawler import try_http_fetch, try_playwright_fetch, clean_html, detect_needs_playwright

load_dotenv()

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

router = APIRouter(prefix="/crawl", tags=["Smart Crawl"])

# ── Gemini client (lazy init) ──
_gemini_client = None

def _get_gemini():
    global _gemini_client
    if _gemini_client is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not set")
        _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client


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

            # Deduplicate
            if href in seen:
                continue
            seen.add(href)

            link_text = a_tag.get_text(strip=True)[:100]
            candidates.append({"url": href, "text": link_text})

        except Exception:
            continue

    logger.info(f"[extract_candidates] Found {len(candidates)} candidate links on {target_hostname}")
    return candidates[:100]  # Cap at 100 for LLM context


# ── Step 2: Ask Gemini to identify job posting URLs ──
async def llm_identify_job_links(
    candidates: list[dict],
    search_keyword: str,
    target_hostname: str,
) -> list[str]:
    """
    Use Gemini Pro to identify which URLs are individual job posting pages.
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

Return a JSON array of the URLs that are individual job postings. Return ONLY the JSON array, nothing else.
Example: ["https://example.com/job/123", "https://example.com/viec-lam/title-456"]
If no job posting URLs found, return: []"""

    try:
        client = _get_gemini()
        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt,
        )

        text = response.text.strip()
        logger.info(f"[llm_identify_jobs] Raw LLM response: {text[:500]}")

        # Parse JSON from response (handle markdown code blocks)
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()

        job_urls = json.loads(text)

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


# ── Main endpoint ──
@router.post("/smart-search", response_model=SmartCrawlResponse)
async def smart_crawl(req: SmartCrawlRequest):
    """
    1. Crawl search page (HTTP → Playwright fallback)
    2. Extract candidate links
    3. Ask Gemini to identify job posting URLs
    4. Pick random job, crawl it, return cleaned text
    """
    search_url = req.search_url or req.url
    if not search_url:
        raise HTTPException(status_code=400, detail="url or search_url is required")

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

    # ── Step 3: LLM identifies job posting URLs ──
    job_links = await llm_identify_job_links(candidates, req.search_keyword, target_hostname)
    debug_info["job_links_found"] = len(job_links)
    debug_info["job_links"] = job_links[:10]

    if not job_links:
        # Fallback: if LLM finds nothing, return candidates for debugging
        debug_info["fallback"] = "LLM found no jobs, returning candidate sample"
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
