import os
from unittest.mock import AsyncMock, patch
from pathlib import Path

from fastapi.testclient import TestClient

from gui.backend.main import app
from lectern.config import ConfigManager


client = TestClient(app)


def test_config_manager_exposes_default_ai_provider(isolated_config):
    config = ConfigManager.instance()

    assert config.get("ai_provider") == "gemini"


def test_config_endpoint_exposes_ai_provider_selection(isolated_config):
    response = client.get("/config")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ai_provider"] == ConfigManager.instance().get("ai_provider")


def test_health_endpoint_reports_gemini_readiness_with_api_key(isolated_config):
    with patch.dict(os.environ, {"AI_PROVIDER": "gemini"}, clear=False):
        with patch("gui.backend.routers.system.config.GEMINI_API_KEY", "test-api-key"):
            with patch(
                "gui.backend.routers.system.anki_connector.check_connection",
                new=AsyncMock(return_value=True),
            ):
                response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["active_provider"] == "gemini"
    assert payload["provider_configured"] is True
    assert payload["provider_ready"] is True


def test_health_endpoint_marks_invalid_provider_not_ready(isolated_config):
    with patch.dict(os.environ, {"AI_PROVIDER": "bogus"}, clear=False):
        with patch("gui.backend.routers.system.config.GEMINI_API_KEY", "test-api-key"):
            with patch(
                "gui.backend.routers.system.anki_connector.check_connection",
                new=AsyncMock(return_value=True),
            ):
                response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["active_provider"] == "bogus"
    assert payload["provider_configured"] is False
    assert payload["provider_ready"] is False


def test_clear_logs_endpoint_removes_non_essential_logs_only(tmp_path: Path):
    logs_dir = tmp_path / "logs"
    state_dir = tmp_path / "state"
    logs_dir.mkdir(parents=True, exist_ok=True)
    state_dir.mkdir(parents=True, exist_ok=True)

    backend_log = logs_dir / "backend.log"
    session_log = logs_dir / "session-20260101-000000-000001.json"
    unrelated_log = logs_dir / "notes.log"
    config_file = tmp_path / "user_config.json"
    legacy_db = tmp_path / "lectern.db"
    v2_db = state_dir / "history_v2.sqlite3"

    backend_log.write_text("backend line\n", encoding="utf-8")
    session_log.write_text('{"exchanges":[{"a":1}]}\n', encoding="utf-8")
    unrelated_log.write_text("keep me\n", encoding="utf-8")
    config_file.write_text('{"anki_url":"http://localhost:8765"}\n', encoding="utf-8")
    legacy_db.write_text("legacy-db", encoding="utf-8")
    v2_db.write_text("v2-db", encoding="utf-8")

    with patch("gui.backend.routers.system.get_app_data_dir", return_value=tmp_path):
        response = client.delete("/logs")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "cleared"
    assert payload["deleted_count"] == 2
    deleted = set(payload["deleted_files"])
    assert "logs/backend.log" in deleted
    assert "logs/session-20260101-000000-000001.json" in deleted

    assert backend_log.exists()
    assert backend_log.read_text(encoding="utf-8") == ""
    assert not session_log.exists()
    assert unrelated_log.exists()
    assert config_file.exists()
    assert legacy_db.exists()
    assert v2_db.exists()
