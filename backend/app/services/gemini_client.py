"""
Shared OpenAI GPT-5 client.
Provides OpenAI client for smart_crawl LLM calls.
"""

import os
import logging
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ── Model ──
MODEL = "gpt-5"

# ── Singleton client ──
_raw_client = None


def _get_api_key() -> str:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set in environment")
    return api_key


def is_overloaded(e: Exception) -> bool:
    """Check if an exception indicates the model is overloaded/unavailable."""
    err = str(e).lower()
    return any(k in err for k in ["503", "unavailable", "overloaded", "resource_exhausted", "quota", "rate_limit"])


def get_raw_client():
    """Get the raw OpenAI client for generation."""
    global _raw_client
    if _raw_client is None:
        from openai import OpenAI
        _raw_client = OpenAI(api_key=_get_api_key())
    return _raw_client
