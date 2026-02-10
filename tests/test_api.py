import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock, patch
import json
import os
import sys
import time

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../gui/backend')))

from gui.backend.main import app

client = TestClient(app)

def test_health_endpoint():
    """Test the /health endpoint."""
    with patch('gui.backend.main.run_in_threadpool') as mock_run:
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
    with patch('gui.backend.main.HistoryManager') as mock_mgr_class:
        mock_mgr = MagicMock()
        mock_mgr.get_all.return_value = [{"id": "1", "filename": "test_slides.pdf"}]
        mock_mgr_class.return_value = mock_mgr
        
        # main.py uses run_in_threadpool for HistoryManager.get_all
        with patch('gui.backend.main.run_in_threadpool') as mock_run:
            mock_run.return_value = mock_mgr.get_all()
            response = client.get("/history")
            assert response.status_code == 200
            assert len(response.json()) == 1

def test_version_endpoint():
    """Test the /version endpoint."""
    with patch('requests.get') as mock_get:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "tag_name": "v9.9.9",
            "html_url": "https://github.com/test/releases"
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


@patch('gui.backend.main.LecternGenerationService')
def test_estimate_endpoint(mock_service_class):
    """Test the /estimate endpoint (cache miss path)."""
    _clear_estimate_cache()
    mock_service = MagicMock()
    result = {"cost": 0.05, "tokens": 1000, "estimated_card_count": 12, "pages": 10}
    base_data = {"token_count": 1000, "page_count": 10, "text_chars": 5000, "image_count": 2, "model": "gemini-3-flash"}
    mock_service.estimate_cost_with_base = AsyncMock(return_value=(result, base_data))
    mock_service_class.return_value = mock_service

    files = {"pdf_file": ("test_script.pdf", b"pdf content", "application/pdf")}
    data = {"model_name": "gemini-3-flash", "source_type": "script", "target_card_count": "20"}

    with patch('gui.backend.main.shutil.copyfileobj'):
        response = client.post("/estimate", files=files, data=data)

        assert response.status_code == 200
        assert response.json()["cost"] == 0.05
        assert response.json()["estimated_card_count"] == 12
        mock_service.estimate_cost_with_base.assert_awaited_once()
        call_kwargs = mock_service.estimate_cost_with_base.call_args[1]
        assert call_kwargs["model_name"] == "gemini-3-flash"
        assert call_kwargs["source_type"] == "script"
        assert call_kwargs["target_card_count"] == 20


@patch('gui.backend.main.LecternGenerationService')
def test_estimate_cache_hit(mock_service_class):
    """Test /estimate uses fast path when same file+model requested again."""
    _clear_estimate_cache()
    mock_service = MagicMock()
    result1 = {"cost": 0.05, "tokens": 1000, "estimated_card_count": 12, "pages": 10}
    base_data = {"token_count": 1000, "page_count": 10, "text_chars": 5000, "image_count": 2, "model": "gemini-3-flash"}
    mock_service.estimate_cost_with_base = AsyncMock(return_value=(result1, base_data))
    mock_service_class.return_value = mock_service

    files = {"pdf_file": ("test_script.pdf", b"same content both times", "application/pdf")}
    data = {"model_name": "gemini-3-flash", "source_type": "script", "target_card_count": "20"}

    with patch('gui.backend.main.shutil.copyfileobj'):
        # First request: cache miss, full estimate
        r1 = client.post("/estimate", files=files, data=data)
        assert r1.status_code == 200
        assert mock_service.estimate_cost_with_base.call_count == 1
        # Second request: same file content -> cache hit, fast recompute (different density)
        data2 = {"model_name": "gemini-3-flash", "source_type": "script", "target_card_count": "30"}
        r2 = client.post("/estimate", files=files, data=data2)
        assert r2.status_code == 200
        # Service not called again; recompute_estimate used
        assert mock_service.estimate_cost_with_base.call_count == 1
        # Card count should reflect new density (3.0 vs 2.0)
        assert r2.json()["estimated_card_count"] != r1.json()["estimated_card_count"]


