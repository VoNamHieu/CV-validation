"""
TopCV Crawler Service
Uses Playwright to bypass anti-bot + JSON-LD extraction for structured job data.
"""

import json
import time
import urllib.parse
from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class TopCVJob:
    title: str = ""
    company: str = ""
    salary: str = ""
    location: str = ""
    experience: str = ""
    url: str = ""
    date_posted: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class TopCVSearchResult:
    keyword: str = ""
    location: str = ""
    total_jobs: int = 0
    pages_crawled: int = 0
    jobs: list = field(default_factory=list)
    latency_ms: int = 0
    error: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


def _build_search_url(keyword: str, location: str = "", page: int = 1) -> str:
    """Build TopCV search URL."""
    params = {
        "sort": "new",
        "type_keyword": "1",
        "saturday_status": "0",
        "sba": "1",
    }
    if page > 1:
        params["page"] = str(page)

    base = f"https://www.topcv.vn/tim-viec-lam-{urllib.parse.quote(keyword.replace(' ', '-'))}"
    query = urllib.parse.urlencode(params)
    return f"{base}?{query}"


def _extract_jobs_from_json_ld(html: str) -> list[dict]:
    """Extract job listings from JSON-LD ItemList in TopCV page."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    scripts = soup.find_all("script", type="application/ld+json")

    jobs = []
    for script in scripts:
        try:
            data = json.loads(script.string or "")
            items = data if isinstance(data, list) else [data]
            for item in items:
                # ItemList contains all jobs on the page
                if item.get("@type") == "ItemList":
                    for el in item.get("itemListElement", []):
                        job_item = el.get("item", el)
                        jobs.append({
                            "title": job_item.get("name", ""),
                            "url": job_item.get("url", ""),
                            "position": el.get("position", 0),
                        })
                # Individual JobPosting
                elif item.get("@type") == "JobPosting":
                    jobs.append({
                        "title": item.get("title", ""),
                        "url": item.get("url", ""),
                        "company": item.get("hiringOrganization", {}).get("name", ""),
                        "date_posted": item.get("datePosted", ""),
                    })
        except json.JSONDecodeError:
            continue
    return jobs


def _extract_jobs_from_html(html: str) -> list[dict]:
    """Fallback: extract jobs from HTML cards if JSON-LD is missing."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    cards = soup.select(".job-item-search-result")

    jobs = []
    for card in cards:
        title_el = card.select_one("h3 a")
        company_el = card.select_one(".company")
        salary_el = card.select_one(".title-salary")
        location_el = card.select_one(".address")
        exp_el = card.select_one(".exp")

        if title_el:
            jobs.append({
                "title": title_el.get_text(strip=True),
                "url": title_el.get("href", ""),
                "company": company_el.get_text(strip=True) if company_el else "",
                "salary": salary_el.get_text(strip=True) if salary_el else "",
                "location": location_el.get_text(strip=True) if location_el else "",
                "experience": exp_el.get_text(strip=True) if exp_el else "",
            })
    return jobs


def _get_total_jobs(html: str) -> int:
    """Extract total job count from page."""
    from bs4 import BeautifulSoup
    import re

    soup = BeautifulSoup(html, "html.parser")
    # Look for text like "75 việc làm"
    result_text = soup.select_one(".job-header-title, .result-count, h1")
    if result_text:
        match = re.search(r"(\d+)\s*việc", result_text.get_text())
        if match:
            return int(match.group(1))
    return 0


def _create_playwright_context(browser):
    """Create a browser context with anti-detection measures."""
    context = browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport={"width": 1280, "height": 720},
        locale="vi-VN",
    )
    return context


def search_topcv(keyword: str, location: str = "", max_pages: int = 1) -> TopCVSearchResult:
    """
    Search TopCV for jobs using Playwright.
    Returns structured job data extracted from JSON-LD + HTML fallback.
    """
    result = TopCVSearchResult(keyword=keyword, location=location)
    start = time.time()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        result.error = "Playwright not installed. Run: pip install playwright && playwright install chromium"
        result.latency_ms = int((time.time() - start) * 1000)
        return result

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = _create_playwright_context(browser)
            page = context.new_page()

            # Hide automation signals
            page.add_init_script("delete Object.getPrototypeOf(navigator).webdriver")

            all_jobs = []

            for page_num in range(1, max_pages + 1):
                url = _build_search_url(keyword, location, page_num)

                try:
                    page.goto(url, timeout=25000)
                    page.wait_for_load_state("networkidle", timeout=15000)

                    # Extra wait for Cloudflare challenge
                    page.wait_for_timeout(2000)

                    html = page.content()

                    # Get total jobs count (first page only)
                    if page_num == 1:
                        result.total_jobs = _get_total_jobs(html)

                    # Try JSON-LD first (preferred)
                    json_ld_jobs = _extract_jobs_from_json_ld(html)

                    if json_ld_jobs:
                        # Enrich with HTML data (salary, experience not in JSON-LD)
                        html_jobs = _extract_jobs_from_html(html)
                        html_map = {j["url"]: j for j in html_jobs if j.get("url")}

                        for jl_job in json_ld_jobs:
                            merged = TopCVJob(
                                title=jl_job.get("title", ""),
                                url=jl_job.get("url", ""),
                                company=jl_job.get("company", ""),
                                date_posted=jl_job.get("date_posted", ""),
                            )
                            # Merge HTML data if available
                            html_match = html_map.get(jl_job.get("url", ""))
                            if html_match:
                                merged.company = html_match.get("company", "") or merged.company
                                merged.salary = html_match.get("salary", "")
                                merged.location = html_match.get("location", "")
                                merged.experience = html_match.get("experience", "")
                            all_jobs.append(merged.to_dict())
                    else:
                        # Fallback to HTML-only extraction
                        html_jobs = _extract_jobs_from_html(html)
                        for hj in html_jobs:
                            all_jobs.append(TopCVJob(**{k: hj.get(k, "") for k in TopCVJob.__dataclass_fields__}).to_dict())

                    result.pages_crawled = page_num

                    # No more jobs? Stop
                    if not json_ld_jobs and not html_jobs:
                        break

                except Exception as e:
                    if page_num == 1:
                        result.error = f"Page load failed: {str(e)[:200]}"
                        break
                    # For subsequent pages, just stop pagination
                    break

                # Polite delay between pages
                if page_num < max_pages:
                    page.wait_for_timeout(1500)

            result.jobs = all_jobs
            context.close()
            browser.close()

    except Exception as e:
        result.error = str(e)[:300]

    result.latency_ms = int((time.time() - start) * 1000)
    return result
