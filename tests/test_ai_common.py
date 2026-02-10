import pytest
from lectern.ai_common import _infer_mime_type, _compose_multimodal_content, _build_loggable_parts, _start_session_log, _append_session_log
from unittest.mock import MagicMock, patch, mock_open
from lectern import config
import json
import os

def test_infer_mime_type():
    assert _infer_mime_type(b'\x89PNG\r\n\x1a\n') == "image/png"
    assert _infer_mime_type(b'\xff\xd8\xff') == "image/jpeg"
    assert _infer_mime_type(b'GIF87a') == "image/gif"
    assert _infer_mime_type(b'GIF89a') == "image/gif"
    assert _infer_mime_type(b'RIFFsomeWEBP') == "image/webp"
    assert _infer_mime_type(b'unknown') == "application/octet-stream"

def test_compose_multimodal_content():
    pages = [
        {"text": "page1", "images": [b"img1"]},
        {"text": "  ", "images": []} # Empty text
    ]
    with patch('lectern.ai_common.types.Part.from_bytes') as mock_part:
        mock_part.return_value = "part_obj"
        parts = _compose_multimodal_content(pages, "prompt")
        assert len(parts) == 3 # prompt, text1, img1
        assert parts[0] == "prompt"
        assert parts[1] == "Slide text:\npage1"
        assert parts[2] == "part_obj"

def test_build_loggable_parts():
    class MockPart:
        def __init__(self, text=None, inline_data=None):
            self.text = text
            self.inline_data = inline_data

    parts = [
        "plain text",
        MockPart(text="part text"),
        MockPart(inline_data=MagicMock(mime_type="image/png", data=b"123")),
        {"text": "dict text"},
        {"inline_data": {"mime_type": "image/jpeg", "data": "base64"}},
        123 # Unknown type
    ]
    loggable = _build_loggable_parts(parts)
    assert len(loggable) == 5
    assert loggable[0]["text"] == "plain text"
    assert loggable[1]["text"] == "part text"
    assert loggable[2]["inline_data"]["mime_type"] == "image/png"
    assert loggable[3]["text"] == "dict text"
    assert loggable[4]["inline_data"]["mime_type"] == "image/jpeg"

def test_session_logging_logic():
    # Test _start_session_log
    with patch('lectern.config.LOG_SESSION_CONTENT', True):
        with patch('lectern.utils.path_utils.get_app_data_dir') as mock_dir:
            from pathlib import Path
            temp_dir = Path("/tmp/lectern_test_logs")
            mock_dir.return_value = temp_dir
            with patch('pathlib.Path.mkdir'):
                with patch('builtins.open', mock_open()) as m_open:
                    path = _start_session_log()
                    assert "session-" in path
                    assert "json" in path

    # Test _append_session_log error paths
    with patch('lectern.config.LOG_SESSION_CONTENT', True):
        # Empty path
        assert _append_session_log("", "stage", [], "resp", True) is None
        
        # Exception during log
        with patch('builtins.open', side_effect=Exception("Disk full")):
            _append_session_log("some.log", "stage", [], "resp", True) # Should not raise
