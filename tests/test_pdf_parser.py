import os
import io
import pytest
from unittest.mock import MagicMock, patch
from PIL import Image
try:
    import pytesseract
except ImportError:
    pytesseract = MagicMock()

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
    try:
        title = extract_pdf_title(real_pdf_path)
        # We don't know the exact title of test.pdf, but it should return a string
        assert isinstance(title, str)
    except Exception as e:
        pytest.fail(f"Title extraction on real PDF failed: {e}")

@patch('pdf_parser.PdfReader')
def test_extract_pdf_title_heuristics(mock_reader_cls):
    """Test title extraction logic with mocked pypdf content."""
    mock_reader = MagicMock()
    mock_reader_cls.return_value = mock_reader
    
    mock_page = MagicMock()
    # Mock extract_text to return lines we can score
    # "Lecture 1: Introduction" matches the title regex boost
    mock_page.extract_text.return_value = "Lecture 1: Introduction\n\nSome body text..."
    
    mock_reader.pages = [mock_page]
    
    title = extract_pdf_title("dummy.pdf")
    assert title == "Lecture 1: Introduction"

@patch('pdf_parser.PdfReader')
def test_extract_pdf_title_no_candidates(mock_reader_cls):
    """Test when no suitable title is found (only noise)."""
    mock_reader = MagicMock()
    mock_reader_cls.return_value = mock_reader
    
    mock_page = MagicMock()
    # "Page 1" is in the noise patterns list
    mock_page.extract_text.return_value = "Page 1\n"
    
    mock_reader.pages = [mock_page]
    
    title = extract_pdf_title("dummy.pdf")
    assert title == ""

# --- Tests for extract_content_from_pdf ---

def test_extract_content_from_pdf_real(real_pdf_path):
    """Integration test with the real PDF file."""
    # This runs the actual pypdf + pypdfium2 code.
    # Note: pypdfium2 is bundled, no external dependencies.
    pages = extract_content_from_pdf(real_pdf_path)
    assert isinstance(pages, list)
    if len(pages) > 0:
        assert isinstance(pages[0], PageContent)
        assert hasattr(pages[0], 'text')
        assert hasattr(pages[0], 'images')
        assert hasattr(pages[0], 'page_number')

@patch('os.path.getsize')
@patch('pdf_parser.pdfium.PdfDocument')
@patch('pdf_parser.PdfReader')
def test_extract_content_from_pdf_skip_options(mock_reader_cls, mock_pdfium_doc, mock_getsize):
    """Test that skip_images flag prevents image collection."""
    mock_getsize.return_value = 1024
    
    mock_reader = MagicMock()
    mock_reader_cls.return_value = mock_reader
    mock_page = MagicMock()
    mock_page.extract_text.return_value = "Some text"
    
    # Simulate embedded images
    mock_img_obj = MagicMock()
    mock_img_obj.data = b"fake_img_data"
    mock_page.images = [mock_img_obj]
    
    mock_reader.pages = [mock_page]
    
    # skip_images=True should result in empty images list
    pages = extract_content_from_pdf("dummy.pdf", skip_images=True, skip_ocr=True)
    
    assert len(pages) == 1
    assert len(pages[0].images) == 0
    # Verify pdfium was NOT called (optimization)
    mock_pdfium_doc.assert_not_called()

@patch('os.path.getsize')
@patch('pdf_parser.pdfium.PdfDocument')
@patch('pdf_parser.PdfReader')
def test_extract_content_stop_check(mock_reader_cls, mock_pdfium_doc, mock_getsize):
    """Test that the stop_check callback aborts parsing."""
    mock_getsize.return_value = 1024
    
    mock_reader = MagicMock()
    mock_reader_cls.return_value = mock_reader
    
    # Simulate multiple pages
    mock_reader.pages = [MagicMock(), MagicMock(), MagicMock()]
    
    # Stop immediately
    stop_check = MagicMock(return_value=True)
    
    pages = extract_content_from_pdf("dummy.pdf", stop_check=stop_check)
    
    assert len(pages) == 0
    stop_check.assert_called_once()

@patch('os.path.getsize')
@patch('pdf_parser.pytesseract.image_to_string')
@patch('pdf_parser.pdfium.PdfDocument')
@patch('pdf_parser.PdfReader')
def test_ocr_fallback(mock_reader_cls, mock_pdfium_doc, mock_ocr, mock_getsize):
    """Test that OCR is triggered when text is minimal."""
    mock_getsize.return_value = 1024
    
    mock_reader = MagicMock()
    mock_reader_cls.return_value = mock_reader
    
    mock_page = MagicMock()
    # Minimal text (< 50 chars) to trigger OCR check
    mock_page.extract_text.return_value = "   " 
    # No embedded images
    mock_page.images = []
    
    mock_reader.pages = [mock_page]
    
    # Mock pypdfium2: PdfDocument returns a mock that can be indexed
    mock_doc = MagicMock()
    mock_page_pdfium = MagicMock()
    mock_bitmap = MagicMock()
    mock_pil_img = MagicMock()
    mock_bitmap.to_pil.return_value = mock_pil_img
    mock_page_pdfium.render.return_value = mock_bitmap
    mock_doc.__getitem__ = MagicMock(return_value=mock_page_pdfium)
    mock_pdfium_doc.return_value = mock_doc
    
    # Mock OCR result
    mock_ocr.return_value = "Extracted Text via OCR"
    
    pages = extract_content_from_pdf("dummy.pdf", skip_ocr=False)
    
    assert len(pages) == 1
    assert "[OCR Extracted Content]" in pages[0].text
    assert "Extracted Text via OCR" in pages[0].text
    
    mock_pdfium_doc.assert_called_once()
    mock_ocr.assert_called_once()

