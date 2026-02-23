import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
import json
import os
import sys
import traceback

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname('tests/test_api.py'), '..')))
from gui.backend.main import app

def test_generate_endpoint():
    client = TestClient(app)
    
    mock_service = MagicMock()
    async def mock_run_generation(*args, **kwargs):
        from lectern.lectern_service import ServiceEvent
        e = ServiceEvent("info", "starting", {})
        print("Yielding:", type(e), e)
        yield e
        
        e2 = ServiceEvent("done", "completed", {})
        print("Yielding:", type(e2), e2)
        yield e2

    # CRITICAL: We patch the method on the class directly, to isolate from MagicMock weirdness
    with patch('gui.backend.main.HistoryManager'):
        with patch('gui.backend.main.GenerationService.run_generation', mock_run_generation):
             with patch('gui.backend.main.shutil.copyfileobj'):
                with patch('gui.backend.main.tempfile.NamedTemporaryFile') as mock_temp:
                    mock_temp.return_value.__enter__.return_value.name = "/tmp/test_slides.pdf"
                    with patch('gui.backend.main.os.path.getsize', return_value=123):
                        
                        files = {"pdf_file": ("test_slides.pdf", b"pdf content", "application/pdf")}
                        data = {"deck_name": "Test Deck"}

                        response = client.post("/generate", files=files, data=data)
                        print("Response lines:", list(response.iter_lines()))

try:
    test_generate_endpoint()
except Exception as e:
    traceback.print_exc()
