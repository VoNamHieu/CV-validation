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


def _jsonld_jd_text(html: str) -> str:
    """Full JD text from a JobPosting JSON-LD block (title + company + full
    description, HTML stripped). Many ATS (Recruitee, Greenhouse, Lever, Workday)
    embed this even when the visible DOM is an empty SPA shell — so it's the most
    reliable JD source for those sites."""
    data = extract_json_ld(html)
    if not isinstance(data, dict):
        return ""
    parts: list[str] = []
    if data.get("title"):
        parts.append(str(data["title"]))
    org = data.get("hiringOrganization", {})
    if isinstance(org, dict) and org.get("name"):
        parts.append(str(org["name"]))
    desc = data.get("description") or ""
    if desc:
        if "<" in desc and ">" in desc:  # description is usually HTML
            desc = BeautifulSoup(desc, "html.parser").get_text(separator="\n", strip=True)
        parts.append(desc)
    return "\n".join(p for p in parts if p).strip()


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
            # requests falls back to ISO-8859-1 for text/* without an explicit
            # charset, which mojibakes UTF-8 VN pages (Thế Giới Di Động, Canon).
            # Trust the chardet-detected encoding in that case.
            if not r.encoding or r.encoding.lower() in ("iso-8859-1", "latin-1"):
                r.encoding = r.apparent_encoding or "utf-8"
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
    # Grace period — many SPAs fetch the JD JSON after first paint.
    try:
        await page.wait_for_load_state("networkidle", timeout=5000)
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

    # Match WHOLE class tokens, never bare substrings. A substring match on a
    # short token like "ad" catches Modernizr feature classes ("boxshadow",
    # "borderradius", "cssgradients") that sit on <html>, decomposing the entire
    # page → empty text. Word boundaries keep real noise (nav/footer/…) while
    # leaving content wrappers intact.
    _NOISE_RX = re.compile(
        r"\b(nav|navbar|navigation|footer|header|sidebar|advert|ads|cookie|banner|popup)\b",
        re.I,
    )
    # A class match alone must NOT remove the page's content. Two false-positive
    # sources: structural roots carrying theme classes (Astra's "ast-hfb-header"
    # on <body>), and content wrappers whose class merely CONTAINS a noise word
    # ("layout fixed-header"). Real nav/footer/sidebar/banner chrome is small, so
    # keep any structural root or any element holding most of the page's text.
    _KEEP = {"body", "html", "main", "article"}
    _total = len(soup.get_text(strip=True)) or 1
    for el in soup.find_all(class_=_NOISE_RX):
        if el.name in _KEEP:
            continue
        t = len(el.get_text(strip=True))
        if t > 400 and t > 0.4 * _total:   # large dominant block = content, not chrome
            continue
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
    raw_html = http_data if http_ok else ""
    result.http_success = http_ok
    tried_pw = False

    if (not http_ok) or detect_needs_playwright(http_data):
        result.needs_playwright = True
        pw_ok, pw_data = await try_playwright_fetch(url)
        tried_pw = True
        if pw_ok:
            raw_html = pw_data
        elif not http_ok:
            result.error = f"HTTP failed: {http_data} | Playwright failed: {pw_data}"
            result.latency_ms = int((time.time() - start) * 1000)
            return result

    cleaned = clean_html(raw_html)

    # SPA escape hatch: a big HTML shell with almost no visible text means the
    # JD is rendered client-side (Recruitee, custom React/Next career portals).
    # detect_needs_playwright misses these — render once with Playwright.
    if len(cleaned) < 400 and not tried_pw:
        result.needs_playwright = True
        pw_ok, pw_data = await try_playwright_fetch(url)
        tried_pw = True
        if pw_ok:
            raw_html = pw_data
            c2 = clean_html(raw_html)
            if len(c2) > len(cleaned):
                cleaned = c2

    # JSON-LD (for structured display fields).
    json_ld = extract_json_ld(raw_html)
    if json_ld:
        result.has_json_ld = True
        result.json_ld_data = parse_job_from_json_ld(json_ld)

    # Still thin → fall back to the embedded JobPosting JSON-LD description, which
    # ATS shells expose even when the DOM text is empty.
    if len(cleaned) < 400:
        jd_text = _jsonld_jd_text(raw_html)
        if len(jd_text) > len(cleaned):
            cleaned = jd_text

    result.raw_html_length = len(raw_html)
    result.cleaned_text = cleaned
    result.cleaned_text_length = len(cleaned)
    result.latency_ms = int((time.time() - start) * 1000)
    return result
