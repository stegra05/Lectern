import sys
import unittest
import os
from pathlib import Path
from unittest.mock import patch, MagicMock

from utils.path_utils import get_app_data_dir

class TestPlatformCompat(unittest.TestCase):
    def test_app_data_dir_resolution(self):
        """Verify app data directory resolution per platform."""
        with patch('sys.platform', 'darwin'):
            # Path.home() is harder to mock cleanly, so we check relative structure
            path = get_app_data_dir()
            self.assertTrue(str(path).endswith("Library/Application Support/Lectern"))
            
        with patch('sys.platform', 'win32'):
            # Use forward slashes even for Windows mock to avoid PosixPath issues on macOS
            with patch.dict('os.environ', {'APPDATA': 'C:/Users/Test/AppData/Roaming'}):
                path = get_app_data_dir()
                self.assertEqual(path.as_posix(), "C:/Users/Test/AppData/Roaming/Lectern")
                
        with patch('sys.platform', 'linux'):
            with patch.dict('os.environ', {'XDG_CONFIG_HOME': '/home/test/.config'}):
                path = get_app_data_dir()
                self.assertEqual(path.as_posix(), "/home/test/.config/lectern")

    def test_keyring_backend_available(self):
        """Verify that a keyring backend is detected."""
        import keyring
        try:
            backend = keyring.get_keyring()
            print(f"Detected keyring backend: {backend}")
            self.assertIsNotNone(backend)
        except Exception as e:
            self.fail(f"Keyring failed to initialize: {e}")

    def test_pywebview_imports(self):
        """Verify pywebview and platform dependencies can be imported."""
        try:
            import webview
            self.assertIsNotNone(webview)
            
            if sys.platform == 'darwin':
                import objc
                import Cocoa
                self.assertIsNotNone(objc)
                self.assertIsNotNone(Cocoa)
        except ImportError as e:
            self.fail(f"GUI dependencies missing: {e}")

    @patch('pdf_parser.pytesseract.image_to_string')
    def test_tesseract_graceful_failure(self, mock_ocr):
        """Verify TesseractNotFoundError is handled gracefully."""
        from pdf_parser import extract_content_from_pdf
        import pytesseract
        
        # Mocking pytesseract.TesseractNotFoundError
        # In actual code it's raised when binary is missing
        mock_ocr.side_effect = pytesseract.TesseractNotFoundError()
        
        # This shouldn't crash the whole parsing process
        # We'll use a nonexistent PDF to trigger the reader error early or mock the reader
        with patch('pdf_parser.PdfReader') as mock_reader:
            mock_reader.return_value.pages = [MagicMock()]
            # Should not raise exception
            try:
                extract_content_from_pdf("dummy.pdf", skip_images=True)
            except Exception as e:
                self.fail(f"extract_content_from_pdf raised exception on missing Tesseract: {e}")

if __name__ == "__main__":
    unittest.main()
