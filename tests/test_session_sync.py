import pytest
import json
from unittest.mock import MagicMock, patch, AsyncMock
from fastapi.testclient import TestClient
from gui.backend.main import app

client = TestClient(app)

@pytest.fixture
def mock_load_state():
    with patch('gui.backend.main.load_state') as mock:
        yield mock

@pytest.fixture
def mock_save_state():
    with patch('gui.backend.main.save_state') as mock:
        yield mock

@pytest.fixture
def mock_notes_info():
    with patch('gui.backend.main.notes_info') as mock:
        yield mock

@pytest.fixture
def mock_update_note_fields():
    with patch('gui.backend.main.update_note_fields') as mock:
        yield mock

@pytest.fixture
def mock_export_card_to_anki():
    with patch('gui.backend.main.export_card_to_anki') as mock:
        yield mock

def test_sync_session_updates_existing_note(
    mock_load_state, 
    mock_notes_info, 
    mock_update_note_fields
):
    session_id = "test-session"
    mock_load_state.return_value = {
        "pdf_path": "test_slides.pdf",
        "deck_name": "Default",
        "cards": [{"anki_note_id": 123, "fields": {"Front": "F", "Back": "B"}}],
        "concept_map": {},
        "history": []
    }
    mock_notes_info.return_value = [{"noteId": 123}]
    
    response = client.post(f"/session/{session_id}/sync")
    assert response.status_code == 200
    
    # Check streaming response content
    events = [json.loads(line) for line in response.text.splitlines() if line.strip()]
    assert any(e["type"] == "note_updated" for e in events)
    mock_update_note_fields.assert_called_once()

def test_sync_session_recreates_deleted_note(
    mock_load_state, 
    mock_notes_info, 
    mock_export_card_to_anki
):
    session_id = "test-session"
    mock_load_state.return_value = {
        "pdf_path": "test_slides.pdf",
        "deck_name": "Default",
        "cards": [{"anki_note_id": 123, "fields": {"Front": "F", "Back": "B"}}],
        "concept_map": {},
        "history": []
    }
    # Mock that note 123 no longer exists in Anki
    mock_notes_info.return_value = []
    
    # Mock export success
    mock_export_card_to_anki.return_value = MagicMock(success=True, note_id=456)
    
    response = client.post(f"/session/{session_id}/sync")
    assert response.status_code == 200
    
    events = [json.loads(line) for line in response.text.splitlines() if line.strip()]
    assert any(e["type"] == "note_recreated" for e in events)
    mock_export_card_to_anki.assert_called_once()
