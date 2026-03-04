import os
import instructor
from google import genai
from app.models.schemas import CVSchema, JDSchema
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
                f"[ai_extractor] {PRIMARY_MODEL} unavailable, falling back to {FALLBACK_MODEL}: {e}"
            )
            return await client.chat.completions.create(
                model=FALLBACK_MODEL,
                response_model=response_model,
                messages=messages,
            )
        raise

async def extract_cv_structured(raw_text: str) -> CVSchema:
    """
    Given raw text extracted from a CV PDF, use an LLM to map it into a structured CVSchema.
    """
    prompt = f"""
    You are an expert HR parser.
    Extract the following information from the provided CV text.
    If some information is missing, leave the strings empty or the lists empty.
    
    CV TEXT:
    {raw_text}
    """
    
    cv_data = await _call_with_fallback(
        response_model=CVSchema,
        messages=[
            {"role": "system", "content": "You are an intelligent CV parser. Extract accurate and structured data."},
            {"role": "user", "content": prompt},
        ],
    )
    return cv_data

async def extract_jd_structured(raw_text: str) -> JDSchema:
    """
    Given raw text from a Job Description, use an LLM to map it into a structured JDSchema.
    """
    prompt = f"""
    You are an expert HR recruiter.
    Extract the key requirements, nice-to-haves, responsibilities, seniority, and domain from the JD text.
    
    JD TEXT:
    {raw_text}
    """
    
    jd_data = await _call_with_fallback(
        response_model=JDSchema,
        messages=[
            {"role": "system", "content": "You are an intelligent Job Description parser. Extract strict and accurate requirements."},
            {"role": "user", "content": prompt},
        ],
    )
    return jd_data
