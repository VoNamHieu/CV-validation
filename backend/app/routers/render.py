"""HTML → PDF rendering via Playwright Chromium.

Used by the frontend to convert an optimized CV's HTML (generated client-side)
into a PDF that the browser extension can upload into job application forms.

Uses the shared browser pool (no per-request Chromium spawn) and waits for
web fonts to finish loading so Vietnamese diacritics render with the
intended typeface, not a fallback.
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
        from app.services.browser_pool import get_browser
    except ImportError:
        raise HTTPException(500, "Playwright not installed on the server")

    safe_name = (req.filename or "CV.pdf").strip()
    if not safe_name.lower().endswith(".pdf"):
        safe_name = f"{safe_name}.pdf"

    context = None
    try:
        browser = await get_browser()
        # A4 at 96 DPI — keeps any responsive CSS pinned to print width.
        context = await browser.new_context(viewport={"width": 794, "height": 1123})
        page = await context.new_page()
        await page.set_content(req.html, wait_until="domcontentloaded")

        # Web fonts (Google Fonts etc.) load async — without this the PDF can
        # snapshot before the typeface is ready and Vietnamese diacritics fall
        # back to a system font with worse rendering.
        try:
            await page.evaluate(
                "async () => { if (document.fonts && document.fonts.ready) "
                "{ await document.fonts.ready; } }"
            )
        except Exception:
            pass

        pdf_bytes = await page.pdf(
            format="A4",
            margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
            print_background=True,
            prefer_css_page_size=True,
        )
    except Exception as e:
        raise HTTPException(500, f"PDF render failed: {str(e)[:200]}")
    finally:
        if context is not None:
            try:
                await context.close()
            except Exception:
                pass

    return CvPdfResponse(
        base64=base64.b64encode(pdf_bytes).decode("ascii"),
        filename=safe_name,
        sizeBytes=len(pdf_bytes),
    )
