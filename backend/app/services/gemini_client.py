"""
Shared Gemini AI client with model fallback chain.
Single source of truth — eliminates duplication across ai_extractor,
match_engine, optimization_engine, and smart_crawl.
"""

import os
import logging
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ── Model chains ──
MODELS_PRO = ["gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"]
MODELS_FLASH = ["gemini-3-flash-preview", "gemini-2.5-pro"]

# ── Singleton clients ──
_instructor_client = None
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


def get_instructor_client():
    """Get the instructor-wrapped Gemini client for structured output."""
    global _instructor_client
    if _instructor_client is None:
        import instructor
        from google import genai
        _instructor_client = instructor.from_genai(
            genai.Client(api_key=_get_api_key()),
            mode=instructor.Mode.GEMINI_JSON,
        )
    return _instructor_client


def get_raw_client():
    """Get the raw Gemini client for free-form generation."""
    global _raw_client
    if _raw_client is None:
        from google import genai
        _raw_client = genai.Client(api_key=_get_api_key())
    return _raw_client


async def call_with_fallback(response_model, messages, models=None):
    """Try each model in chain with instructor client, falling back on 503/overload."""
    if models is None:
        models = MODELS_PRO
    client = get_instructor_client()
    for i, model in enumerate(models):
        try:
            logger.info(f"[gemini] Trying {model}...")
            return await client.chat.completions.create(
                model=model,
                response_model=response_model,
                messages=messages,
            )
        except Exception as e:
            if i < len(models) - 1 and is_overloaded(e):
                logger.warning(f"[gemini] {model} unavailable, trying {models[i+1]}: {e}")
                continue
            raise
    raise RuntimeError("All models failed")