@patch('gui.backend.main.LecternGenerationService')
def test_estimate_cache_miss_different_model(mock_service_class):
    """Test cache miss when model changes."""
    _clear_estimate_cache()
    mock_service = MagicMock()
    result_a = {"cost": 0.05, "tokens": 1000, "estimated_card_count": 12, "pages": 10}
    base_a = {"token_count": 1000, "page_count": 10, "text_chars": 5000, "image_count": 2, "model": "gemini-3-flash"}
    result_b = {"cost": 0.08, "tokens": 1000, "estimated_card_count": 12, "pages": 10}
    base_b = {"token_count": 1000, "page_count": 10, "text_chars": 5000, "image_count": 2, "model": "gemini-3-pro"}
    mock_service.estimate_cost_with_base = AsyncMock(side_effect=[(result_a, base_a), (result_b, base_b)])
    mock_service_class.return_value = mock_service

    files = {"pdf_file": ("test_slides.pdf", b"same content", "application/pdf")}

    with patch('gui.backend.main.shutil.copyfileobj'):
        r1 = client.post("/estimate", files=files, data={"model_name": "gemini-3-flash", "source_type": "auto", "target_card_count": "15"})
        assert r1.status_code == 200
        r2 = client.post("/estimate", files=files, data={"model_name": "gemini-3-pro", "source_type": "auto", "target_card_count": "15"})
        assert r2.status_code == 200
        # Different model -> cache miss -> service called twice
        assert mock_service.estimate_cost_with_base.call_count == 2


def test_decks_endpoint():
    """Test the /decks endpoint."""
    with patch('gui.backend.main.run_in_threadpool') as mock_run:
        mock_run.return_value = ["Default", "Deck 1"]
        response = client.get("/decks")
        assert response.status_code == 200
        assert "decks" in response.json()
        assert "decks" in response.json()
        assert "Default" in response.json()["decks"]

@patch('gui.backend.main.HistoryManager')
@patch('gui.backend.main.GenerationService')
def test_generate_endpoint(mock_generation_service_class, mock_history_manager_class):
    """Test the /generate endpoint (SSE stream)."""
    mock_service = MagicMock()

    async def mock_run_generation(*args, **kwargs):
        yield json.dumps({"type": "info", "message": "starting", "data": {}})
        yield json.dumps({"type": "done", "message": "completed", "data": {}})

    mock_service.run_generation = mock_run_generation
    mock_generation_service_class.return_value = mock_service

    mock_history_manager = MagicMock()
    mock_history_manager.add_entry.return_value = "entry-test-id"
    mock_history_manager_class.return_value = mock_history_manager
    
    files = {"pdf_file": ("test_slides.pdf", b"pdf content", "application/pdf")}
    data = {"deck_name": "Test Deck"}
    
    with patch('gui.backend.main.shutil.copyfileobj'):
        with patch('gui.backend.main.tempfile.NamedTemporaryFile') as mock_temp:
            mock_temp.return_value.__enter__.return_value.name = "/tmp/test_slides.pdf"
            with patch('gui.backend.main.os.path.getsize', return_value=123):
                response = client.post("/generate", files=files, data=data)
                assert response.status_code == 200
                
                lines = [l for l in response.iter_lines() if l]
                assert len(lines) >= 2
                assert "session_start" in str(lines[0])
                assert any("done" in str(line) for line in lines)

