from fastapi import APIRouter, HTTPException, Body
from app.services.ai_extractor import extract_cv_structured, extract_jd_structured
from app.services.match_engine import calculate_job_fit
from app.services.optimization_engine import optimize_cv
from app.models.schemas import CVSchema, JDSchema, MatchResultSchema

router = APIRouter(prefix="/ai", tags=["AI Engine"])

@router.post("/extract-cv", response_model=CVSchema)
async def api_extract_cv(raw_text: str = Body(..., embed=True)):
    try:
        return await extract_cv_structured(raw_text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/extract-jd", response_model=JDSchema)
async def api_extract_jd(raw_text: str = Body(..., embed=True)):
    try:
        return await extract_jd_structured(raw_text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/score", response_model=MatchResultSchema)
async def api_score_fit(cv: CVSchema, jd: JDSchema):
    try:
        return await calculate_job_fit(cv, jd)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/optimize", response_model=CVSchema)
async def api_optimize_cv(cv: CVSchema, jd: JDSchema, match: MatchResultSchema):
    try:
        return await optimize_cv(cv, jd, match)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
