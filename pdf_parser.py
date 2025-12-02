"""
PDF parsing utilities for Lectern.

The extractor is responsible for converting a PDF of lecture slides into a
structured representation of text and images that can be sent to the AI
generator. This module is read-only and never mutates user files.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Callable

# PyMuPDF is imported as fitz
import fitz  # type: ignore
import pytesseract  # type: ignore
from PIL import Image
import io


@dataclass
class PageContent:
    """Container describing the extracted contents of a single PDF page.

    Attributes:
        page_number: 1-based page index for user-friendly reporting.
        text: Extracted text content of the page.
        images: Raw image bytes extracted from the page in their original
            encodings (e.g., PNG/JPEG). Each entry is a binary blob suitable
            for direct upload to Anki media.
    """

    page_number: int
    text: str
    images: List[bytes]


def extract_content_from_pdf(pdf_path: str, stop_check: Optional[Callable[[], bool]] = None) -> List[PageContent]:
    """Extract text and images from a PDF.

    Parameters:
        pdf_path: Absolute or relative path to the PDF file.
        stop_check: Optional callback that returns True if processing should stop.

    Returns:
        A list of PageContent objects, one per page, preserving the original
        order of pages.

    Notes:
        - Implementation prefers fidelity and robustness. Images are extracted
          using PyMuPDF xref lookups to preserve original bytes.
        - This function performs OCR using Tesseract if extracted text is minimal.
    """

    extracted_pages: List[PageContent] = []
    with fitz.open(pdf_path) as document:
        print(f"Info: Opened PDF with {document.page_count} pages.")
        for page_index in range(document.page_count):
            if stop_check and stop_check():
                print("Info: PDF parsing stopped by user.")
                break
            page = document.load_page(page_index)

            # Extract text
            text_content: str = page.get_text("text") or ""

            # NOTE(OCR): If text is minimal (< 50 chars), assume it's a flattened image and try OCR.
            if len(text_content.strip()) < 50:
                print(f"Info: Page {page_index + 1} has minimal text. Attempting OCR...")
                try:
                    # Render page to an image (pixmap) for OCR
                    pix = page.get_pixmap()
                    img_data = pix.tobytes("png")
                    image = Image.open(io.BytesIO(img_data))
                    
                    # Perform OCR
                    ocr_text = pytesseract.image_to_string(image)
                    
                    if ocr_text.strip():
                        text_content += "\n\n[OCR Extracted Content]\n" + ocr_text
                        print(f"Info: OCR successful for Page {page_index + 1}.")
                    else:
                        print(f"Warning: OCR yielded no text for Page {page_index + 1}.")
                        
                except Exception as e:
                    print(f"Warning: OCR failed for Page {page_index + 1}: {e}")

            # Extract images
            images: List[bytes] = []
            for image_info in page.get_images(full=True):
                xref = image_info[0]
                try:
                    image_dict = document.extract_image(xref)
                except Exception:
                    # Skip images that cannot be extracted for any reason
                    continue
                
                raw_bytes = image_dict.get("image")
                if isinstance(raw_bytes, (bytes, bytearray)):
                    # NOTE(Cost): Compress images to reduce token usage and latency.
                    compressed_bytes = _compress_image(bytes(raw_bytes))
                    images.append(compressed_bytes)

            extracted_pages.append(
                PageContent(page_number=page_index + 1, text=text_content, images=images)
            )

    return extracted_pages


def _compress_image(image_bytes: bytes, max_dimension: int = 1024, quality: int = 80) -> bytes:
    """Resizes and compresses an image to reduce token usage and file size.
    
    Args:
        image_bytes: Raw image data.
        max_dimension: Maximum width or height in pixels.
        quality: JPEG quality (1-100).
        
    Returns:
        Compressed image bytes (JPEG format).
    """
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            # Convert to RGB if necessary (e.g. for JPEG saving)
            if img.mode in ('RGBA', 'P'):
                img = img.convert('RGB')
            
            # Resize if larger than max_dimension
            if max(img.size) > max_dimension:
                img.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
            
            # Compress to JPEG
            output_buffer = io.BytesIO()
            img.save(output_buffer, format='JPEG', quality=quality, optimize=True)
            return output_buffer.getvalue()
    except Exception as e:
        print(f"Warning: Image compression failed: {e}")
        return image_bytes # Fallback to original


