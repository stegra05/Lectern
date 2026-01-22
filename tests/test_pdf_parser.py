
import os
import io
import pytest
from unittest.mock import MagicMock, patch, PropertyMock
from PIL import Image
import fitz
import pytesseract

from pdf_parser import (
    extract_content_from_pdf,
    extract_pdf_title,
    _compress_image,
    PageContent
)

# --- Fixtures ---

@pytest.fixture
def real_pdf_path():
    """Returns the path to the real test.pdf in the project root."""
    path = os.path.abspath("test.pdf")
    if not os.path.exists(path):
        pytest.skip("test.pdf not found in project root")
    return path

@pytest.fixture
def sample_image_bytes():
    """Creates a simple valid image in memory."""
    img = Image.new('RGB', (100, 100), color='red')
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()

@pytest.fixture
def large_image_bytes():
    """Creates a large image to test compression."""
    img = Image.new('RGB', (2000, 2000), color='blue')
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()

# --- Tests for _compress_image ---

def test_compress_image_valid(sample_image_bytes):
    """Test that a valid image is compressed/processed and returns bytes."""
    result = _compress_image(sample_image_bytes)
    assert isinstance(result, bytes)
    assert len(result) > 0
    # Check if it's a valid JPEG
    img = Image.open(io.BytesIO(result))
    assert img.format == 'JPEG'

def test_compress_image_resize(large_image_bytes):
    """Test that a large image is resized to max_dimension."""
    result = _compress_image(large_image_bytes, max_dimension=100)
    img = Image.open(io.BytesIO(result))
    assert max(img.size) <= 100
    assert img.format == 'JPEG'

def test_compress_image_fallback_on_error():
    """Test fallback to original bytes on invalid image data."""
    invalid_bytes = b"not an image"
    # The function prints a warning and returns original bytes
    result = _compress_image(invalid_bytes)
    assert result == invalid_bytes

# --- Tests for extract_pdf_title ---

def test_extract_pdf_title_real_pdf(real_pdf_path):
    """Test extracting title from the real PDF."""
    title = extract_pdf_title(real_pdf_path)
    # We don't know the exact title of test.pdf, but it should return a string (empty or not)
    assert isinstance(title, str)

@patch('fitz.open')
def test_extract_pdf_title_heuristics(mock_open):
    """Test title extraction logic with mocked PDF content."""
    # Mock document structure
    mock_doc = MagicMock()
    mock_open.return_value.__enter__.return_value = mock_doc
    mock_doc.page_count = 1
    
    mock_page = MagicMock()
    mock_doc.load_page.return_value = mock_page
    mock_page.rect.height = 1000
    mock_page.rect.width = 800
    
    # Mock text blocks: "Lecture 1: Intro" (High score candidate) vs "Page 1" (Noise)
    mock_page.get_text.return_value = {
        "blocks": [
            {
                "type": 0,
                "bbox": [100, 100, 700, 150], # Top of page
                "lines": [{
                    "spans": [{
                        "text": "Lecture 1: Introduction to Testing",
                        "size": 24
                    }]
                }]
            },
            {
                "type": 0,
                "bbox": [700, 900, 750, 950], # Bottom right
                "lines": [{
                    "spans": [{
                        "text": "Page 1",
                        "size": 10
                    }]
                }]
            }
        ]
    }
    
    title = extract_pdf_title("dummy.pdf")
    assert title == "Lecture 1: Introduction to Testing"

@patch('fitz.open')
def test_extract_pdf_title_no_candidates(mock_open):
    """Test when no suitable title is found."""
    mock_doc = MagicMock()
    mock_open.return_value.__enter__.return_value = mock_doc
    mock_doc.page_count = 1
    mock_page = MagicMock()
    mock_doc.load_page.return_value = mock_page
    
    # Only noise
    mock_page.get_text.return_value = {
        "blocks": [
            {
                "type": 0,
                "bbox": [0,0,10,10],
                "lines": [{"spans": [{"text": "1", "size": 10}]}] # Page number
            }
        ]
    }
    
    title = extract_pdf_title("dummy.pdf")
    assert title == ""