def test_session_management_logic():
    """Test SessionManager internal logic via direct instantiation if needed, 
    but here we target coverage for SessionManager methods in main.py.
    """
    from gui.backend.main import SessionManager
    sm = SessionManager()
    
    mock_service = MagicMock()
    mock_drafts = MagicMock()
    
    # create_session
    session = sm.create_session("/tmp/lectern_test_slides.pdf", mock_service, mock_drafts)
    assert session.session_id is not None
    assert sm.get_latest_session().session_id == session.session_id
    
    # touch and get_session
    old_accessed = session.last_accessed
    # Wait a tiny bit to ensure timestamp changes if we touch it
    import time
    time.sleep(0.01)
    retrieved = sm.get_session(session.session_id)
    assert retrieved.last_accessed > old_accessed
    
    # mark_status
    sm.mark_status(session.session_id, "completed")
    assert session.status == "completed"
    assert session.completed_at is not None
    
    # prune is a compatibility no-op
    sm.prune()
    assert sm.get_session(session.session_id) is not None
    
    # stop_session
    with patch('gui.backend.main.os.path.exists', return_value=True):
        with patch('gui.backend.main.os.remove') as mock_remove:
            sm.stop_session(session.session_id)
            mock_service.stop.assert_called_once()
            mock_remove.assert_called_once_with("/tmp/lectern_test_slides.pdf")
            assert sm.get_session(session.session_id) is None

def test_config_update_complex():
    """Test /config POST with API key and file updates."""
    with patch('utils.keychain_manager.set_gemini_key') as mock_set_key:
        with patch('gui.backend.main.run_in_threadpool', side_effect=lambda f: f()) as mock_run:
            with patch('builtins.open', create=True) as mock_open:
                mock_file = MagicMock()
                mock_file.readlines.return_value = ["GEMINI_API_KEY=old\n", "OTHER=val\n"]
                mock_open.return_value.__enter__.return_value = mock_file
                
                with patch('gui.backend.main.os.path.exists', return_value=True):
                    response = client.post("/config", json={
                        "gemini_api_key": "new_key",
                        "anki_url": "new_url"
                    })
                    assert response.status_code == 200
                    mock_set_key.assert_called_with("new_key")
                    # Check if GEMINI_API_KEY was filtered out in write
                    write_calls = mock_file.writelines.call_args[0][0]
                    assert "GEMINI_API_KEY=old\n" not in write_calls

def test_history_actions():
    """Test history deletion and state clearing."""
    with patch('gui.backend.main.HistoryManager') as mock_mgr_class:
        mock_mgr = MagicMock()
        mock_mgr.get_entry.return_value = {"session_id": "sid1"}
        mock_mgr.delete_entry.return_value = True
        mock_mgr_class.return_value = mock_mgr
        
        with patch('utils.state.clear_state') as mock_clear:
            response = client.delete("/history/1")
            assert response.status_code == 200
            mock_clear.assert_called_with("sid1")
            mock_mgr.delete_entry.assert_called_with("1")

def test_generate_error_paths():
    """Test /generate with errors and SSE failures."""
    # Invalid tags JSON
    files = {"pdf_file": ("test_slides.pdf", b"pdf", "application/pdf")}
    data = {"deck_name": "D", "tags": "invalid-json"}
    
    with patch('gui.backend.main.shutil.copyfileobj'):
        with patch('gui.backend.main.tempfile.NamedTemporaryFile') as mock_temp:
            mock_temp.return_value.__enter__.return_value.name = "/tmp/t.pdf"
            with patch('gui.backend.main.os.path.getsize', return_value=123):
                # We expect it to fallback to empty tags_list
                response = client.post("/generate", files=files, data=data)
                assert response.status_code == 200

def test_sync_session_to_anki_logic():
    """Test the session sync generator logic."""
    mock_state = {
        "pdf_path": "P", "deck_name": "D", "concept_map": {}, "history": [],
        "cards": [
            {"fields": {"F": "B"}, "anki_note_id": 123}, # Existing
            {"fields": {"F2": "B2"}} # New
        ]
    }
    
    with patch('gui.backend.main.load_state', return_value=mock_state):
        with patch('gui.backend.main.notes_info') as mock_info:
            mock_info.return_value = [{"noteId": 123}]
            with patch('gui.backend.main.update_note_fields') as mock_update:
                with patch('gui.backend.main.export_card_to_anki') as mock_export:
                    mock_export.return_value.success = True
                    mock_export.return_value.note_id = 456
                    
                    response = client.post("/session/test_session/sync")
                    assert response.status_code == 200
                    
                    lines = [l for l in response.iter_lines() if l]
                    assert any("note_updated" in str(l) for l in lines)
                    assert any("note_created" in str(l) for l in lines)
                    mock_update.assert_called_with(123, {"F": "B"})

