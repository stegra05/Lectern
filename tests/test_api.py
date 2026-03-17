import pytest
import json
import os
import shutil
import tempfile
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi.testclient import TestClient
from gui.backend.main import app
from lectern.lectern_service import LecternGenerationService, ServiceEvent
from gui.backend.dependencies import get_generation_service, get_history_manager

client = TestClient(app)


def _clear_estimate_cache():
    from gui.backend.routers.generation import _estimate_base_cache

    _estimate_base_cache.clear()


class TestGenerationAPI:
    """Tests for the /generate endpoint (SSE)."""

    def test_generate_endpoint_success(self):
        """Test successful card generation stream."""
        files = {"pdf_file": ("test.pdf", b"pdf content", "application/pdf")}
        data = {
            "deck_name": "Test Deck",
            "model_name": "gemini-3-flash",
            "tags": '["tag1", "tag2"]',
        }

        # Events to yield
        mock_events = [
            ServiceEvent("step_start", "Parsing PDF"),
            ServiceEvent("step_end", "Parsing PDF", {"success": True}),
            ServiceEvent("note_created", "Created card", {"id": 1}),
            ServiceEvent("done", "Finished"),
        ]

        async def mock_run(*args, **kwargs):
            for e in mock_events:
                yield e

        with patch("gui.backend.routers.generation.shutil.copyfileobj"):
            with patch(
                "gui.backend.routers.generation.tempfile.NamedTemporaryFile"
            ) as mock_temp:
                mock_temp.return_value.__enter__.return_value.name = "/tmp/fake.pdf"

                mock_service = MagicMock(spec=LecternGenerationService)
                mock_service.run = mock_run

                app.dependency_overrides[get_generation_service] = lambda: mock_service

                try:
                    with patch("gui.backend.dependencies.HistoryManager"):
                        response = client.post("/generate", files=files, data=data)
                        assert response.status_code == 200
                        lines = response.text.splitlines()
                        parsed_events = [
                            json.loads(line) for line in lines if line.strip()
                        ]
                        assert any(e["type"] == "step_start" for e in parsed_events)
                        assert any(e["type"] == "done" for e in parsed_events)
                finally:
                    app.dependency_overrides.clear()

    def test_generate_endpoint_error(self):
        """Test error handling in generation stream."""
        files = {"pdf_file": ("test.pdf", b"pdf content", "application/pdf")}
        data = {"deck_name": "Test Deck"}

        async def mock_run_error(*args, **kwargs):
            yield ServiceEvent("error", "Simulated failure", {"recoverable": False})

        with patch("gui.backend.routers.generation.shutil.copyfileobj"):
            mock_service = MagicMock(spec=LecternGenerationService)
            mock_service.run = mock_run_error
            app.dependency_overrides[get_generation_service] = lambda: mock_service

            try:
                with patch("gui.backend.dependencies.HistoryManager"):
                    response = client.post("/generate", files=files, data=data)
                    assert response.status_code == 200
                    parsed_events = [
                        json.loads(line)
                        for line in response.text.splitlines()
                        if line.strip()
                    ]
                    assert any(e["type"] == "error" for e in parsed_events)
            finally:
                app.dependency_overrides.clear()


class TestEstimationAPI:
    """Tests for the /estimate endpoint."""

    def test_estimate_endpoint_success(self):
        """Test successful cost estimation."""
        _clear_estimate_cache()
        files = {"pdf_file": ("test.pdf", b"pdf content", "application/pdf")}
        data = {"model_name": "gemini-3-flash"}

        result = {
            "tokens": 100,
            "cost": 0.01,
            "pages": 2,
            "estimated_card_count": 5,
            "model": "gemini-3-flash",
        }
        base_data = {
            "token_count": 100,
            "page_count": 2,
            "text_chars": 500,
            "image_count": 0,
            "model": "gemini-3-flash",
        }

        with patch("gui.backend.routers.generation.shutil.copyfileobj"):
            mock_service = MagicMock(spec=LecternGenerationService)
            mock_service.estimate_cost_with_base = AsyncMock(
                return_value=(result, base_data)
            )
            app.dependency_overrides[get_generation_service] = lambda: mock_service

            try:
                response = client.post("/estimate", files=files, data=data)
                assert response.status_code == 200
                res_json = response.json()
                assert res_json["tokens"] == 100
                assert res_json["estimated_card_count"] == 5
            finally:
                app.dependency_overrides.clear()


class TestAnkiAPI:
    """Tests for Anki-related endpoints."""

    def test_anki_status_endpoint(self):
        """Test /anki/status endpoint."""
        with patch(
            "lectern.anki_connector.get_connection_info", new_callable=AsyncMock
        ) as mock_info:
            mock_info.return_value = {
                "connected": True,
                "version": "6",
                "version_ok": True,
                "collection_available": True,
            }
            response = client.get("/anki/status")
            assert response.status_code == 200
            assert response.json()["status"] == "ok"
            assert response.json()["connected"] is True


class TestSystemAPI:
    """Tests for system endpoints."""

    def test_health_check(self):
        """Test /health endpoint."""
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_version_endpoint(self):
        """Test /version endpoint."""
        response = client.get("/version")
        assert response.status_code == 200
        assert "current" in response.json()


class TestHistoryAPI:
    """Tests for history endpoints."""

    def test_get_history_endpoint(self):
        """Test /history endpoint."""
        mock_history_mgr = MagicMock()
        mock_history_mgr.get_all.return_value = [{"id": "1", "filename": "test.pdf"}]

        app.dependency_overrides[get_history_manager] = lambda: mock_history_mgr
        try:
            response = client.get("/history")
            assert response.status_code == 200
            assert len(response.json()) == 1
            assert response.json()[0]["filename"] == "test.pdf"
        finally:
            app.dependency_overrides.clear()
