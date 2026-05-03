"""
PDF rendering via Playwright Chromium.
Used by the frontend to convert CV HTML into a text-selectable, ATS-friendly PDF.
"""

import logging
import re
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/render", tags=["Render"])

# Hard cap on incoming HTML size (text-only CV documents are tiny; this is a guard).
MAX_HTML_BYTES = 800_000


class RenderPdfRequest(BaseModel):
    html: str = Field(..., description="A complete HTML document to render to PDF.")
    filename: str | None = Field(None, description="Suggested filename (no extension).")


def _safe_filename(name: str | None) -> str:
    if not name:
        return "cv"
    # Strip path separators, control chars, and quotes — keep simple ascii-ish names.
    cleaned = re.sub(r"[^A-Za-z0-9_\- ]", "", name).strip().replace(" ", "_")
    return cleaned[:80] or "cv"


@router.post("/pdf")
async def render_pdf(req: RenderPdfRequest):
    """Render the provided HTML to a text-selectable PDF using headless Chromium."""
    if not req.html.strip():
        raise HTTPException(400, "html is required")
    if len(req.html.encode("utf-8")) > MAX_HTML_BYTES:
        raise HTTPException(413, f"HTML exceeds {MAX_HTML_BYTES} bytes")

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise HTTPException(500, "Playwright is not installed on the backend")

    pdf_bytes: bytes
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(args=["--no-sandbox"])
            try:
                page = await browser.new_page()
                await page.set_content(req.html, wait_until="domcontentloaded", timeout=15000)
                # Best-effort wait for fonts so glyphs aren't swapped mid-render.
                try:
                    await page.evaluate("document.fonts && document.fonts.ready")
                except Exception:
                    pass
                pdf_bytes = await page.pdf(
                    format="A4",
                    print_background=True,
                    margin={"top": "15mm", "right": "15mm", "bottom": "15mm", "left": "15mm"},
                    prefer_css_page_size=True,
                )
            finally:
                await browser.close()
    except Exception as e:
        logger.exception("[render_pdf] failed: %s", e)
        raise HTTPException(500, f"Failed to render PDF: {e}")

    filename = _safe_filename(req.filename)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}.pdf"'},
    )