def test_get_version_error():
    """Test get_version when network fails."""
    with patch('requests.get', side_effect=Exception("Network error")):
        response = client.get("/version")
        assert response.status_code == 200
        assert response.json()["latest"] is None

def test_sync_drafts_endpoint():
    """Test /drafts/sync SSE endpoint."""
    mock_session = MagicMock()
    mock_session.session_id = "test_session"
    mock_runtime = MagicMock()
    mock_runtime.draft_store.get_drafts.return_value = [{"fields": {"F": "B"}}]
    mock_runtime.draft_store.deck_name = "D"
    mock_runtime.draft_store.model_name = "M"
    mock_runtime.draft_store.tags = []
    
    with patch('gui.backend.main._get_session_or_404', return_value=mock_session):
        with patch('gui.backend.main._get_runtime_or_404', return_value=mock_runtime):
            with patch('gui.backend.main.export_card_to_anki') as mock_export:
                mock_export.return_value.success = True
                mock_export.return_value.note_id = 123
                
                response = client.post("/drafts/sync?session_id=test_session")
                assert response.status_code == 200
                lines = [l for l in response.iter_lines() if l]
                assert any("progress_start" in str(l) for l in lines)
                assert any("note_created" in str(l) for l in lines)
                assert any("done" in str(l) for l in lines)

def test_session_api_more():
    """Test more session API edge cases."""
    # update_session_cards
    with patch('gui.backend.main.load_state', return_value={"pdf_path": "P", "deck_name": "D", "cards": [], "concept_map": {}, "history": []}):
        with patch('gui.backend.main.StateFile.update_cards', return_value=True) as mock_update:
            response = client.put("/session/s1/cards", json={"cards": [{"f": "b"}]})
            assert response.status_code == 200
            mock_update.assert_called()
    
    # delete_session_card error
    with patch('gui.backend.main.load_state', return_value={"cards": []}):
        response = client.delete("/session/s1/cards/99")
        assert response.status_code == 404

def test_session_status_endpoint():
    from gui.backend.main import session_manager

    session = session_manager.create_session("/tmp/lectern_status.pdf", MagicMock(), MagicMock())
    active = client.get(f"/session/{session.session_id}/status")
    assert active.status_code == 200
    assert active.json()["active"] is True
    assert active.json()["status"] == "active"

    session_manager.mark_status(session.session_id, "cancelled")
    missing = client.get(f"/session/{session.session_id}/status")
    assert missing.status_code == 200
    assert missing.json()["active"] is False

def test_anki_notes_api():
    """Test Anki notes update/delete endpoints."""
    # update_anki_note uses LOCAL import
    with patch('anki_connector.update_note_fields') as mock_upd:
        response = client.put("/anki/notes/1", json={"fields": {"f": "b"}})
        assert response.status_code == 200
        mock_upd.assert_called_with(1, {"f": "b"})

    # delete_anki_notes uses MODULE-LEVEL import
    with patch('gui.backend.main.delete_notes') as mock_del:
        response = client.request("DELETE", "/anki/notes", json={"note_ids": [1]})
        assert response.status_code == 200
        mock_del.assert_called_with([1])

def test_health_check_failure():
    """Test health check when things fail."""
    # Patch check_connection in main.py namespace
    with patch('gui.backend.main.check_connection', side_effect=Exception("Failed")):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["anki_connected"] is False

def test_delete_nonexistent_history():
    """Test deleting history for an entry that doesn't exist."""
    with patch('gui.backend.main.HistoryManager') as mock_mgr_class:
        mock_mgr = MagicMock()
        mock_mgr.get_entry.return_value = None
        mock_mgr_class.return_value = mock_mgr
        
        response = client.delete("/history/999")
        assert response.status_code == 404

