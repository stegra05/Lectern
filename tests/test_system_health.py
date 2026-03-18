import os
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from gui.backend.main import app


client = TestClient(app)


def test_health_endpoint_exposes_healthy_diagnostics_signals(isolated_config):
    with patch.dict(os.environ, {"AI_PROVIDER": "gemini"}, clear=False):
        with patch("gui.backend.routers.system.config.GEMINI_API_KEY", "test-api-key"):
            with patch(
                "gui.backend.routers.system.anki_connector.check_connection",
                new=AsyncMock(return_value=True),
            ):
                response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()

    diagnostics = payload["diagnostics"]
    assert diagnostics["anki"]["status"] == "healthy"
    assert diagnostics["provider"]["ready"] is True
    assert diagnostics["api_key"]["configured"] is True


def test_health_endpoint_exposes_anki_unreachable_reason_and_hint(isolated_config):
    with patch.dict(os.environ, {"AI_PROVIDER": "gemini"}, clear=False):
        with patch("gui.backend.routers.system.config.GEMINI_API_KEY", "test-api-key"):
            with patch(
                "gui.backend.routers.system.anki_connector.check_connection",
                new=AsyncMock(side_effect=RuntimeError("AnkiConnect is offline")),
            ):
                response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()

    anki_diagnostics = payload["diagnostics"]["anki"]
    assert anki_diagnostics["status"] in {"offline", "unreachable"}
    assert anki_diagnostics.get("reason") or anki_diagnostics.get("hint")


def test_health_endpoint_exposes_missing_api_key_not_ready_hint(isolated_config):
    with patch.dict(os.environ, {"AI_PROVIDER": "gemini"}, clear=False):
        with patch("gui.backend.routers.system.config.GEMINI_API_KEY", ""):
            with patch(
                "gui.backend.routers.system.anki_connector.check_connection",
                new=AsyncMock(return_value=True),
            ):
                response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()

    provider_diagnostics = payload["diagnostics"]["provider"]
    api_key_diagnostics = payload["diagnostics"]["api_key"]

    assert provider_diagnostics["ready"] is False
    assert api_key_diagnostics["configured"] is False
    assert (
        provider_diagnostics.get("hint")
        or provider_diagnostics.get("reason")
        or api_key_diagnostics.get("hint")
    )