# --- Tests for extract_content_from_pdf ---

def test_extract_content_from_pdf_real(real_pdf_path):
    """Integration test with the real PDF file."""
    pages = extract_content_from_pdf(real_pdf_path)
    assert isinstance(pages, list)
    if len(pages) > 0:
        assert isinstance(pages[0], PageContent)
        assert hasattr(pages[0], 'text')
        assert hasattr(pages[0], 'images')
        assert hasattr(pages[0], 'page_number')

def test_extract_content_from_pdf_skip_options(real_pdf_path):
    """Test that skip_images prevents image extraction."""
    # We can't easily verify skip_ocr on a real PDF without knowing if it triggers OCR,
    # but we can verify skip_images.
    pages = extract_content_from_pdf(real_pdf_path, skip_images=True)
    for page in pages:
        assert len(page.images) == 0

@patch('fitz.open')
def test_extract_content_stop_check(mock_open):
    """Test that the stop_check callback aborts parsing."""
    mock_doc = MagicMock()
    mock_open.return_value.__enter__.return_value = mock_doc
    mock_doc.page_count = 10
    
    # Stop immediately
    stop_check = MagicMock(return_value=True)
    
    pages = extract_content_from_pdf("dummy.pdf", stop_check=stop_check)
    
    assert len(pages) == 0
    stop_check.assert_called_once()

@patch('fitz.open')
@patch('pytesseract.image_to_string')
@patch('PIL.Image.open')
def test_ocr_fallback(mock_image_open, mock_ocr, mock_fitz_open):
    """Test that OCR is triggered when text is minimal."""
    # Setup Mock PDF
    mock_doc = MagicMock()
    mock_fitz_open.return_value.__enter__.return_value = mock_doc
    mock_doc.page_count = 1
    
    mock_page = MagicMock()
    mock_doc.load_page.return_value = mock_page
    
    # Minimal text to trigger OCR
    mock_page.get_text.return_value = "   " 
    
    # Mock pixmap for image generation
    mock_pix = MagicMock()
    mock_pix.tobytes.return_value = b"fake_image_data"
    mock_page.get_pixmap.return_value = mock_pix
    
    # Mock OCR result
    mock_ocr.return_value = "Extracted Text via OCR"
    
    # Run
    pages = extract_content_from_pdf("dummy.pdf", skip_ocr=False)
    
    assert len(pages) == 1
    assert "[OCR Extracted Content]" in pages[0].text
    assert "Extracted Text via OCR" in pages[0].text
    mock_ocr.assert_called_once()

@patch('fitz.open')
@patch('pytesseract.image_to_string')
def test_skip_ocr_flag(mock_ocr, mock_fitz_open):
    """Test that skip_ocr=True prevents OCR even with minimal text."""
    mock_doc = MagicMock()
    mock_fitz_open.return_value.__enter__.return_value = mock_doc
    mock_doc.page_count = 1
    mock_page = MagicMock()
    mock_doc.load_page.return_value = mock_page
    mock_page.get_text.return_value = "   "
    
    pages = extract_content_from_pdf("dummy.pdf", skip_ocr=True)
    
    assert len(pages) == 1
    assert "OCR Extracted Content" not in pages[0].text
    mock_ocr.assert_not_called()

@patch('fitz.open')
def test_image_extraction_exception(mock_fitz_open, sample_image_bytes):
    """Test that image extraction failures are handled gracefully."""
    mock_doc = MagicMock()
    mock_fitz_open.return_value.__enter__.return_value = mock_doc
    mock_doc.page_count = 1
    mock_page = MagicMock()
    mock_doc.load_page.return_value = mock_page
    mock_page.get_text.return_value = "Some text"
    
    # page.get_images returns list of tuples, first elem is xref
    mock_page.get_images.return_value = [(123, 0, 0)]
    
    # Case 1: extract_image raises exception
    mock_doc.extract_image.side_effect = Exception("Corrupt image")
    
    pages = extract_content_from_pdf("dummy.pdf", skip_images=False)
    
    assert len(pages) == 1
    assert len(pages[0].images) == 0 # Should skip the broken image

