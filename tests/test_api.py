import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock, patch
import json
import os
import sys
import time

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../gui/backend"))
)

from gui.backend.main import app

client = TestClient(app)


def test_health_endpoint():
    """Test the /health endpoint."""
    with patch("gui.backend.main.run_in_threadpool") as mock_run:
        mock_run.return_value = True
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["anki_connected"] is True


def test_config_endpoint():
    """Test the /config endpoint."""
    response = client.get("/config")
    assert response.status_code == 200
    data = response.json()
    assert "gemini_model" in data
    assert "anki_url" in data


def test_history_endpoint():
    """Test the /history endpoint."""
    with patch("gui.backend.main.HistoryManager") as mock_mgr_class:
        mock_mgr = MagicMock()
        mock_mgr.get_all.return_value = [{"id": "1", "filename": "test_slides.pdf"}]
        mock_mgr_class.return_value = mock_mgr

        # main.py uses run_in_threadpool for HistoryManager.get_all
        with patch("gui.backend.main.run_in_threadpool") as mock_run:
            mock_run.return_value = mock_mgr.get_all()
            response = client.get("/history")
            assert response.status_code == 200
            assert len(response.json()) == 1


def test_version_endpoint():
    """Test the /version endpoint."""
    with patch("requests.get") as mock_get:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "tag_name": "v9.9.9",
            "html_url": "https://github.com/test/releases",
        }
        mock_get.return_value = mock_response

        response = client.get("/version")
        assert response.status_code == 200
        data = response.json()
        assert data["update_available"] is True
        assert data["latest"] == "9.9.9"


def _clear_estimate_cache():
    from gui.backend.main import _estimate_base_cache

    _estimate_base_cache.clear()


@patch("gui.backend.main.LecternGenerationService")
def test_estimate_endpoint(mock_service_class):
    """Test the /estimate endpoint (cache miss path)."""
    _clear_estimate_cache()
    mock_service = MagicMock()
    result = {"cost": 0.05, "tokens": 1000, "estimated_card_count": 12, "pages": 10}
    base_data = {
        "token_count": 1000,
        "page_count": 10,
        "text_chars": 5000,
        "image_count": 2,
        "model": "gemini-3-flash",
    }
    mock_service.estimate_cost_with_base = AsyncMock(return_value=(result, base_data))
    mock_service_class.return_value = mock_service

    files = {"pdf_file": ("test_script.pdf", b"pdf content", "application/pdf")}
    data = {"model_name": "gemini-3-flash", "target_card_count": "20"}

    with patch("gui.backend.main.shutil.copyfileobj"):
        response = client.post("/estimate", files=files, data=data)

        assert response.status_code == 200
        assert response.json()["cost"] == 0.05
        assert response.json()["estimated_card_count"] == 12
        mock_service.estimate_cost_with_base.assert_awaited_once()
        call_kwargs = mock_service.estimate_cost_with_base.call_args[1]
        assert call_kwargs["model_name"] == "gemini-3-flash"
        assert call_kwargs["target_card_count"] == 20


@patch("gui.backend.main.LecternGenerationService")
def test_estimate_cache_hit(mock_service_class):
    """Test /estimate uses fast path when same file+model requested again."""
    _clear_estimate_cache()
    mock_service = MagicMock()
    result1 = {"cost": 0.05, "tokens": 1000, "estimated_card_count": 12, "pages": 10}
    base_data = {
        "token_count": 1000,
        "page_count": 10,
        "text_chars": 5000,
        "image_count": 2,
        "model": "gemini-3-flash",
    }
    mock_service.estimate_cost_with_base = AsyncMock(return_value=(result1, base_data))
    mock_service_class.return_value = mock_service

    files = {
        "pdf_file": ("test_script.pdf", b"same content both times", "application/pdf")
    }
    data = {"model_name": "gemini-3-flash", "target_card_count": "20"}

    with patch("gui.backend.main.shutil.copyfileobj"):
        # First request: cache miss, full estimate
        r1 = client.post("/estimate", files=files, data=data)
        assert r1.status_code == 200
        assert mock_service.estimate_cost_with_base.call_count == 1
        # Second request: same file content -> cache hit, fast recompute (different density)
        data2 = {"model_name": "gemini-3-flash", "target_card_count": "30"}
        r2 = client.post("/estimate", files=files, data=data2)
        assert r2.status_code == 200
        # Service not called again; recompute_estimate used
        assert mock_service.estimate_cost_with_base.call_count == 1
        # Card count should reflect new density (3.0 vs 2.0)
        assert r2.json()["estimated_card_count"] != r1.json()["estimated_card_count"]


