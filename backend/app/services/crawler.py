"""
Job Crawler Service
Handles HTTP fetching, JSON-LD extraction, Playwright fallback, and HTML cleaning.
"""

import json
import re
import time
from dataclasses import dataclass, field, asdict
from typing import Optional

import requests
from bs4 import BeautifulSoup


# ── DATA STRUCTURES ───────────────────────────────────────────────────────────

@dataclass
class CrawlResult:
    url: str
    http_success: bool = False
    needs_playwright: bool = False
    has_json_ld: bool = False
    json_ld_data: Optional[dict] = None
    raw_html_length: int = 0
    cleaned_text: str = ""
    cleaned_text_length: int = 0
    error: str = ""
    latency_ms: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


# ── JSON-LD DETECTION ─────────────────────────────────────────────────────────

def extract_json_ld(html: str) -> Optional[dict]:
    """Find JobPosting schema in HTML — no LLM needed."""
    soup = BeautifulSoup(html, "html.parser")
    scripts = soup.find_all("script", type="application/ld+json")

    for script in scripts:
        try:
            data = json.loads(script.string or "")
            items = data if isinstance(data, list) else [data]
            for item in items:
                if item.get("@type") == "JobPosting":
                    return item
                # Handle @graph arrays
                if "@graph" in item:
                    for node in item["@graph"]:
                        if isinstance(node, dict) and node.get("@type") == "JobPosting":
                            return node
        except json.JSONDecodeError:
            continue
    return None


def parse_job_from_json_ld(data: dict) -> dict:
    """Convert JSON-LD JobPosting to a normalized dict."""
    location_raw = data.get("jobLocation", {})
    if isinstance(location_raw, dict):
        address = location_raw.get("address", {})
        if isinstance(address, dict):
            location = address.get("addressLocality", "")
        else:
            location = str(address)
    elif isinstance(location_raw, list) and location_raw:
        first = location_raw[0]
        address = first.get("address", {}) if isinstance(first, dict) else {}
        location = address.get("addressLocality", "") if isinstance(address, dict) else str(address)
    else:
        location = ""

    hiring_org = data.get("hiringOrganization", {})
    company = hiring_org.get("name", "") if isinstance(hiring_org, dict) else str(hiring_org)

    description = data.get("description", "")
    if len(description) > 500:
        description = description[:500] + "..."

    return {
        "title": data.get("title", ""),
        "company": company,
        "location": location,
        "description": description,
        "employment_type": data.get("employmentType", ""),
        "date_posted": data.get("datePosted", ""),
        "source": "json_ld",
    }


# ── HTTP FETCH ────────────────────────────────────────────────────────────────

def try_http_fetch(url: str) -> tuple[bool, str]:
    """Fetch with plain requests — fast and free."""
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        r = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
        if r.status_code == 200:
            if len(r.text) > 1000 and "<html" in r.text.lower():
                return True, r.text
            return False, f"Response too short or not HTML ({len(r.text)} chars)"
        return False, f"HTTP {r.status_code}"
    except requests.exceptions.Timeout:
        return False, "Timeout after 15s"
    except requests.exceptions.ConnectionError as e:
        return False, f"Connection error: {str(e)[:100]}"
    except Exception as e:
        return False, str(e)[:200]


def detect_needs_playwright(html: str) -> bool:
    """Heuristic: does the page need JS rendering?"""
    signals = [
        "window.__reactFiber",
        "ng-version",
        "__nuxt__",
        "data-reactroot",
        "Loading...",
        "__NEXT_DATA__",
    ]
    if len(html) < 2000:
        return True
    return any(s in html for s in signals)


# ── PLAYWRIGHT FETCH ──────────────────────────────────────────────────────────

async def try_playwright_fetch(url: str) -> tuple[bool, str]:
    """Fetch with headless Chromium — used when HTTP isn't enough."""
    try:
        from playwright.async_api import async_playwright
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 720},
                locale="vi-VN",
            )
            page = await context.new_page()
            await page.add_init_script("delete Object.getPrototypeOf(navigator).webdriver")
            await page.goto(url, timeout=20000)
            await page.wait_for_load_state("networkidle", timeout=15000)
            html = await page.content()
            await context.close()
            await browser.close()
            return True, html
    except ImportError:
        return False, "Playwright not installed"
    except Exception as e:
        return False, str(e)[:200]


# ── HTML CLEANING ─────────────────────────────────────────────────────────────

def clean_html(html: str) -> str:
    """Strip noise before analysis — reduces 60-80% of content."""
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript", "svg", "iframe"]):
        tag.decompose()

    noise_classes = ["nav", "navigation", "footer", "header", "sidebar", "ad", "cookie", "banner", "popup"]
    for cls in noise_classes:
        for el in soup.find_all(class_=re.compile(cls, re.I)):
            el.decompose()

    text = soup.get_text(separator="\n", strip=True)
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    return "\n".join(lines)


# ── ORCHESTRATOR ──────────────────────────────────────────────────────────────

async def crawl_url(url: str) -> CrawlResult:
    """Run the full crawl pipeline on a single URL."""
    result = CrawlResult(url=url)
    start = time.time()

    # Step 1: HTTP fetch
    http_ok, http_data = try_http_fetch(url)

    raw_html = ""

    if http_ok:
        result.http_success = True
        raw_html = http_data

        # Check if Playwright is needed
        if detect_needs_playwright(http_data):
            result.needs_playwright = True
            pw_ok, pw_data = await try_playwright_fetch(url)
            if pw_ok:
                raw_html = pw_data
            # If Playwright fails, continue with HTTP data
    else:
        result.http_success = False
        result.needs_playwright = True

        # Try Playwright as fallback
        pw_ok, pw_data = await try_playwright_fetch(url)
        if pw_ok:
            raw_html = pw_data
        else:
            result.error = f"HTTP failed: {http_data} | Playwright failed: {pw_data}"
            result.latency_ms = int((time.time() - start) * 1000)
            return result

    result.raw_html_length = len(raw_html)

    # Step 2: JSON-LD check
    json_ld = extract_json_ld(raw_html)
    if json_ld:
        result.has_json_ld = True
        result.json_ld_data = parse_job_from_json_ld(json_ld)

    # Step 3: Clean HTML
    result.cleaned_text = clean_html(raw_html)
    result.cleaned_text_length = len(result.cleaned_text)

    result.latency_ms = int((time.time() - start) * 1000)
    return result
