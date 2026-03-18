from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from gui.backend.main import app
from lectern.config import ConfigManager


client = TestClient(app)


def test_config_manager_exposes_default_ai_provider(isolated_config):
    config = ConfigManager.instance()

    assert config.get("ai_provider") == "gemini"


def test_config_endpoint_exposes_ai_provider_selection():
    response = client.get("/config")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ai_provider"] == ConfigManager.instance().get("ai_provider")


def test_health_endpoint_exposes_provider_metadata():
    with patch(
        "gui.backend.routers.system.anki_connector.check_connection",
        new=AsyncMock(return_value=True),
    ):
        response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["active_provider"] == ConfigManager.instance().get("ai_provider")
    assert isinstance(payload["provider_configured"], bool)
    assert isinstance(payload["provider_ready"], bool)
