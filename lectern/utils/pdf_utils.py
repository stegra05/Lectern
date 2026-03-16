import logging
import re
from typing import List
from pypdf import PdfReader, PdfWriter

logger = logging.getLogger(__name__)


def parse_page_range(range_str: str, max_pages: int) -> List[int]:
    """
    Parses a string like "1-3, 5" into a list of 0-indexed page numbers.
    Ignores invalid inputs and bounds them to the max_pages.

    Args:
        range_str: O-indexed string specifying pages (e.g. "1, 3-5", "2")
        max_pages: The total number of pages in the document.

    Returns:
        List of 0-indexed page indices to extract, sorted and deduplicated.
    """
    if not range_str or not str(range_str).strip():
        # If empty, return all pages
        return list(range(max_pages))

    pages = set()
    parts = re.split(r"[,;]\s*", str(range_str).strip())

    for part in parts:
        if not part:
            continue
        if "-" in part:
            # Range
            try:
                start_str, end_str = part.split("-", 1)
                start = int(start_str.strip()) - 1
                end = int(end_str.strip()) - 1

                # Bounds check
                start = max(0, min(start, max_pages - 1))
                end = max(0, min(end, max_pages - 1))

                if start <= end:
                    pages.update(range(start, end + 1))
                else:
                    pages.update(range(end, start + 1))
            except ValueError:
                logger.warning(f"Failed to parse page range part: {part}")
        else:
            # Single page
            try:
                page = int(part.strip()) - 1
                if 0 <= page < max_pages:
                    pages.add(page)
            except ValueError:
                logger.warning(f"Failed to parse page part: {part}")

    # If parsing completely failed, return all pages to avoid 0 page extraction
    if not pages:
        logger.warning(f"No valid pages parsed from {range_str}, returning all pages")
        return list(range(max_pages))

    return sorted(list(pages))


def extract_pages(input_pdf: str, output_pdf: str, pages: List[int]) -> None:
    """
    Extracts specific pages from an input PDF and saves them to an output PDF.

    Args:
        input_pdf: Path to the original PDF
        output_pdf: Path to output the temporary extracted PDF
        pages: List of 0-indexed pages to extract
    """
    reader = PdfReader(input_pdf)
    writer = PdfWriter()

    for page_num in pages:
        if 0 <= page_num < len(reader.pages):
            writer.add_page(reader.pages[page_num])

    with open(output_pdf, "wb") as output_file:
        writer.write(output_file)
    logger.info(f"Extracted {len(pages)} pages to {output_pdf}")
