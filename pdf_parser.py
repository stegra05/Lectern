"""
PDF parsing utilities for Lectern.

Uses pypdf + pypdfium2 for pure-Python PDF processing.
This module is read-only and never mutates user files.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Callable
import io
import os

from PIL import Image
import pypdfium2 as pdfium

# Lightweight PDF libraries (no external dependencies)
from pypdf import PdfReader


@dataclass
class PageContent:
    """Container describing the extracted contents of a single PDF page.

    Attributes:
        page_number: 1-based page index for user-friendly reporting.
        text: Extracted text content of the page.
        images: Raw image bytes extracted from the page.
        image_count: Number of images detected on the page (for token estimation).
    """

    page_number: int
    text: str
    images: List[bytes]
    image_count: int = 0


def extract_content_from_pdf(
    pdf_path: str,
    stop_check: Optional[Callable[[], bool]] = None,
    skip_ocr: bool = False,
    skip_images: bool = False,
) -> List[PageContent]:
    """Extract text and images from a PDF.

    Parameters:
        pdf_path: Absolute or relative path to the PDF file.
        stop_check: Optional callback that returns True if processing should stop.
        skip_ocr: Deprecated compatibility flag. Local OCR has been removed.
        skip_images: If True, skips image extraction/compression but still counts embedded images.

    Returns:
       A list of PageContent objects, one per page.
    """

    extracted_pages: List[PageContent] = []

    # Debug: Check file info
    try:
        file_size = os.path.getsize(pdf_path)
        print(f"Info: Parsing PDF at {pdf_path}. Size: {file_size} bytes.")
    except Exception as e:
        print(f"Warning: Could not check file size: {e}")

    # Open PDF with pypdf for text extraction
    reader = PdfReader(pdf_path)
    total_pages = len(reader.pages)
    print(f"Info: Opened PDF with {total_pages} pages.")

    def render_page_image(page_number: int, dpi: int = 150) -> Optional[Image.Image]:
        try:
            pdf_doc = pdfium.PdfDocument(pdf_path)
            page = pdf_doc[page_number - 1]  # pypdfium2 uses 0-indexed pages
            scale = dpi / 72  # PDFium uses 72 DPI as base
            bitmap = page.render(scale=scale)
            return bitmap.to_pil()
        except Exception as e:
            print(f"Warning: Could not render page {page_number} as image: {e}")
        return None

    for page_index, page in enumerate(reader.pages):
        if stop_check and stop_check():
            print("Info: PDF parsing stopped by user.")
            break

        # Extract text using pypdf
        text_content: str = page.extract_text() or ""

        page_img: Optional[Image.Image] = None

        # Extract images
        images: List[bytes] = []
        embedded_count = 0
        
        # Method 1: Check embedded images
        if hasattr(page, "images"):
            try:
                # Just get the count first
                embedded_imgs = page.images
                embedded_count = len(embedded_imgs)
                
                if not skip_images:
                    for img in embedded_imgs:
                        try:
                            raw_bytes = img.data
                            if isinstance(raw_bytes, (bytes, bytearray)):
                                compressed_bytes = _compress_image(bytes(raw_bytes))
                                images.append(compressed_bytes)
                        except Exception:
                            continue
            except Exception:
                pass

        # Method 2: If no embedded images found, use rendered page image
        # This catches diagrams, charts, etc. that are drawn, not embedded
        if not images and embedded_count == 0:
            # If skipping images, we can't easily detect if a page *needs* a screenshot 
            # without rendering it, which is slow.
            # Strategy: If text is minimal (<200 chars), assume it's a visual slide.
            if skip_images:
                if len(text_content) < 200:
                    embedded_count = 1 # Assume 1 visual element
            else:
                try:
                    if page_img is None:
                        page_img = render_page_image(page_index + 1, dpi=120)
                    if page_img is None:
                        raise RuntimeError("Page render failed for images")
                    img_buffer = io.BytesIO()
                    page_img.save(img_buffer, format="JPEG", quality=85)
                    compressed = _compress_image(img_buffer.getvalue())
                    images.append(compressed)
                    embedded_count = max(embedded_count, 1)
                except Exception:
                    pass

        extracted_pages.append(
            PageContent(
                page_number=page_index + 1, 
                text=text_content, 
                images=images,
                image_count=max(len(images), embedded_count)
            )
        )

    print(f"Info: PDF parsing complete. Total pages extracted: {len(extracted_pages)}")
    return extracted_pages


def extract_pdf_title(pdf_path: str, max_pages: int = 3) -> str:
    """Extract a likely title from the first few pages of a PDF.

    Uses heuristics to find the most prominent text that could be a title:
    - Looks at first few pages (title slides often have the lecture name)
    - Prioritizes text near top of page and longer phrases
    - Filters out common noise like dates, page numbers

    Parameters:
        pdf_path: Path to the PDF file.
        max_pages: Number of pages to scan (default 3).

    Returns:
        Best-guess title string, or empty string if none found.
    """
    import re

    candidates: list[tuple[str, float]] = []  # (text, score)

    # Common noise patterns to filter out
    noise_patterns = [
        r"^\d+$",  # Just numbers (page numbers)
        r"^\d{1,2}[./]\d{1,2}[./]\d{2,4}$",  # Dates
        r"^page\s*\d+",  # Page indicators
        r"^©",  # Copyright
        r"^http",  # URLs
        r"^\s*$",  # Empty/whitespace
    ]
    noise_re = re.compile("|".join(noise_patterns), re.IGNORECASE)

    # Patterns that suggest a lecture/chapter title
    title_patterns = [
        r"^lecture\s*\d+",
        r"^chapter\s*\d+",
        r"^week\s*\d+",
        r"^module\s*\d+",
        r"^session\s*\d+",
        r"^topic\s*\d*:",
        r"^unit\s*\d+",
    ]
    title_boost_re = re.compile("|".join(title_patterns), re.IGNORECASE)

    try:
        reader = PdfReader(pdf_path)
        pages_to_scan = min(max_pages, len(reader.pages))

        for page_idx in range(pages_to_scan):
            page = reader.pages[page_idx]
            text = page.extract_text() or ""

            # Split into lines and score each
            lines = text.split("\n")

            for line_idx, line in enumerate(lines):
                line = line.strip()

                # Skip noise
                if not line or len(line) < 3 or noise_re.match(line):
                    continue

                # Skip very long text (paragraphs, not titles)
                if len(line) > 120:
                    continue

                # Calculate score based on heuristics
                score = 0.0

                # Earlier in document = more likely title
                if page_idx == 0:
                    score += 3.0  # First page bonus
                    # Earlier on first page = stronger signal
                    position_score = max(0, (len(lines) - line_idx) / max(len(lines), 1)) * 2
                    score += position_score
                else:
                    score += 1.0

                # Title pattern boost
                if title_boost_re.match(line):
                    score += 4.0

                # Reasonable length bonus (2-8 words is typical for titles)
                word_count = len(line.split())
                if 2 <= word_count <= 8:
                    score += 1.5
                elif word_count < 2:
                    score -= 1.0

                # ALL CAPS or Title Case often indicates a title
                if line.isupper() and len(line) > 5:
                    score += 1.0
                elif line.istitle():
                    score += 0.5

                candidates.append((line, score))

        if not candidates:
            return ""

        # Sort by score descending, return best candidate
        candidates.sort(key=lambda x: x[1], reverse=True)
        best_title = candidates[0][0]

        # Clean up the title
        best_title = re.sub(r"\s+", " ", best_title).strip()

        return best_title

    except Exception as e:
        print(f"Warning: Title extraction failed: {e}")
        return ""


def _compress_image(
    image_bytes: bytes, max_dimension: int = 1024, quality: int = 80
) -> bytes:
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
            # OPTIMIZATION: If already JPEG and small enough, return original bytes
            if (
                img.format == "JPEG"
                and max(img.size) <= max_dimension
                and img.mode in ("RGB", "L")
            ):
                return image_bytes

            # Convert to RGB if necessary (e.g. for JPEG saving)
            if img.mode in ("RGBA", "P", "CMYK"):
                img = img.convert("RGB")

            # Resize if larger than max_dimension
            if max(img.size) > max_dimension:
                img.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)

            # Compress to JPEG
            output_buffer = io.BytesIO()
            img.save(output_buffer, format="JPEG", quality=quality, optimize=True)
            return output_buffer.getvalue()
    except Exception as e:
        print(f"Warning: Image compression failed: {e}")
        return image_bytes  # Fallback to original
