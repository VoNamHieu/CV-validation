"""
Job Crawler Service
Handles HTTP fetching, JSON-LD extraction, Playwright fallback, and HTML cleaning.
"""

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field, asdict
from typing import Optional

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


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
                if not isinstance(item, dict):
                    continue
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

# Content signals we wait for — whichever appears first tells us the page is
# ready (vs. blindly sleeping a fixed number of seconds).
_CONTENT_SELECTORS = (
    "script[type='application/ld+json'], "
    "h1, [itemprop='title'], [data-testid*='title' i], "
    "[class*='job-title' i], [class*='JobTitle' i], "
    "main, article, [role='main']"
)

# Block these resource types on crawls — we only want text/HTML/JS.
# Cuts bandwidth + render time 50–80 %.
_BLOCKED_RESOURCE_TYPES = {"image", "media", "font", "stylesheet"}


def _is_transient_error(msg: str) -> bool:
    """Decide whether a Playwright failure is worth retrying once."""
    m = msg.lower()
    return any(s in m for s in (
        "timeout", "net::err_", "navigation failed",
        "connection closed", "target closed", "browser has been closed",
    ))


async def _wait_for_content(page, timeout_ms: int = 8000) -> None:
    """Wait until the page exposes real content — a job-shaped selector
    appears OR body text crosses 1500 chars. Falls back to a short
    networkidle if neither fires."""
    selector_task = asyncio.create_task(
        page.wait_for_selector(_CONTENT_SELECTORS, state="attached", timeout=timeout_ms)
    )
    text_task = asyncio.create_task(
        page.wait_for_function(
            "() => document.body && document.body.innerText.length > 1500",
            timeout=timeout_ms,
        )
    )
    try:
        _done, pending = await asyncio.wait(
            [selector_task, text_task],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for t in pending:
            t.cancel()
            try:
                await t
            except BaseException:
                pass
    except Exception:
        pass
    # Final small grace period — some SPAs fetch JSON after content is visible.
    try:
        await page.wait_for_load_state("networkidle", timeout=2500)
    except Exception:
        pass


async def _block_noise(route, request) -> None:
    if request.resource_type in _BLOCKED_RESOURCE_TYPES:
        await route.abort()
    else:
        await route.continue_()


async def try_playwright_fetch(url: str) -> tuple[bool, str]:
    """Fetch with headless Chromium — used when HTTP isn't enough.

    Uses the shared browser pool (no per-request Chromium spawn), blocks
    images/fonts/CSS/media, and waits on real content selectors instead of
    a fixed sleep. Retries once on transient errors.
    """
    try:
        from app.services.browser_pool import get_browser
    except ImportError:
        return False, "Playwright not installed"

    last_err = ""
    for attempt in range(2):
        context = None
        try:
            browser = await get_browser()
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 720},
                locale="vi-VN",
                extra_http_headers={
                    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
                },
            )
            await context.route("**/*", _block_noise)

            page = await context.new_page()
            # Shallow stealth: hide the most-checked automation flag.
            await page.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
            )

            await page.goto(url, timeout=30000, wait_until="domcontentloaded")
            await _wait_for_content(page, timeout_ms=8000)
            html = await page.content()
            return True, html
        except Exception as e:
            last_err = str(e)[:200]
            if attempt == 0 and _is_transient_error(last_err):
                logger.warning(f"[playwright_fetch] transient error on {url}: {last_err} — retrying")
                await asyncio.sleep(1)
                continue
            return False, last_err
        finally:
            if context is not None:
                try:
                    await context.close()
                except Exception:
                    pass
    return False, last_err or "Unknown Playwright failure"


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