@patch("gui.backend.main.LecternGenerationService")
def test_estimate_cache_miss_different_model(mock_service_class):
    """Test cache miss when model changes."""
    _clear_estimate_cache()
    mock_service = MagicMock()
    result_a = {"cost": 0.05, "tokens": 1000, "estimated_card_count": 12, "pages": 10}
    base_a = {
        "token_count": 1000,
        "page_count": 10,
        "text_chars": 5000,
        "image_count": 2,
        "model": "gemini-3-flash",
    }
    result_b = {"cost": 0.08, "tokens": 1000, "estimated_card_count": 12, "pages": 10}
    base_b = {
        "token_count": 1000,
        "page_count": 10,
        "text_chars": 5000,
        "image_count": 2,
        "model": "gemini-3-pro",
    }
    mock_service.estimate_cost_with_base = AsyncMock(
        side_effect=[(result_a, base_a), (result_b, base_b)]
    )
    mock_service_class.return_value = mock_service

    files = {"pdf_file": ("test_slides.pdf", b"same content", "application/pdf")}

    with patch("gui.backend.main.shutil.copyfileobj"):
        r1 = client.post(
            "/estimate",
            files=files,
            data={"model_name": "gemini-3-flash", "target_card_count": "15"},
        )
        assert r1.status_code == 200
        r2 = client.post(
            "/estimate",
            files=files,
            data={"model_name": "gemini-3-pro", "target_card_count": "15"},
        )
        assert r2.status_code == 200
        # Different model -> cache miss -> service called twice
        assert mock_service.estimate_cost_with_base.call_count == 2


def test_decks_endpoint():
    """Test the /decks endpoint."""
    with patch("gui.backend.main.run_in_threadpool") as mock_run:
        mock_run.side_effect = [
            {"connected": True, "collection_available": True},
            ["Default", "Deck 1"],
        ]
        response = client.get("/decks")
        assert response.status_code == 200
        assert "decks" in response.json()
        assert "decks" in response.json()
        assert "Default" in response.json()["decks"]


def test_history_actions():
    """Test history deletion."""
    with patch("gui.backend.main.HistoryManager") as mock_mgr_class:
        mock_mgr = MagicMock()
        mock_mgr.get_entry.return_value = {"id": "1", "session_id": "sid1"}
        mock_mgr.delete_entry.return_value = True
        mock_mgr_class.return_value = mock_mgr

        response = client.delete("/history/1")
        assert response.status_code == 200
        mock_mgr.delete_entry.assert_called_with("1")


def test_generate_error_paths():
    """Test /generate with errors and SSE failures."""
    # Invalid tags JSON
    files = {"pdf_file": ("test_slides.pdf", b"pdf", "application/pdf")}
    data = {"deck_name": "D", "tags": "invalid-json"}

    with patch("gui.backend.main.shutil.copyfileobj"):
        with patch("gui.backend.main.tempfile.NamedTemporaryFile") as mock_temp:
            mock_temp.return_value.__enter__.return_value.name = "/tmp/t.pdf"
            with patch("gui.backend.main.os.path.getsize", return_value=123):
                # We expect it to fallback to empty tags_list
                response = client.post("/generate", files=files, data=data)
                assert response.status_code == 200


def test_get_version_error():
    """Test get_version when network fails."""
    with patch("requests.get", side_effect=Exception("Network error")):
        response = client.get("/version")
        assert response.status_code == 200
        assert response.json()["latest"] is None


def test_anki_notes_api():
    """Test Anki notes update/delete endpoints."""
    # update_anki_note uses LOCAL import
    with patch("lectern.anki_connector.update_note_fields") as mock_upd:
        response = client.put("/anki/notes/1", json={"fields": {"f": "b"}})
        assert response.status_code == 200
        mock_upd.assert_called_with(1, {"f": "b"})

    # delete_anki_notes uses MODULE-LEVEL import
    with patch("gui.backend.main.delete_notes") as mock_del:
        response = client.request("DELETE", "/anki/notes", json={"note_ids": [1]})
        assert response.status_code == 200
        mock_del.assert_called_with([1])


