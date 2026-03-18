import os
from unittest.mock import AsyncMock, patch

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
