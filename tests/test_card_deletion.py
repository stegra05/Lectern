import pytest
from unittest.mock import MagicMock, patch
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
def mock_history_manager():
    with patch('gui.backend.main.HistoryManager') as mock:
        instance = mock.return_value
        yield instance

@pytest.fixture
def mock_delete_notes():
    with patch('gui.backend.main.delete_notes') as mock:
        yield mock

def test_delete_session_card(
    mock_load_state,
    mock_save_state,
    mock_history_manager
):
    session_id = "test-session"
    initial_cards = [
        {"id": 1, "front": "A", "anki_note_id": 100},
        {"id": 2, "front": "B", "anki_note_id": 101}
    ]
    mock_load_state.return_value = {
        "pdf_path": "test.pdf",
        "deck_name": "Default",
        "cards": list(initial_cards), # Copy
        "concept_map": {},
        "history": []
    }

    # Delete first card (index 0)
    response = client.delete(f"/session/{session_id}/cards/0")
    
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "remaining": 1}

    # Verify save_state called with updated cards
    mock_save_state.assert_called_once()
    _, kwargs = mock_save_state.call_args
    assert len(kwargs["cards"]) == 1
    assert kwargs["cards"][0]["id"] == 2

    # Verify history updated
    mock_history_manager.update_entry.assert_called_once_with(session_id, card_count=1)

def test_delete_session_card_invalid_index(mock_load_state):
    session_id = "test-session"
    mock_load_state.return_value = {
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