@patch('fitz.open')
@patch('pdf_parser._compress_image')
def test_image_extraction_success(mock_compress, mock_fitz_open, sample_image_bytes):
    """Test successful image extraction and compression call."""
    mock_doc = MagicMock()
    mock_fitz_open.return_value.__enter__.return_value = mock_doc
    mock_doc.page_count = 1
    mock_page = MagicMock()
    mock_doc.load_page.return_value = mock_page
    mock_page.get_text.return_value = "Some text"
    
    mock_page.get_images.return_value = [(123,)]
    
    # Return a valid dictionary simulating PyMuPDF
    mock_doc.extract_image.side_effect = None
    mock_doc.extract_image.return_value = {"image": sample_image_bytes}
    
    # Mock compression to return the same bytes
    mock_compress.return_value = sample_image_bytes
    
    pages = extract_content_from_pdf("dummy.pdf", skip_images=False)
    
    assert len(pages) == 1
    assert len(pages[0].images) == 1
    assert pages[0].images[0] == sample_image_bytes
    mock_compress.assert_called_once()

@patch('fitz.open')
@patch('pytesseract.image_to_string')
@patch('PIL.Image.open')
def test_ocr_boundary_condition(mock_image_open, mock_ocr, mock_fitz_open):
    """Test the boundary condition for OCR fallback (50 chars)."""
    # Setup Mock PDF
    mock_doc = MagicMock()
    mock_fitz_open.return_value.__enter__.return_value = mock_doc
    mock_doc.page_count = 2

    mock_page_1 = MagicMock()
    mock_page_2 = MagicMock()

    def load_page_side_effect(page_index):
        if page_index == 0:
            return mock_page_1
        else:
            return mock_page_2

    mock_doc.load_page.side_effect = load_page_side_effect

    # Page 1: 49 chars (should trigger OCR)
    text_49 = "a" * 49
    mock_page_1.get_text.return_value = text_49

    # Page 2: 50 chars (should NOT trigger OCR)
    text_50 = "a" * 50
    mock_page_2.get_text.return_value = text_50

    # Mock pixmap for image generation (needed for OCR)
    mock_pix = MagicMock()
    mock_pix.tobytes.return_value = b"fake_image_data"
    mock_page_1.get_pixmap.return_value = mock_pix
    mock_page_2.get_pixmap.return_value = mock_pix # Should not be called, but just in case

    # Mock OCR result
    mock_ocr.return_value = "OCR Result"

    # Run
    pages = extract_content_from_pdf("dummy.pdf", skip_ocr=False)

    assert len(pages) == 2

    # Check Page 1 (49 chars)
    # The OCR text is appended to the original text
    assert "[OCR Extracted Content]" in pages[0].text

    # Check Page 2 (50 chars)
    assert "[OCR Extracted Content]" not in pages[1].text

    # Verify OCR was called exactly once (only for page 1)
    mock_ocr.assert_called_once()

@patch('fitz.open')
@patch('pytesseract.image_to_string')
@patch('PIL.Image.open')
def test_ocr_tesseract_not_found(mock_image_open, mock_ocr, mock_fitz_open):
    """Test that TesseractNotFoundError is handled gracefully."""

    mock_doc = MagicMock()
    mock_fitz_open.return_value.__enter__.return_value = mock_doc
    mock_doc.page_count = 1

    mock_page = MagicMock()
    mock_doc.load_page.return_value = mock_page
    mock_page.get_text.return_value = "   "

    mock_pix = MagicMock()
    mock_pix.tobytes.return_value = b"fake_image_data"
    mock_page.get_pixmap.return_value = mock_pix

    # Mock OCR to raise TesseractNotFoundError
    mock_ocr.side_effect = pytesseract.TesseractNotFoundError()

    pages = extract_content_from_pdf("dummy.pdf", skip_ocr=False)

    assert len(pages) == 1
    # Ensure it didn't crash and text is just the original
    assert "[OCR Extracted Content]" not in pages[0].text
    assert pages[0].text.strip() == ""
