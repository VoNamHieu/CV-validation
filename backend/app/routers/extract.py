from fastapi import APIRouter, UploadFile, File, HTTPException
from app.services.pdf_parser import extract_text_from_pdf

router = APIRouter(prefix="/extract", tags=["Extraction"])

@router.post("/cv/pdf")
async def extract_cv_pdf(file: UploadFile = File(...)):
    """
    Endpoint to upload a CV (PDF format) and return the extracted raw text.
    Later, this raw text will be sent to the AI engine for structuring.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    try:
        text = await extract_text_from_pdf(file)
        return {"filename": file.filename, "extracted_text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/jd/pdf")
async def extract_jd_pdf(file: UploadFile = File(...)):
    """
    Endpoint to upload a JD (PDF format) and return the extracted raw text.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    try:
        text = await extract_text_from_pdf(file)
        return {"filename": file.filename, "extracted_text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
