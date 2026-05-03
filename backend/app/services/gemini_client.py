"""
Shared Gemini client.
Main model: gemini-3.1-pro-preview (high quality)
Fallback model: gemini-3-flash-preview (used when main is overloaded/unavailable)
"""

import os
import logging
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
