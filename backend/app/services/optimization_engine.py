import os
import instructor
from google import genai
from app.models.schemas import CVSchema, JDSchema, MatchResultSchema
from dotenv import load_dotenv

load_dotenv()

PRIMARY_MODEL = "gemini-3.0-pro"
FALLBACK_MODEL = "gemini-2.5-pro-preview-03-25"
_client = None

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

async def _call_with_fallback(response_model, messages):
    """Call PRIMARY_MODEL, fall back to FALLBACK_MODEL on 503/overload."""
    client = _get_client()
    try:
        return await client.chat.completions.create(
            model=PRIMARY_MODEL,
            response_model=response_model,
            messages=messages,
        )
    except Exception as e:
        err = str(e).lower()
        if any(k in err for k in ["503", "unavailable", "overloaded", "resource_exhausted", "quota"]):
            import logging
            logging.getLogger(__name__).warning(
                f"[optimization_engine] {PRIMARY_MODEL} unavailable, falling back to {FALLBACK_MODEL}: {e}"
            )
            return await client.chat.completions.create(
                model=FALLBACK_MODEL,
                response_model=response_model,
                messages=messages,
            )
        raise

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