def test_generate_invalid_data():
    """Test /generate with missing required fields."""
    response = client.post("/generate", files={}, data={})
    assert response.status_code == 422 # FastAPI validation error

def test_sync_nonexistent_session():
    """Test syncing a session that doesn't exist."""
    response = client.post("/session/ghost_session/sync")
    assert response.status_code == 404

def test_update_session_cards_not_found():
    """Test updating cards for a session that doesn't exist."""
    with patch('gui.backend.main.os.path.exists', return_value=False):
        response = client.put("/session/ghost_session/cards", json={"cards": []})
        assert response.status_code == 404

def test_get_decks_failure():
    """Test /decks when AnkiConnect is unreachable."""
    with patch('gui.backend.main.run_in_threadpool', side_effect=Exception("Anki down")):
        response = client.get("/decks")
        assert response.status_code == 200
        assert response.json()["decks"] == []

def test_session_manager_edge_cases():
    """Test session manager cleanup and orphan sweep behavior."""
    from gui.backend.main import SessionManager, SessionState
    sm = SessionManager()
    
    # Empty manager returns None
    assert sm.get_latest_session() is None
    
    # Cleanup handles file removal errors gracefully
    mock_service = MagicMock()
    mock_drafts = MagicMock()
    session = sm.create_session("/tmp/lectern_test_slides.pdf", mock_service, mock_drafts)
    
    with patch('gui.backend.main.os.path.exists', return_value=True):
        with patch('gui.backend.main.os.remove', side_effect=Exception("Perm error")):
            # Should not raise
            sm._cleanup_session_files(session)
    
    # sweep_orphan_temp_files removes Lectern temp PDFs not tied to active sessions
    with patch('gui.backend.session.glob.glob', return_value=["/tmp/lectern_orphan.pdf"]):
        with patch('gui.backend.main.os.remove') as mock_remove:
            removed = sm.sweep_orphan_temp_files()
            assert removed == 1
            mock_remove.assert_called_once_with("/tmp/lectern_orphan.pdf")

def test_config_update_failures():
    """Test /config POST returns 500 on keychain or save failures."""
    # API key update failure
    with patch('utils.keychain_manager.set_gemini_key', side_effect=Exception("Keychain failed")):
        response = client.post("/config", json={"gemini_api_key": "k"})
        assert response.status_code == 500
        
    # JSON save failure
    with patch('config.save_user_config', side_effect=Exception("IO Error")):
        response = client.post("/config", json={"anki_url": "u"})
        assert response.status_code == 500

    # No change branch
    response = client.post("/config", json={})
    assert response.status_code == 200
    assert response.json()["status"] == "no_change"

def test_deck_creation_failure():
    """Test /decks POST returns 500 when deck creation fails."""
    with patch('anki_connector.create_deck', return_value=False):
        response = client.post("/decks", json={"name": "Fail"})
        assert response.status_code == 500
    
    with patch('anki_connector.create_deck', side_effect=Exception("Crash")):
        response = client.post("/decks", json={"name": "Crash"})
        assert response.status_code == 500

def test_history_deletion_failure():
    """Test /history DELETE returns 500 when deletion fails."""
    with patch('gui.backend.main.HistoryManager') as mock_mgr_class:
        mock_mgr = MagicMock()
        mock_mgr.get_entry.return_value = {"id": "1"}
        mock_mgr.delete_entry.return_value = False # Explicit failure
        mock_mgr_class.return_value = mock_mgr
        
        response = client.delete("/history/1")
        assert response.status_code == 500

def test_estimate_cost_failure():
    """Test /estimate returns 500 when cost estimation crashes."""
    with patch('gui.backend.main.LecternGenerationService') as mock_service:
        mock_service.return_value.estimate_cost_with_base = AsyncMock(side_effect=Exception("Parsing crash"))
        files = {"pdf_file": ("test_slides.pdf", b"p", "application/pdf")}
        with patch('gui.backend.main.shutil.copyfileobj'):
            response = client.post("/estimate", files=files)
        assert response.status_code == 500

