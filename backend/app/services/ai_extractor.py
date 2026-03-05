from app.models.schemas import CVSchema, JDSchema
from app.services.gemini_client import call_with_fallback

# ── Max input length to prevent prompt injection / cost abuse (H4) ──
MAX_RAW_TEXT_LENGTH = 50_000


async def extract_cv_structured(raw_text: str) -> CVSchema:
    """Given raw text from a CV PDF, use LLM to map it into a structured CVSchema."""
    if len(raw_text) > MAX_RAW_TEXT_LENGTH:
        raw_text = raw_text[:MAX_RAW_TEXT_LENGTH]

    prompt = f"""
    You are an expert HR parser.
    Extract the following information from the provided CV text.
    If some information is missing, leave the strings empty or the lists empty.
    
    CV TEXT:
    {raw_text}
    """
    return await call_with_fallback(
        response_model=CVSchema,
        messages=[
            {"role": "system", "content": "You are an intelligent CV parser. Extract accurate and structured data."},
            {"role": "user", "content": prompt},
        ],
    )


async def extract_jd_structured(raw_text: str) -> JDSchema:
    """Given raw text from a Job Description, use LLM to map it into a structured JDSchema."""
    if len(raw_text) > MAX_RAW_TEXT_LENGTH:
        raw_text = raw_text[:MAX_RAW_TEXT_LENGTH]

    prompt = f"""
    You are an expert HR recruiter.
    Extract the key requirements, nice-to-haves, responsibilities, seniority, and domain from the JD text.
    
    JD TEXT:
    {raw_text}
    """
    return await call_with_fallback(
        response_model=JDSchema,
        messages=[
            {"role": "system", "content": "You are an intelligent Job Description parser. Extract strict and accurate requirements."},
            {"role": "user", "content": prompt},
        ],
    )
