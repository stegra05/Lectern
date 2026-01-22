
import io
import pytest
from PIL import Image
from pdf_parser import _compress_image

def create_test_image(mode, size, color):
    """Helper to create a test image in bytes."""
    img = Image.new(mode, size, color)
    buf = io.BytesIO()
    # JPEG doesn't support RGBA or P directly in save usually, so we use PNG for input source
    save_format = 'PNG'
    if mode == 'CMYK':
        save_format = 'TIFF' # PNG doesn't support CMYK
    elif mode == 'RGB':
        save_format = 'JPEG'

    try:
        img.save(buf, format=save_format)
    except Exception:
        # Fallback to PNG for most
        img.save(buf, format='PNG')

    return buf.getvalue()

def test_compress_image_resize_large():
    """Test that a large image is resized to max_dimension."""
    # Create 2000x2000 image
    img_bytes = create_test_image('RGB', (2000, 2000), 'red')

    compressed_bytes = _compress_image(img_bytes, max_dimension=1024)

    with Image.open(io.BytesIO(compressed_bytes)) as img:
        assert max(img.size) <= 1024
        assert img.format == 'JPEG'

def test_compress_image_small_no_resize():
    """Test that a small image is not resized up."""
    img_bytes = create_test_image('RGB', (500, 500), 'blue')

    compressed_bytes = _compress_image(img_bytes, max_dimension=1024)

    with Image.open(io.BytesIO(compressed_bytes)) as img:
        assert img.size == (500, 500)
        assert img.format == 'JPEG'

def test_compress_image_rgba_conversion():
    """Test that RGBA images are converted to RGB (JPEG doesn't support RGBA)."""
    img_bytes = create_test_image('RGBA', (100, 100), (255, 0, 0, 128))

    compressed_bytes = _compress_image(img_bytes)

    with Image.open(io.BytesIO(compressed_bytes)) as img:
        assert img.mode == 'RGB'
        assert img.format == 'JPEG'

def test_compress_image_p_conversion():
    """Test that Palette (P) images are converted to RGB."""
    # Create P image
    img = Image.new('P', (100, 100), 0)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    img_bytes = buf.getvalue()

    compressed_bytes = _compress_image(img_bytes)

    with Image.open(io.BytesIO(compressed_bytes)) as img:
        assert img.mode == 'RGB'
        assert img.format == 'JPEG'

def test_compress_image_cmyk_conversion():
    """Test that CMYK images are converted to RGB."""
    # Create CMYK image
    img_bytes = create_test_image('CMYK', (100, 100), (0, 0, 0, 0))

    compressed_bytes = _compress_image(img_bytes)

    with Image.open(io.BytesIO(compressed_bytes)) as img:
        assert img.mode == 'RGB'
        assert img.format == 'JPEG'

def test_compress_image_invalid_data():
    """Test proper handling of invalid image data."""
    invalid_bytes = b"This is not an image"
    result = _compress_image(invalid_bytes)
    assert result == invalid_bytes
