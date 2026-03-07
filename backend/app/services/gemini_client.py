"""
Shared Gemini AI client.
Provides raw Gemini client for smart_crawl LLM calls.
"""

import os
import logging
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ── Model chains ──
MODELS_FLASH = ["gemini-3-flash-preview", "gemini-2.5-pro"]

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
    return any(k in err for k in ["503", "unavailable", "overloaded", "resource_exhausted", "quota"])


def get_raw_client():
    """Get the raw Gemini client for free-form generation."""
    global _raw_client
    if _raw_client is None:
        from google import genai
        _raw_client = genai.Client(api_key=_get_api_key())
    return _raw_client
