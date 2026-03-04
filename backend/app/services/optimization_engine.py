import os
import instructor
from google import genai
from app.models.schemas import CVSchema, JDSchema, MatchResultSchema
from dotenv import load_dotenv

load_dotenv()

import logging

MODELS = ["gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"]
_client = None
_logger = logging.getLogger(__name__)

def _get_client():
    global _client
    if _client is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY is not set in .env")
        _client = instructor.from_genai(
            genai.Client(api_key=api_key),
            mode=instructor.Mode.GEMINI_JSON,
        )
    return _client

def _is_overloaded(e: Exception) -> bool:
    err = str(e).lower()
    return any(k in err for k in ["503", "unavailable", "overloaded", "resource_exhausted", "quota"])

async def _call_with_fallback(response_model, messages):
    client = _get_client()
    for i, model in enumerate(MODELS):
        try:
            _logger.info(f"[optimization_engine] Trying {model}...")
            return await client.chat.completions.create(
                model=model,
                response_model=response_model,
                messages=messages,
            )
        except Exception as e:
            if i < len(MODELS) - 1 and _is_overloaded(e):
                _logger.warning(f"[optimization_engine] {model} unavailable, trying {MODELS[i+1]}: {e}")
                continue
            raise
    raise RuntimeError("All models failed")

async def optimize_cv(cv: CVSchema, jd: JDSchema, match: MatchResultSchema) -> CVSchema:
    """
    Optimizes a CV for a JD with strict guardrails against hallucination.
    """
    prompt = f"""
    You are an expert career consultant optimizing a resume.
    
    CANDIDATE CV (JSON):
    {cv.model_dump_json(indent=2)}
    
    JOB DESCRIPTION (JSON):
    {jd.model_dump_json(indent=2)}
    
    MATCH ANALYSIS:
    {match.model_dump_json(indent=2)}
    
    INSTRUCTIONS - STRICT GUARDRAILS:
    1. Only use information explicitly found in the original CV.
    2. DO NOT add new companies, new tools, new measurable results, or new skills not present in the original CV.
    3. Rephrase the summary to better align with the JD keywords.
    4. Reorder bullet points in the experience descriptions to put the most relevant achievements first.
    5. Improve wording with action verbs. emphasize transferable skills if direct experience is lacking.
    6. Maintain the exact original structure, job titles, and duration.
    
    Return the fully optimized CV following the CVSchema.
    """
    
    result = await _call_with_fallback(
        response_model=CVSchema,
        messages=[
            {"role": "system", "content": "You are a CV optimizer that strictly follows anti-hallucination rules."},
            {"role": "user", "content": prompt}
        ],
    )
    return result
