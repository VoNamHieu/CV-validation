"""
Shared Gemini client.
Main model: gemini-3.1-pro-preview (high quality)
Fallback model: gemini-3-flash-preview (used when main is overloaded/unavailable)
"""

import json
import logging
import os
import re
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ── Models ──
MAIN_MODEL = "gemini-3.1-pro-preview"
FALLBACK_MODEL = "gemini-3-flash-preview"
MODEL = MAIN_MODEL  # Primary model name (kept for callers that log it)

# ── Singleton client ──
_raw_client = None


def _get_api_key() -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set in environment")
    return api_key


def is_overloaded(e: Exception) -> bool:
    """Check if an exception indicates the model is overloaded/unavailable."""
    err = str(e).lower()
    return any(k in err for k in ["503", "unavailable", "overloaded", "resource_exhausted", "quota", "rate_limit"])


def get_raw_client():
    """Get the raw google-genai client."""
    global _raw_client
    if _raw_client is None:
        from google import genai
        _raw_client = genai.Client(api_key=_get_api_key())
    return _raw_client


def generate_json(system_prompt: str, user_prompt: str) -> str:
    """
    Generate a JSON-mode response using Gemini.
    Tries MAIN_MODEL first; on overload errors falls back to FALLBACK_MODEL.
    Returns the raw text content (expected to be JSON).
    """
    client = get_raw_client()
    config = {
        "response_mime_type": "application/json",
    }
    if system_prompt:
        config["system_instruction"] = system_prompt

    last_err: Exception | None = None
    for model in (MAIN_MODEL, FALLBACK_MODEL):
        try:
            logger.info(f"[gemini] Calling {model}...")
            response = client.models.generate_content(
                model=model,
                contents=user_prompt,
                config=config,
            )
            return response.text or ""
        except Exception as e:
            last_err = e
            if is_overloaded(e):
                logger.warning(f"[gemini] {model} overloaded, trying next model...")
                continue
            raise
    raise last_err if last_err else Exception("All Gemini models failed")


# ── Grounded search ─────────────────────────────────────────────────────────────

def _extract_json_object(text: str) -> Optional[dict]:
    """Pull the first `{...}` block out of a free-text response (Gemini wraps
    JSON in ```json fences when google_search tool is active — JSON mode can't
    be combined with tools)."""
    if not text:
        return None
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*\n?", "", t)
        t = re.sub(r"\n?```\s*$", "", t)
    m = re.search(r"\{[\s\S]*\}", t)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def _collect_grounding_uris(response) -> list[str]:
    """Best-effort extraction of source URIs from the response's grounding
    metadata. Schema varies slightly across SDK versions, so guard everything."""
    uris: list[str] = []
    try:
        candidates = getattr(response, "candidates", None) or []
        if not candidates:
            return uris
        gm = getattr(candidates[0], "grounding_metadata", None)
        if not gm:
            return uris
        chunks = getattr(gm, "grounding_chunks", None) or []
        for c in chunks:
            web = getattr(c, "web", None)
            if web:
                uri = getattr(web, "uri", "") or ""
                if uri:
                    uris.append(uri)
    except Exception:
        pass
    return uris


def search_company_website(name: str) -> dict:
    """Use Gemini grounded search (google_search tool) to find a company's
    official homepage URL.

    Returns a dict:
        {
            "url": str,            # apex URL, "" if not found
            "confidence": str,     # "high" | "medium" | "low" | "none"
            "sources": list[str],  # grounding source URIs (debug aid)
            "notes": str,          # error/diagnostic info
            "raw": str,            # raw model output (debug aid)
        }

    Tries FALLBACK_MODEL (flash) first — this task is simple enough not to need
    the pro model, and flash is faster + cheaper.
    """
    if not name or not name.strip():
        return {"url": "", "confidence": "none", "sources": [], "notes": "empty name", "raw": ""}

    from google import genai  # noqa: F401  (ensures SDK loaded)
    from google.genai import types

    client = get_raw_client()
    prompt = f"""Find the OFFICIAL homepage URL of the company named "{name}".

Return a JSON object with this EXACT shape (no markdown, no extra text outside the JSON):
{{"url": "<homepage URL or empty string>", "confidence": "high" | "medium" | "low"}}

Rules:
- url MUST be the company's own root domain (e.g. https://acme.com).
- NEVER return a URL on LinkedIn, Facebook, Twitter/X, Instagram, Crunchbase, Bloomberg, news sites, or any job board (TopCV, VietnamWorks, ITviec, CareerBuilder).
- Prefer the apex / root URL (https://acme.com) over deep pages (/about, /careers, /products...).
- If you cannot confidently identify the company's own website, return {{"url": "", "confidence": "low"}}.
"""

    last_err: Exception | None = None
    for model in (FALLBACK_MODEL, MAIN_MODEL):
        try:
            logger.info(f"[gemini_search] {model} ← {name!r}")
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                ),
            )
            raw_text = (response.text or "").strip()
            sources = _collect_grounding_uris(response)
            data = _extract_json_object(raw_text)
            if not isinstance(data, dict):
                return {
                    "url": "",
                    "confidence": "none",
                    "sources": sources,
                    "notes": f"could not parse JSON from response",
                    "raw": raw_text[:500],
                }

            url = (data.get("url") or "").strip()
            conf = (data.get("confidence") or "low").lower()
            if conf not in {"high", "medium", "low", "none"}:
                conf = "low"
            return {
                "url": url,
                "confidence": conf,
                "sources": sources,
                "notes": "",
                "raw": raw_text[:500],
            }
        except Exception as e:
            last_err = e
            if is_overloaded(e):
                logger.warning(f"[gemini_search] {model} overloaded, trying next model")
                continue
            logger.warning(f"[gemini_search] {model} failed: {e}")
            return {
                "url": "",
                "confidence": "none",
                "sources": [],
                "notes": str(e)[:200],
                "raw": "",
            }
    return {
        "url": "",
        "confidence": "none",
        "sources": [],
        "notes": str(last_err)[:200] if last_err else "all models failed",
        "raw": "",
    }


