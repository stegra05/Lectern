import pytest
from lectern.ai_common import (
    _infer_mime_type,
    _compose_multimodal_content,
    _build_loggable_parts,
    _start_session_log,
    _append_session_log,
    _cleanup_stale_empty_session_logs,
)
from unittest.mock import MagicMock, patch, mock_open
from lectern import config
import json
import os
from pathlib import Path


def test_infer_mime_type():
    assert _infer_mime_type(b"\x89PNG\r\n\x1a\n") == "image/png"
    assert _infer_mime_type(b"\xff\xd8\xff") == "image/jpeg"
    assert _infer_mime_type(b"GIF87a") == "image/gif"
    assert _infer_mime_type(b"GIF89a") == "image/gif"
    assert _infer_mime_type(b"RIFFsomeWEBP") == "image/webp"
    assert _infer_mime_type(b"unknown") == "application/octet-stream"


def test_compose_multimodal_content():
    pages = [
        {"text": "page1", "images": [b"img1"]},
        {"text": "  ", "images": []},  # Empty text
    ]
    with patch("lectern.ai_common.types.Part.from_bytes") as mock_part:
        mock_part.return_value = "part_obj"
        parts = _compose_multimodal_content(pages, "prompt")
        assert len(parts) == 3  # prompt, text1, img1
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
        123,  # Unknown type
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
    with patch("lectern.config.LOG_SESSION_CONTENT", True):
        with patch("lectern.utils.path_utils.get_app_data_dir") as mock_dir:
            from pathlib import Path

            temp_dir = Path("/tmp/lectern_test_logs")
            mock_dir.return_value = temp_dir
            with patch("pathlib.Path.mkdir"):
                with patch("builtins.open", mock_open()) as m_open:
                    path = _start_session_log()
                    assert "session-" in path
                    assert "json" in path

    # Test _append_session_log error paths
    with patch("lectern.config.LOG_SESSION_CONTENT", True):
        # Empty path
        assert _append_session_log("", "stage", [], "resp", True) is None

        # Exception during log
        with patch("builtins.open", side_effect=Exception("Disk full")):
            _append_session_log(
                "some.log", "stage", [], "resp", True
            )  # Should not raise


def test_session_log_created_on_first_append(tmp_path):
    with patch("lectern.config.LOG_SESSION_CONTENT", True), patch(
        "lectern.utils.path_utils.get_app_data_dir", return_value=tmp_path
    ):
        log_path = _start_session_log()
        path_obj = Path(log_path)
        assert not path_obj.exists()

        _append_session_log(
            log_path=log_path,
            stage="generation",
            parts=[{"text": "prompt"}],
            response_text="{}",
            schema_used=True,
        )

        assert path_obj.exists()
        payload = json.loads(path_obj.read_text(encoding="utf-8"))
        assert isinstance(payload.get("exchanges"), list)
        assert len(payload["exchanges"]) == 1


def test_cleanup_stale_empty_session_logs(tmp_path):
    stale_empty = tmp_path / "session-stale-empty.json"
    stale_full = tmp_path / "session-stale-full.json"
    fresh_empty = tmp_path / "session-fresh-empty.json"

    stale_empty.write_text(
        json.dumps({"timestamp_utc": "old", "exchanges": []}), encoding="utf-8"
    )
    stale_full.write_text(
        json.dumps({"timestamp_utc": "old", "exchanges": [{"stage": "x"}]}),
        encoding="utf-8",
    )
    fresh_empty.write_text(
        json.dumps({"timestamp_utc": "new", "exchanges": []}), encoding="utf-8"
    )

    old_ts = 1
    os.utime(stale_empty, (old_ts, old_ts))
    os.utime(stale_full, (old_ts, old_ts))

    _cleanup_stale_empty_session_logs(tmp_path, max_age_seconds=60)

    assert not stale_empty.exists()
    assert stale_full.exists()
    assert fresh_empty.exists()
