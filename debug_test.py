import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
import json
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname('tests/test_api.py'), '..')))
from gui.backend.main import app
client = TestClient(app)

def test_generate_event_generator_errors():
    from gui.backend.main import session_manager
    async def failing_gen(*args, **kwargs):
        from lectern.lectern_service import ServiceEvent
        yield ServiceEvent("info", "started", {})
        raise Exception("SSE Crash")

    session = session_manager.create_session("test_slides.pdf", MagicMock(), MagicMock())
    with patch('gui.backend.main.LecternGenerationService'):
        with patch('gui.backend.main.GenerationService.run_generation', side_effect=failing_gen):
            files = {"pdf_file": ("test_slides.pdf", b"p", "application/pdf")}
            data = {"deck_name": "D", "session_id": session.session_id}
            with patch('gui.backend.main.shutil.copyfileobj'):
                with patch('gui.backend.main.tempfile.NamedTemporaryFile') as mock_temp:
                    mock_temp.return_value.__enter__.return_value.name = "/t.pdf"
                    with patch('gui.backend.main.os.path.getsize', return_value=123):
                        response = client.post("/generate", files=files, data=data)
                        print("Response text:", repr(response.text))
                        print("Iter lines:", list(response.iter_lines()))
                        lines = [json.loads(l) for l in response.iter_lines() if l]
                        print("Lines parsed:", lines)

test_generate_event_generator_errors()
