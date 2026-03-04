import os
import instructor
from google import genai
from app.models.schemas import CVSchema, JDSchema, MatchResultSchema
from dotenv import load_dotenv

load_dotenv()

PRIMARY_MODEL = "gemini-3.0-pro"
FALLBACK_MODEL = "gemini-2.5-pro"
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
                f"[match_engine] {PRIMARY_MODEL} unavailable, falling back to {FALLBACK_MODEL}: {e}"
            )
            return await client.chat.completions.create(
                model=FALLBACK_MODEL,
                response_model=response_model,
                messages=messages,
            )
        raise

async def calculate_job_fit(cv: CVSchema, jd: JDSchema) -> MatchResultSchema:
    """
    Evaluates candidate's structured CV against the structured JD criteria
    and produces a weighted MatchResult object.
    """
    prompt = f"""
    You are an expert technical recruiter and objective ATS scoring algorithm.
    Evaluate the candidate's CV against the Job Description.

    CRITERIA & WEIGHTS:
    1. Must-have skills (40%): Are the exact required tools/skills present?
    2. Experience depth (25%): Do they have the required years of experience and impact?
    3. Domain alignment (15%): Have they worked in the same industry/domain?
    4. Seniority fit (10%): Does their past trajectory match the target seniority level?
    5. Nice-to-have skills (10%): Have they touched the bonus tools/technologies?

    CANDIDATE CV (JSON):
    {cv.model_dump_json(indent=2)}

    JOB DESCRIPTION (JSON):
    {jd.model_dump_json(indent=2)}

    Determine a score from 0-100 for each dimension, explain the reasoning briefly, 
    list the gaps, and calculate the weighted overall score. Be rigorous and identify any risk flags.
    """
    
    result = await _call_with_fallback(
        response_model=MatchResultSchema,
        messages=[
            {"role": "system", "content": "You are a precise, objective scoring algorithm."},
            {"role": "user", "content": prompt}
        ],
    )
    return result
