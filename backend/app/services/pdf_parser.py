import fitz  # PyMuPDF
from fastapi import UploadFile

async def extract_text_from_pdf(file: UploadFile) -> str:
    """
    Reads an uploaded PDF file and extracts all text from it using PyMuPDF.
    """
    try:
        content = await file.read()
        doc = fitz.open(stream=content, filetype="pdf")
        try:
            text = ""
            for page in doc:
                text += page.get_text()
            return text
        finally:
            doc.close()
    except Exception as e:
        raise Exception(f"Failed to parse PDF: {str(e)}")
