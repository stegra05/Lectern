"""
PDF parsing utilities for Lectern.

The extractor is responsible for converting a PDF of lecture slides into a
structured representation of text and images that can be sent to the AI
generator. This module is read-only and never mutates user files.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

# PyMuPDF is imported as fitz
import fitz  # type: ignore


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


def extract_content_from_pdf(pdf_path: str) -> List[PageContent]:
    """Extract text and images from a PDF.

    Parameters:
        pdf_path: Absolute or relative path to the PDF file.

    Returns:
        A list of PageContent objects, one per page, preserving the original
        order of pages.

    Notes:
        - Implementation prefers fidelity and robustness. Images are extracted
          using PyMuPDF xref lookups to preserve original bytes.
        - This function does not perform OCR; it relies on embedded text.
    """

    extracted_pages: List[PageContent] = []
    with fitz.open(pdf_path) as document:
        for page_index in range(document.page_count):
            page = document.load_page(page_index)

            # Extract text
            text_content: str = page.get_text("text") or ""

            # Extract images as original bytes
            images: List[bytes] = []
            for image_info in page.get_images(full=True):
                xref = image_info[0]
                try:
                    image_dict = document.extract_image(xref)
                except Exception:
                    # Skip images that cannot be extracted for any reason
                    continue
                image_bytes = image_dict.get("image")
                if isinstance(image_bytes, (bytes, bytearray)):
                    images.append(bytes(image_bytes))

            extracted_pages.append(
                PageContent(page_number=page_index + 1, text=text_content, images=images)
            )

    return extracted_pages