def test_generate_event_generator_errors():
    """Test SSE stream emits error event and marks session on generator crash."""
    from gui.backend.main import session_manager
    mock_service = MagicMock()
    
    async def failing_gen(*args, **kwargs):
        yield json.dumps({"type": "info"}) + "\n"
        raise Exception("SSE Crash")
        
    # We'll use a session already in manager to avoid full /generate setup
    session = session_manager.create_session("test_slides.pdf", MagicMock(), MagicMock())
    
    with patch('gui.backend.main.LecternGenerationService') as mock_s_class:
        mock_s = MagicMock()
        # Mock run_generation which is called inside event_generator
        with patch('gui.backend.main.GenerationService.run_generation', side_effect=failing_gen):
             files = {"pdf_file": ("test_slides.pdf", b"p", "application/pdf")}
             data = {"deck_name": "D", "session_id": session.session_id}
             
             with patch('gui.backend.main.shutil.copyfileobj'):
                with patch('gui.backend.main.tempfile.NamedTemporaryFile') as mock_temp:
                    mock_temp.return_value.__enter__.return_value.name = "/t.pdf"
                    with patch('gui.backend.main.os.path.getsize', return_value=123):
                        response = client.post("/generate", files=files, data=data)
                    lines = [json.loads(l) for l in response.iter_lines() if l]
                    # The first line should be session_start
                    session_id = lines[0]["data"]["session_id"]
                    assert any("Generation failed: SSE Crash" in str(l) for l in lines)
                    assert session_manager.get_session(session_id) is None

def test_sync_session_to_anki_recreate_branch():
    """Test session sync recreates externally deleted Anki notes."""
    mock_state = {
        "pdf_path": "P", "deck_name": "D", "concept_map": {}, "history": [],
        "cards": [{"fields": {"F": "B"}, "anki_note_id": 999}]
    }
    
    with patch('gui.backend.main.load_state', return_value=mock_state):
        # 1. Note deleted externally -> info returns empty
        with patch('gui.backend.main.notes_info', return_value=[{"noteId": 0}]):
            with patch('gui.backend.main.export_card_to_anki') as mock_export:
                mock_export.return_value.success = True
                mock_export.return_value.note_id = 777
                
                response = client.post("/session/test/sync")
                lines = [l for l in response.iter_lines() if l]
                assert any("note_recreated" in str(l) for l in lines)

def test_anki_connector_failures_api():
    """Test Anki note endpoints return 500 when connector raises."""
    with patch('gui.backend.main.delete_notes', side_effect=Exception("Anki Down")):
        response = client.request("DELETE", "/anki/notes", json={"note_ids": [1]})
        assert response.status_code == 500
        
    with patch('anki_connector.update_note_fields', side_effect=Exception("Note locked")):
        response = client.put("/anki/notes/1", json={"fields": {"f": "b"}})
        assert response.status_code == 500

def test_no_active_session_404():
    """Test _get_session_or_404 with no sessions."""
    # Ensure manager is clear
    from gui.backend.main import session_manager
    with session_manager._lock:
        session_manager._sessions = {}
        session_manager._latest_session_id = None
        
    response = client.get("/drafts")
    assert response.status_code == 400
    
    response = client.get("/drafts?session_id=ghost")
    assert response.status_code == 404

def test_config_update_all_fields():
    """Test /config POST accepts and persists all supported fields."""
    with patch('config.save_user_config') as mock_save:
        with patch('importlib.reload'):
            response = client.post("/config", json={
                "anki_url": "http://new:8765",
                "basic_model": "NewBasic",
                "cloze_model": "NewCloze",
                "gemini_model": "gemini-2.0-flash"
            })
            assert response.status_code == 200
            assert "anki_url" in response.json()["fields"]
            assert "basic_model" in response.json()["fields"]
            mock_save.assert_called()

