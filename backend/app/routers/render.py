"""HTML → PDF rendering via Playwright Chromium.

Used by the frontend to convert an optimized CV's HTML (generated client-side)
into a PDF that the browser extension can upload into job application forms.
"""
import base64
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/render", tags=["Render"])


class CvPdfRequest(BaseModel):
    html: str = Field(..., min_length=10, max_length=500_000)
    filename: str | None = None


class CvPdfResponse(BaseModel):
    base64: str
    filename: str
    sizeBytes: int


@router.post("/cv-pdf", response_model=CvPdfResponse)
async def render_cv_pdf(req: CvPdfRequest):
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise HTTPException(500, "Playwright not installed on the server")

    safe_name = (req.filename or "CV.pdf").strip()
    if not safe_name.lower().endswith(".pdf"):
        safe_name = f"{safe_name}.pdf"

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context()
            page = await context.new_page()
            # Use a data URL so we don't hit network at all
            await page.set_content(req.html, wait_until="domcontentloaded")
            pdf_bytes = await page.pdf(
                format="A4",
                margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
                print_background=True,
            )
            await context.close()
            await browser.close()
    except Exception as e:
        raise HTTPException(500, f"PDF render failed: {str(e)[:200]}")

    return CvPdfResponse(
        base64=base64.b64encode(pdf_bytes).decode("ascii"),
        filename=safe_name,
        sizeBytes=len(pdf_bytes),
    )
