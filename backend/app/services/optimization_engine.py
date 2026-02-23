import os
import instructor
from google import genai
from app.models.schemas import CVSchema, JDSchema, MatchResultSchema
from dotenv import load_dotenv

load_dotenv()

client = instructor.from_gemini(
    genai.Client(api_key=os.getenv("GEMINI_API_KEY")),
    mode=instructor.Mode.GEMINI_JSON,
)
MODEL = "gemini-3.0-pro"

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
    
    result = await client.chat.completions.create(
        model=MODEL,
        response_model=CVSchema,
        messages=[
            {"role": "system", "content": "You are a CV optimizer that strictly follows anti-hallucination rules."},
            {"role": "user", "content": prompt}
        ],
    )
    
    return result
