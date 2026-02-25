import os
import instructor
from google import genai
from app.models.schemas import CVSchema, JDSchema
from dotenv import load_dotenv

load_dotenv()

# Lazy-init: only create client when actually needed
MODEL = "gemini-3.0-pro"
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
    
    cv_data = await _get_client().chat.completions.create(
        model=MODEL,
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
    
    jd_data = await _get_client().chat.completions.create(
        model=MODEL,
        response_model=JDSchema,
        messages=[
            {"role": "system", "content": "You are an intelligent Job Description parser. Extract strict and accurate requirements."},
            {"role": "user", "content": prompt},
        ],
    )
    return jd_data
