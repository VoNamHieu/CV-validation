"""HTML → PDF rendering via Playwright Chromium.

Used by the frontend to convert an optimized CV's HTML (generated client-side)
into a PDF that the browser extension can upload into job application forms.

Uses the shared browser pool (no per-request Chromium spawn) and waits for
web fonts to finish loading so Vietnamese diacritics render with the
intended typeface, not a fallback.
"""
import asyncio
import base64
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/render", tags=["Render"])

# The whole process shares ONE Chromium (see browser_pool). Callers fan out —
# the per-job eager PDF cache fires from a 3-wide worker pool and overlaps with
# concurrent Playwright crawls on the same browser. Left uncapped that load
# OOMs/crashes Chromium and returns intermittent 500s. Serialize renders to a
# safe ceiling so the browser is never asked to hold too many pages at once.
_RENDER_SEMAPHORE = asyncio.Semaphore(2)


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
        async with _RENDER_SEMAPHORE:
            browser = await get_browser()
            # A4 at 96 DPI — keeps any responsive CSS pinned to print width.
            context = await browser.new_context(viewport={"width": 794, "height": 1123})
            page = await context.new_page()
            await page.set_content(req.html, wait_until="domcontentloaded")

            # Web fonts (Google Fonts etc.) load async — without this the PDF can
            # snapshot before the typeface is ready and Vietnamese diacritics fall
            # back to a system font with worse rendering. Cap the wait: under
            # bandwidth contention a hung font request must not eat the caller's
            # whole timeout budget — render with the fallback font instead.
            try:
                await page.evaluate(
                    "async () => { if (document.fonts && document.fonts.ready) { "
                    "await Promise.race([document.fonts.ready, "
                    "new Promise(r => setTimeout(r, 3000))]); } }"
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