@patch('os.path.getsize')
@patch('pdf_parser.pytesseract.image_to_string')
@patch('pdf_parser.pdfium.PdfDocument')
@patch('pdf_parser.PdfReader')
def test_ocr_tesseract_not_found_handled(mock_reader_cls, mock_pdfium_doc, mock_ocr, mock_getsize):
    """Test that TesseractNotFoundError is handled gracefully."""
    mock_getsize.return_value = 1024
    
    mock_reader = MagicMock()
    mock_reader_cls.return_value = mock_reader
    mock_page = MagicMock()
    mock_page.extract_text.return_value = " " # trigger OCR
    mock_page.images = []
    mock_reader.pages = [mock_page]
    
    # Mock pypdfium2
    mock_doc = MagicMock()
    mock_page_pdfium = MagicMock()
    mock_bitmap = MagicMock()
    mock_bitmap.to_pil.return_value = MagicMock()
    mock_page_pdfium.render.return_value = mock_bitmap
    mock_doc.__getitem__ = MagicMock(return_value=mock_page_pdfium)
    mock_pdfium_doc.return_value = mock_doc
    
    # Simulate Tesseract missing
    mock_ocr.side_effect = pytesseract.TesseractNotFoundError()
    
    pages = extract_content_from_pdf("dummy.pdf", skip_ocr=False)
    
    assert len(pages) == 1
    # Should contain original empty text, no crash, no OCR tag
    assert "[OCR Extracted Content]" not in pages[0].text

@patch('os.path.getsize')
@patch('pdf_parser._compress_image')
@patch('pdf_parser.pdfium.PdfDocument')
@patch('pdf_parser.PdfReader')
def test_image_extraction_pypdf(mock_reader_cls, mock_pdfium_doc, mock_compress, mock_getsize, sample_image_bytes):
    """Test verification of image extraction from PDF structure (pypdf)."""
    mock_getsize.return_value = 1024
    
    mock_reader = MagicMock()
    mock_reader_cls.return_value = mock_reader
    mock_page = MagicMock()
    mock_page.extract_text.return_value = "Text present"
    
    # Create a mock image object as returned by pypdf
    mock_img_obj = MagicMock()
    mock_img_obj.data = b"fake_raw_data"
    mock_page.images = [mock_img_obj]
    
    mock_reader.pages = [mock_page]
    
    # Mock compression to just return the bytes we passed + processed
    mock_compress.return_value = b"compressed_data"
    
    pages = extract_content_from_pdf("dummy.pdf", skip_images=False)
    
    assert len(pages) == 1
    assert len(pages[0].images) == 1
    assert pages[0].images[0] == b"compressed_data"
    mock_compress.assert_called()

@patch('os.path.getsize')
@patch('pdf_parser._compress_image')
@patch('pdf_parser.pdfium.PdfDocument')
@patch('pdf_parser.PdfReader')
def test_image_extraction_fallback_render(mock_reader_cls, mock_pdfium_doc, mock_compress, mock_getsize):
    """Test that if no embedded images, we fallback to rendered page image."""
    mock_getsize.return_value = 1024
    
    mock_reader = MagicMock()
    mock_reader_cls.return_value = mock_reader
    mock_page = MagicMock()
    mock_page.extract_text.return_value = "Text present"
    mock_page.images = [] # No embedded images
    mock_reader.pages = [mock_page]
    
    # Mock pypdfium2: PdfDocument returns a mock PIL image via render().to_pil()
    mock_doc = MagicMock()
    mock_page_pdfium = MagicMock()
    mock_bitmap = MagicMock()
    mock_pil_img = MagicMock()
    def save_side_effect(fp, format, **kwargs):
        fp.write(b"rendered_image_data")
    mock_pil_img.save.side_effect = save_side_effect
    mock_bitmap.to_pil.return_value = mock_pil_img
    mock_page_pdfium.render.return_value = mock_bitmap
    mock_doc.__getitem__ = MagicMock(return_value=mock_page_pdfium)
    mock_pdfium_doc.return_value = mock_doc
    mock_compress.return_value = b"compressed_rendered_data"
    
    pages = extract_content_from_pdf("dummy.pdf", skip_images=False)
    
    assert len(pages) == 1
    # It should have captured the rendered page
    assert len(pages[0].images) == 1
    assert pages[0].images[0] == b"compressed_rendered_data"