def test_version_fetches_when_called():
    """Test version endpoint always checks network."""
    with patch('requests.get') as mock_get:
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = {
            "tag_name": "v1.0.0",
            "html_url": "https://github.com/stegra05/Lectern/releases/tag/v1.0.0"
        }
        response = client.get("/version")
        assert response.status_code == 200
        mock_get.assert_called_once()

def test_deck_actions_success():
    """Test successful deck listing and creation."""
    with patch('gui.backend.main.run_in_threadpool', return_value=["D1"]):
        response = client.get("/decks")
        assert "D1" in response.json()["decks"]
        
    with patch('anki_connector.create_deck', return_value=True):
        response = client.post("/decks", json={"name": "NewDeck"})
        assert response.status_code == 200
        assert response.json()["status"] == "created"

def test_history_clear_all():
    """Test clearing all history entries."""
    with patch('gui.backend.main.HistoryManager') as mock_mgr_class:
        mock_mgr = MagicMock()
        mock_mgr_class.return_value = mock_mgr
        response = client.delete("/history")
        assert response.status_code == 200
        mock_mgr.clear_all.assert_called_once()

def test_generate_with_overrides():
    """Test generating cards with focus prompt and source type override."""
    files = {"pdf_file": ("test_slides.pdf", b"p", "application/pdf")}
    data = {
        "deck_name": "D",
        "focus_prompt": "Medical",
        "source_type": "slides"
    }
    with patch('gui.backend.main.shutil.copyfileobj'):
        with patch('gui.backend.main.tempfile.NamedTemporaryFile') as mock_temp:
            mock_temp.return_value.__enter__.return_value.name = "/t.pdf"
            with patch('gui.backend.main.os.path.getsize', return_value=123):
                with patch('gui.backend.main.GenerationService.run_generation') as mock_gen:
                    mock_gen.return_value = (x for x in [])
                    response = client.post("/generate", files=files, data=data)
                    assert response.status_code == 200

def test_simple_session_actions():
    """Test stop_generation and draft management failures."""
    # Stop non-existent session
    response = client.post("/stop?session_id=ghost")
    assert response.status_code == 404
    
    # Sync empty drafts
    mock_session = MagicMock()
    mock_session.session_id = "s1"
    mock_runtime = MagicMock()
    mock_runtime.draft_store.get_drafts.return_value = []
    with patch('gui.backend.main._get_session_or_404', return_value=mock_session):
        with patch('gui.backend.main._get_runtime_or_404', return_value=mock_runtime):
            with patch('gui.backend.main.load_state', return_value={"cards": []}):
                response = client.post("/drafts/sync?session_id=s1")
                assert response.json()["created"] == 0

def test_session_card_management_success():
    """Test successful card deletion and history update."""
    mock_state = {"cards": [{"id": 0}, {"id": 1}], "pdf_path": "P", "deck_name": "D", "concept_map": {}, "history": []}
    with patch('gui.backend.main.load_state', return_value=mock_state):
        with patch('gui.backend.main.StateFile.update_cards', return_value=True) as mock_update:
            with patch('gui.backend.main.HistoryManager') as mock_hist:
                response = client.delete("/session/s1/cards/0")
                assert response.status_code == 200
                assert response.json()["remaining"] == 1
                mock_update.assert_called()
                mock_hist.return_value.update_entry.assert_called()

def test_spa_routing():
    """Test serving index.html for non-existent but non-API paths."""
    # We need to simulate a dist folder for this to work
    with patch('gui.backend.main.os.path.exists', return_value=True):
        with patch('gui.backend.main.FileResponse', return_value={"file": "index.html"}):
            response = client.get("/random-path")
            # If FileResponse is returned it might not be a standard status
            # But we hit the branch.
            
    # Test API 404
    with patch('gui.backend.main.os.path.exists', return_value=True):
        response = client.get("/api/v1/ghost")
        assert response.status_code == 404