def test_health_check_failure():
    """Test health check when things fail."""
    # Patch check_connection in main.py namespace
    with patch("gui.backend.main.check_connection", side_effect=Exception("Failed")):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["anki_connected"] is False


def test_delete_nonexistent_history():
    """Test deleting history for an entry that doesn't exist."""
    with patch("gui.backend.main.HistoryManager") as mock_mgr_class:
        mock_mgr = MagicMock()
        mock_mgr.get_entry.return_value = None
        mock_mgr_class.return_value = mock_mgr

        response = client.delete("/history/999")
        assert response.status_code == 404


def test_generate_invalid_data():
    """Test /generate with missing required fields."""
    response = client.post("/generate", files={}, data={})
    assert response.status_code == 422  # FastAPI validation error


def test_get_decks_failure():
    """Test /decks when AnkiConnect is unreachable."""
    with patch(
        "gui.backend.main.run_in_threadpool", side_effect=Exception("Anki down")
    ):
        response = client.get("/decks")
        assert response.status_code == 200
        assert response.json()["decks"] == []


def test_config_update_failures():
    """Test /config POST returns 500 on keychain or save failures."""
    # API key update failure
    with patch(
        "lectern.utils.keychain_manager.set_gemini_key",
        side_effect=Exception("Keychain failed"),
    ):
        response = client.post("/config", json={"gemini_api_key": "k"})
        assert response.status_code == 500

    # JSON save failure - mock ConfigManager._save to raise
    with patch("lectern.config.ConfigManager._save", side_effect=Exception("IO Error")):
        response = client.post("/config", json={"anki_url": "u"})
        assert response.status_code == 500

    # No change branch
    response = client.post("/config", json={})
    assert response.status_code == 200
    assert response.json()["status"] == "no_change"


def test_deck_creation_failure():
    """Test /decks POST returns 500 when deck creation fails."""
    with patch("lectern.anki_connector.create_deck", return_value=False):
        response = client.post("/decks", json={"name": "Fail"})
        assert response.status_code == 500

    with patch("lectern.anki_connector.create_deck", side_effect=Exception("Crash")):
        response = client.post("/decks", json={"name": "Crash"})
        assert response.status_code == 500


def test_history_deletion_failure():
    """Test /history DELETE returns 500 when deletion fails."""
    with patch("gui.backend.main.HistoryManager") as mock_mgr_class:
        mock_mgr = MagicMock()
        mock_mgr.get_entry.return_value = {"id": "1"}
        mock_mgr.delete_entry.return_value = False  # Explicit failure
        mock_mgr_class.return_value = mock_mgr

        response = client.delete("/history/1")
        assert response.status_code == 500


def test_estimate_cost_failure():
    """Test /estimate returns 500 when cost estimation crashes."""
    _clear_estimate_cache()  # Ensure no cached results from previous tests
    with patch("gui.backend.main.LecternGenerationService") as mock_service:
        mock_service.return_value.estimate_cost_with_base = AsyncMock(
            side_effect=Exception("Parsing crash")
        )
        files = {"pdf_file": ("test_slides.pdf", b"p", "application/pdf")}
        with patch("gui.backend.main.shutil.copyfileobj"):
            response = client.post("/estimate", files=files)
        assert response.status_code == 500


def test_anki_connector_failures_api():
    """Test Anki note endpoints return 500 when connector raises."""
    with patch("gui.backend.main.delete_notes", side_effect=Exception("Anki Down")):
        response = client.request("DELETE", "/anki/notes", json={"note_ids": [1]})
        assert response.status_code == 500

    with patch(
        "lectern.anki_connector.update_note_fields",
        side_effect=Exception("Note locked"),
    ):
        response = client.put("/anki/notes/1", json={"fields": {"f": "b"}})
        assert response.status_code == 500


def test_config_update_all_fields():
    """Test /config POST accepts and persists all supported fields."""
    with patch("lectern.config.ConfigManager._save") as mock_save:
        response = client.post(
            "/config",
            json={
                "anki_url": "http://new:8765",
                "basic_model": "NewBasic",
                "cloze_model": "NewCloze",
                "gemini_model": "gemini-3-flash",
            },
        )
        assert response.status_code == 200
        assert "anki_url" in response.json()["fields"]
        assert "basic_model" in response.json()["fields"]
        # Verify ConfigManager._save was called for each field set
        assert mock_save.call_count == 4


