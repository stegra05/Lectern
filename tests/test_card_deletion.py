import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from gui.backend.main import app

client = TestClient(app)

@pytest.fixture
def mock_db():
    with patch('gui.backend.main.DatabaseManager') as mock:
        instance = mock.return_value
        yield instance

@pytest.fixture
def mock_history_manager():
    with patch('gui.backend.main.HistoryManager') as mock:
        instance = mock.return_value
        yield instance

@pytest.fixture
def mock_delete_notes():
    with patch('gui.backend.main.delete_notes') as mock:
        yield mock

def test_delete_session_card(
    mock_db,
    mock_history_manager
):
    session_id = "test-session"
    initial_cards = [
        {"id": 1, "_uid": "u1", "front": "A", "anki_note_id": 100},
        {"id": 2, "_uid": "u2", "front": "B", "anki_note_id": 101}
    ]
    mock_db.get_entry_by_session_id.return_value = {
        "id": 1,
        "pdf_path": "test_slides.pdf",
        "deck_name": "Default",
        "cards": list(initial_cards), # Copy
        "concept_map": {},
        "history": []
    }

    # Delete first card (index 0)
    response = client.delete(f"/session/{session_id}/cards/0")
    
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "remaining": 1}

    # Verify update_session_cards called with updated cards
    mock_db.update_session_cards.assert_called_once()
    args, _ = mock_db.update_session_cards.call_args
    assert len(args[1]) == 1
    assert args[1][0]["id"] == 2

    # Verify history updated via session_id lookup
    mock_db.get_entry_by_session_id.assert_called_with(session_id)
    mock_history_manager.get_entry_by_session_id.assert_called_with(session_id)

def test_delete_session_card_invalid_index(mock_db):
    session_id = "test-session"
    mock_db.get_entry_by_session_id.return_value = {
        "cards": [{"id": 1}]
    }
    
    response = client.delete(f"/session/{session_id}/cards/5")
    assert response.status_code == 404

def test_delete_anki_notes(mock_delete_notes):
    note_ids = [123, 456]
    response = client.request("DELETE", "/anki/notes", json={"note_ids": note_ids})
    
    assert response.status_code == 200
    assert response.json() == {"status": "deleted", "count": 2}
    
    mock_delete_notes.assert_called_once_with(note_ids)