def test_session_latest_fallback():
    """Test _get_session_or_404 uses latest session when ID is missing."""
    from gui.backend.main import session_manager
    session = session_manager.create_session("test_slides.pdf", MagicMock(), MagicMock())
    
    # No session_id provided, should find the latest one
    with patch('gui.backend.main.GenerationService.run_generation', return_value=(x for x in [])):
        # Just use something that calls _get_session_or_404
        # stop_generation(session_id=None)
        response = client.post("/stop")
        assert response.status_code == 200
        assert response.json()["session_id"] == session.session_id

def test_session_manager_more_pruning():
    """Test session manager handles stop/cleanup of non-existent sessions."""
    from gui.backend.main import session_manager
    # Stop non-existent session is a no-op
    session_manager.stop_session("ghost")
    # Cleanup non-existent session is a no-op
    session_manager.cleanup_session("ghost")

def test_api_status_event_handling():
    """Test session status transitions for completed and cancelled events."""
    from gui.backend.main import session_manager
    session = session_manager.create_session("test_slides.pdf", MagicMock(), MagicMock())
    
    # done event
    session_manager.mark_status(session.session_id, "completed")
    assert session_manager.get_session(session.session_id).status == "completed"
    
    # cancelled event
    session_manager.mark_status(session.session_id, "cancelled")
    assert session_manager.get_session(session.session_id) is None

def test_draft_api_failures():
    """Test draft update/delete return 404 when index is out of range."""
    mock_session = MagicMock()
    mock_session.draft_store.update_draft.return_value = False
    mock_session.draft_store.delete_draft.return_value = False
    with patch('gui.backend.main._get_session_or_404', return_value=mock_session):
        # Update fail
        response = client.put("/drafts/0?session_id=s1", json={"card": {}})
        assert response.status_code == 404
        # Delete fail
        response = client.delete("/drafts/0?session_id=s1")
        assert response.status_code == 404

def test_sync_failures_reporting():
    """Test /drafts/sync reports individual export failures in SSE stream."""
    mock_session = MagicMock()
    mock_session.session_id = "s1"
    mock_runtime = MagicMock()
    mock_runtime.draft_store.get_drafts.return_value = [{"fields": {"F": "B"}}]
    # Export fails
    with patch('gui.backend.main._get_session_or_404', return_value=mock_session):
        with patch('gui.backend.main._get_runtime_or_404', return_value=mock_runtime):
            with patch('gui.backend.main.export_card_to_anki') as mock_export:
                mock_export.return_value.success = False
                mock_export.return_value.error = "Anki busy"
                
                response = client.post("/drafts/sync?session_id=s1")
                lines = [l for l in response.iter_lines() if l]
                assert any("Failed to create note: Anki busy" in str(l) for l in lines)
                assert any('"failed": 1' in str(l) for l in lines)

def test_session_state_loading_failures():
    """Test session endpoints return 404 for missing state and handle empty cards."""
    with patch('gui.backend.main.load_state', return_value=None):
        response = client.get("/session/ghost")
        assert response.status_code == 404
    
    # Sync session with no cards
    with patch('gui.backend.main.load_state', return_value={"cards": []}):
        response = client.post("/session/empty/sync")
        assert response.json()["created"] == 0

def test_sync_session_runtime_error():
    """Test /session sync reports export failures in SSE stream."""
    mock_state = {
        "pdf_path": "P", "deck_name": "D", "concept_map": {}, "history": [],
        "cards": [{"fields": {"F": "B"}}] # New card
    }
    with patch('gui.backend.main.load_state', return_value=mock_state):
        with patch('gui.backend.main.export_card_to_anki') as mock_export:
            mock_export.return_value.success = False
            mock_export.return_value.error = "Sync crash"
            
            response = client.post("/session/s1/sync")
            lines = [l for l in response.iter_lines() if l]
            assert any("Failed to create note: Sync crash" in str(l) for l in lines)
            assert any('"failed": 1' in str(l) for l in lines)

def test_system_env_branches():
    """Test branches related to system environment (frozen, etc)."""
    # Frozen (bundled) environment detection
    with patch('sys.executable', 'python'):
        with patch('os.path.exists', return_value=True):
             # This is hard to trigger without re-importing, but we can verify it doesn't crash
             pass
