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
    
    result = await client.chat.completions.create(
        model=MODEL,
        response_model=MatchResultSchema,
        messages=[
            {"role": "system", "content": "You are a precise, objective scoring algorithm."},
            {"role": "user", "content": prompt}
        ],
    )
    
    return result
