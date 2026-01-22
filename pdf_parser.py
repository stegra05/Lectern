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


def extract_content_from_pdf(
    pdf_path: str, 
    stop_check: Optional[Callable[[], bool]] = None,
    skip_ocr: bool = False,
    skip_images: bool = False
) -> List[PageContent]:
    """Extract text and images from a PDF.

    Parameters:
        pdf_path: Absolute or relative path to the PDF file.
        stop_check: Optional callback that returns True if processing should stop.
        skip_ocr: If True, skips Tesseract OCR on minimal-text pages.
        skip_images: If True, skips image extraction and compression.

    Returns:
       A list of PageContent objects, one per page.
    """

    extracted_pages: List[PageContent] = []
    
    # Debug: Check file info
    try:
        import os
        file_size = os.path.getsize(pdf_path)
        print(f"Info: Parsing PDF at {pdf_path}. Size: {file_size} bytes.")
    except Exception as e:
        print(f"Warning: Could not check file size: {e}")

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
            if not skip_ocr and len(text_content.strip()) < 50:
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
            if not skip_images:
                for image_info in page.get_images(full=True):
                    xref = image_info[0]
                    try:
                        image_dict = document.extract_image(xref)
                    except Exception:
                        # Skip images that cannot be extracted for any reason
                        continue
                    
                    raw_bytes = image_dict.get("image")
                    if isinstance(raw_bytes, (bytes, bytearray)):
                        # Compress images to reduce token usage and latency.
                        compressed_bytes = _compress_image(bytes(raw_bytes))
                        images.append(compressed_bytes)

            extracted_pages.append(
                PageContent(page_number=page_index + 1, text=text_content, images=images)
            )

    print(f"Info: PDF parsing complete. Total pages extracted: {len(extracted_pages)}")
    return extracted_pages


def extract_pdf_title(pdf_path: str, max_pages: int = 3) -> str:
    """Extract a likely title from the first few pages of a PDF.
    
    Uses heuristics to find the most prominent text that could be a title:
    - Looks at first few pages (title slides often have the lecture name)
    - Prioritizes larger text blocks and centered content
    - Filters out common noise like dates, page numbers, logos
    
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
        r'^\d+$',  # Just numbers (page numbers)
        r'^\d{1,2}[./]\d{1,2}[./]\d{2,4}$',  # Dates
        r'^page\s*\d+',  # Page indicators
        r'^©',  # Copyright
        r'^http',  # URLs
        r'^\s*$',  # Empty/whitespace
    ]
    noise_re = re.compile('|'.join(noise_patterns), re.IGNORECASE)
    
    # Patterns that suggest a lecture/chapter title
    title_patterns = [
        r'^lecture\s*\d+',
        r'^chapter\s*\d+',
        r'^week\s*\d+',
        r'^module\s*\d+',
        r'^session\s*\d+',
        r'^topic\s*\d*:',
        r'^unit\s*\d+',
    ]
    title_boost_re = re.compile('|'.join(title_patterns), re.IGNORECASE)
    
    try:
        with fitz.open(pdf_path) as doc:
            pages_to_scan = min(max_pages, doc.page_count)
            
            for page_idx in range(pages_to_scan):
                page = doc.load_page(page_idx)
                
                # Get text with positional info using "dict" output
                text_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
                page_height = page.rect.height
                page_width = page.rect.width
                
                for block in text_dict.get("blocks", []):
                    if block.get("type") != 0:  # Skip non-text blocks
                        continue
                    
                    # Get block position (y0 = top of block)
                    y0 = block.get("bbox", [0, 0, 0, 0])[1]
                    x0 = block.get("bbox", [0, 0, 0, 0])[0]
                    x1 = block.get("bbox", [0, 0, 0, 0])[2]
                    
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            text = span.get("text", "").strip()
                            font_size = span.get("size", 12)
                            
                            # Skip noise
                            if not text or len(text) < 3 or noise_re.match(text):
                                continue
                            
                            # Skip very long text (paragraphs, not titles)
                            if len(text) > 120:
                                continue
                            
                            # Calculate score based on heuristics
                            score = 0.0
                            
                            # Larger font = more likely title
                            score += min(font_size / 10, 5.0)
                            
                            # Higher on page = more likely title (first page especially)
                            if page_idx == 0:
                                position_score = max(0, (page_height - y0) / page_height) * 3
                                score += position_score + 2  # Bonus for first page
                            else:
                                position_score = max(0, (page_height - y0) / page_height) * 1.5
                                score += position_score
                            
                            # Centered text bonus
                            center_x = (x0 + x1) / 2
                            if abs(center_x - page_width / 2) < page_width * 0.2:
                                score += 1.5
                            
                            # Title pattern boost
                            if title_boost_re.match(text):
                                score += 4.0
                            
                            # Penalize if too short (single words are often not titles)
                            if len(text.split()) < 2:
                                score -= 1.0
                            
                            candidates.append((text, score))
        
        if not candidates:
            return ""
        
        # Sort by score descending, return best candidate
        candidates.sort(key=lambda x: x[1], reverse=True)
        best_title = candidates[0][0]
        
        # Clean up the title
        best_title = re.sub(r'\s+', ' ', best_title).strip()
        
        return best_title
        
    except Exception as e:
        print(f"Warning: Title extraction failed: {e}")
        return ""


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
            # CMYK needs to be converted to RGB for JPEG compatibility
            if img.mode in ('RGBA', 'P', 'CMYK'):
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