def _extract_json_array(text: str) -> Optional[list]:
    """Pull the first `[...]` block out of a free-text response (same fencing
    issue as _extract_json_object, but for a JSON array)."""
    if not text:
        return None
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*\n?", "", t)
        t = re.sub(r"\n?```\s*$", "", t)
    m = re.search(r"\[[\s\S]*\]", t)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def discover_companies_for_role(role: str, location: str = "", limit: int = 8) -> list[dict]:
    """Grounded search for companies currently hiring for a role.

    Returns a list of {"name": str, "url": homepage} (empty on failure). The
    caller is expected to validate URLs and run the career-page pipeline on each.
    """
    if not role or not role.strip():
        return []

    from google.genai import types

    client = get_raw_client()
    loc = f" in {location}" if location and location.strip() else ""
    prompt = f"""Find up to {limit} real companies that are currently hiring for "{role}" roles{loc}.
Use web search.

Return ONLY a JSON array (no markdown, no text outside the JSON) of objects with this EXACT shape:
[{{"name": "<company name>", "url": "<company official homepage root URL>"}}]

Rules:
- url MUST be the company's OWN root domain (e.g. https://acme.com), NOT a job board, LinkedIn, Facebook, news site, or aggregator (TopCV, VietnamWorks, ITviec, CareerBuilder, Indeed, Glassdoor).
- Only include real, currently-operating companies whose homepage you can identify.
- Prefer companies likely to have their own careers page.
- Return at most {limit} entries; if unsure, return fewer rather than guessing."""

    last_err: Exception | None = None
    for model in (FALLBACK_MODEL, MAIN_MODEL):
        try:
            logger.info(f"[gemini_discover] {model} ← role={role!r} loc={location!r} limit={limit}")
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                ),
            )
            raw_text = (response.text or "").strip()
            arr = _extract_json_array(raw_text)
            if not isinstance(arr, list):
                logger.warning(f"[gemini_discover] {model} returned no array: {raw_text[:200]!r}")
                return []
            out: list[dict] = []
            for item in arr:
                if not isinstance(item, dict):
                    continue
                name = (item.get("name") or "").strip()
                url = (item.get("url") or "").strip()
                if url:
                    out.append({"name": name, "url": url})
            logger.info(f"[gemini_discover] {model} → {len(out)} companies")
            return out[:limit]
        except Exception as e:
            last_err = e
            if is_overloaded(e):
                logger.warning(f"[gemini_discover] {model} overloaded, trying next model")
                continue
            logger.warning(f"[gemini_discover] {model} failed: {e}")
            return []
    logger.warning(f"[gemini_discover] all models failed: {last_err}")
    return []


def discover_jobs_for_role(role: str, location: str = "", limit: int = 8) -> list[dict]:
    """Grounded search for CURRENT job openings for a role (job-first).

    Returns a list of {"title", "company", "url"} — actual postings. The caller
    derives the hiring company from each, resolves its OFFICIAL career page, and
    scores the opening there (the posting URL itself may be an aggregator and is
    used only as a discovery signal, never surfaced to the user).
    """
    if not role or not role.strip():
        return []

    from google.genai import types

    client = get_raw_client()
    # This product targets the Vietnam job market — always anchor the search to
    # Vietnam (a specific city when given) so grounded search doesn't return
    # roles abroad.
    country = os.getenv("DISCOVER_COUNTRY", "Vietnam")
    loc = f" in {location}, {country}" if location and location.strip() else f" in {country}"
    want = max(limit * 2, limit)
    prompt = f"""Find up to {want} CURRENT, real job openings for "{role}"{loc}. Use web search.

Return ONLY a JSON array (no markdown, no text outside the JSON) of objects with this EXACT shape:
[{{"title": "<the posted job title>", "company": "<the hiring company's real name>", "url": "<the job posting URL>"}}]

Rules:
- LOCATION IS MANDATORY: only include roles based IN {country}. The hiring company must be a {country} company or have a {country} office/branch where this role works. Exclude any opening located outside {country}.
- Every entry MUST include the hiring company's real name (not a job board's name).
- Prefer openings posted recently and genuinely matching the role.
- Do NOT invent companies or titles; only include postings you actually find.
- Return at most {want} entries."""

    last_err: Exception | None = None
    for model in (FALLBACK_MODEL, MAIN_MODEL):
        try:
            logger.info(f"[gemini_jobsearch] {model} ← role={role!r} loc={location!r} want={want}")
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                ),
            )
            raw_text = (response.text or "").strip()
            arr = _extract_json_array(raw_text)
            if not isinstance(arr, list):
                logger.warning(f"[gemini_jobsearch] {model} returned no array: {raw_text[:200]!r}")
                return []
            out: list[dict] = []
            for item in arr:
                if not isinstance(item, dict):
                    continue
                title = (item.get("title") or "").strip()
                company = (item.get("company") or "").strip()
                url = (item.get("url") or "").strip()
                if title and company:
                    out.append({"title": title, "company": company, "url": url})
            logger.info(f"[gemini_jobsearch] {model} → {len(out)} postings")
            return out
        except Exception as e:
            last_err = e
            if is_overloaded(e):
                logger.warning(f"[gemini_jobsearch] {model} overloaded, trying next model")
                continue
            logger.warning(f"[gemini_jobsearch] {model} failed: {e}")
            return []
    logger.warning(f"[gemini_jobsearch] all models failed: {last_err}")
    return []