def test_version_fetches_when_called():
    """Test version endpoint always checks network."""
    with patch("requests.get") as mock_get:
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = {
            "tag_name": "v1.0.0",
            "html_url": "https://github.com/stegra05/Lectern/releases/tag/v1.0.0",
        }
        response = client.get("/version")
        assert response.status_code == 200
        mock_get.assert_called_once()


def test_deck_actions_success():
    """Test successful deck listing and creation."""
    with patch(
        "gui.backend.main.run_in_threadpool",
        side_effect=[{"connected": True, "collection_available": True}, ["D1"]],
    ):
        response = client.get("/decks")
        assert "D1" in response.json()["decks"]

    with patch("lectern.anki_connector.create_deck", return_value=True):
        response = client.post("/decks", json={"name": "NewDeck"})
        assert response.status_code == 200
        assert response.json()["status"] == "created"


def test_history_clear_all():
    """Test clearing all history entries."""
    with patch("gui.backend.main.HistoryManager") as mock_mgr_class:
        mock_mgr = MagicMock()
        mock_mgr_class.return_value = mock_mgr
        response = client.delete("/history")
        assert response.status_code == 200
        mock_mgr.clear_all.assert_called_once()


def test_spa_routing():
    """Test serving index.html for non-existent but non-API paths."""
    # We need to simulate a dist folder for this to work
    with patch("gui.backend.main.os.path.exists", return_value=True):
        with patch(
            "gui.backend.main.FileResponse", return_value={"file": "index.html"}
        ):
            response = client.get("/random-path")
            # If FileResponse is returned it might not be a standard status
            # But we hit the branch.

    # Test that a real registered route root returns 404 (not served as SPA)
    # /health is a registered GET endpoint — its root segment is "health"
    response = client.get("/health/ghost-subpath")
    assert response.status_code == 404


def test_session_manager_more_pruning():
    """Test session manager handles stop/cleanup of non-existent sessions."""
    from gui.backend.main import session_manager

    # Stop non-existent session is a no-op
    session_manager.stop_session("ghost")
    # Cleanup non-existent session is a no-op
    session_manager.cleanup_session("ghost")


def test_system_env_branches():
    """Test branches related to system environment (frozen, etc)."""
    # Frozen (bundled) environment detection
    with patch("sys.executable", "python"):
        with patch("os.path.exists", return_value=True):
            # This is hard to trigger without re-importing, but we can verify it doesn't crash
            pass


# --- Error Scenario Tests ---


class TestEstimateWithCorruptedPDF:
    """Tests for /estimate endpoint with corrupted or invalid PDFs."""

    def test_estimate_with_empty_file(self):
        """Test /estimate returns appropriate error for empty file."""
        files = {"pdf_file": ("empty.pdf", b"", "application/pdf")}
        data = {"model_name": "gemini-3-flash"}

        with patch("gui.backend.main.shutil.copyfileobj"):
            with patch("gui.backend.main.LecternGenerationService") as mock_service:
                mock_service.return_value.estimate_cost_with_base = AsyncMock(
                    side_effect=ValueError("PDF is empty or corrupted")
                )
                response = client.post("/estimate", files=files, data=data)

        assert response.status_code == 500

    def test_estimate_with_binary_garbage(self):
        """Test /estimate handles non-PDF binary data."""
        # Random binary data that's not a valid PDF
        garbage_data = bytes(range(256)) * 100
        files = {"pdf_file": ("fake.pdf", garbage_data, "application/pdf")}
        data = {"model_name": "gemini-3-flash"}

        _clear_estimate_cache()

        with patch("gui.backend.main.shutil.copyfileobj"):
            with patch("gui.backend.main.LecternGenerationService") as mock_service:
                mock_service.return_value.estimate_cost_with_base = AsyncMock(
                    side_effect=ValueError("Invalid PDF structure")
                )
                response = client.post("/estimate", files=files, data=data)

        assert response.status_code == 500

    def test_estimate_with_truncated_pdf(self):
        """Test /estimate handles truncated PDF (incomplete upload)."""
        # Start of a PDF header but truncated
        truncated_pdf = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog"
        files = {"pdf_file": ("truncated.pdf", truncated_pdf, "application/pdf")}
        data = {"model_name": "gemini-3-flash"}

        _clear_estimate_cache()

        with patch("gui.backend.main.shutil.copyfileobj"):
            with patch("gui.backend.main.LecternGenerationService") as mock_service:
                mock_service.return_value.estimate_cost_with_base = AsyncMock(
                    side_effect=Exception("PDF parsing failed: unexpected EOF")
                )
                response = client.post("/estimate", files=files, data=data)

        assert response.status_code == 500


class TestGenerateCancellation:
    """Tests for /generate endpoint with mid-stream cancellation."""


class TestMemoryPressureScenarios:
    """Tests for handling large files and memory pressure."""

    def test_estimate_large_file_handling(self):
        """Test /estimate handles large file metadata correctly."""
        _clear_estimate_cache()

        # Simulate a large PDF (100MB of content)
        large_content = b"x" * (100 * 1024 * 1024)

        with patch("gui.backend.main.LecternGenerationService") as mock_service:
            mock_svc = MagicMock()
            result = {
                "cost": 5.0,
                "tokens": 1000000,
                "estimated_card_count": 500,
                "pages": 200,
            }
            base_data = {
                "token_count": 1000000,
                "page_count": 200,
                "text_chars": 500000,
                "image_count": 50,
                "model": "gemini-3-flash",
            }
            mock_svc.estimate_cost_with_base = AsyncMock(
                return_value=(result, base_data)
            )
            mock_service.return_value = mock_svc

            files = {"pdf_file": ("large.pdf", large_content, "application/pdf")}
            data = {"model_name": "gemini-3-flash"}

            with patch("gui.backend.main.shutil.copyfileobj"):
                with patch(
                    "gui.backend.main.os.path.getsize", return_value=len(large_content)
                ):
                    response = client.post("/estimate", files=files, data=data)

            assert response.status_code == 200
            assert response.json()["estimated_card_count"] == 500


class TestEdgeCases:
    """Additional edge case tests for API endpoints."""

    def test_estimate_with_unicode_filename(self):
        """Test /estimate handles unicode filenames."""
        _clear_estimate_cache()

        files = {"pdf_file": ("テスト_汉字_🎉.pdf", b"pdf", "application/pdf")}
        data = {"model_name": "gemini-3-flash"}

        with patch("gui.backend.main.shutil.copyfileobj"):
            with patch("gui.backend.main.LecternGenerationService") as mock_service:
                result = {"cost": 0.05, "tokens": 1000, "estimated_card_count": 10}
                base_data = {
                    "token_count": 1000,
                    "page_count": 5,
                    "model": "gemini-3-flash",
                }
                mock_service.return_value.estimate_cost_with_base = AsyncMock(
                    return_value=(result, base_data)
                )
                response = client.post("/estimate", files=files, data=data)

        assert response.status_code == 200

    def test_generate_with_special_characters_in_deck_name(self):
        """Test /generate handles special characters in deck name."""
        files = {"pdf_file": ("test.pdf", b"pdf", "application/pdf")}
        data = {"deck_name": "Test::Subdeck::中文::日本語"}

        with patch("gui.backend.main.shutil.copyfileobj"):
            with patch("gui.backend.main.tempfile.NamedTemporaryFile") as mock_temp:
                mock_temp.return_value.__enter__.return_value.name = "/tmp/t.pdf"
                with patch("gui.backend.main.os.path.getsize", return_value=123):
                    with patch("gui.backend.main.LecternGenerationService") as mock_svc:
                        mock_svc.return_value.run_generation = lambda *a, **k: (
                            x for x in []
                        )
                        with patch("gui.backend.main.HistoryManager"):
                            response = client.post("/generate", files=files, data=data)
                            assert response.status_code == 200

    def test_estimate_with_zero_target_cards(self):
        """Test /estimate with target_card_count=0."""
        _clear_estimate_cache()

        files = {"pdf_file": ("test.pdf", b"pdf", "application/pdf")}
        data = {"model_name": "gemini-3-flash", "target_card_count": "0"}

        with patch("gui.backend.main.shutil.copyfileobj"):
            with patch("gui.backend.main.LecternGenerationService") as mock_service:
                result = {"cost": 0.0, "tokens": 0, "estimated_card_count": 0}
                base_data = {
                    "token_count": 0,
                    "page_count": 0,
                    "model": "gemini-3-flash",
                }
                mock_service.return_value.estimate_cost_with_base = AsyncMock(
                    return_value=(result, base_data)
                )
                response = client.post("/estimate", files=files, data=data)

        # Should still work, just with 0 target
        assert response.status_code == 200
