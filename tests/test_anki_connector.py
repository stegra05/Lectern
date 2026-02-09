import pytest
from unittest.mock import patch, MagicMock
import anki_connector

# --- Fixtures ---

@pytest.fixture
def mock_requests_post():
    with patch("requests.post") as mock_post:
        yield mock_post

# --- Tests ---

def test_check_connection_success(mock_requests_post):
    # Mock successful version response
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": 6, "error": None}
    mock_requests_post.return_value = mock_response
    
    assert anki_connector.check_connection() is True

def test_check_connection_failure(mock_requests_post):
    # Mock connection error
    mock_requests_post.side_effect = Exception("Connection refused")
    
    assert anki_connector.check_connection() is False

def test_add_note_success(mock_requests_post):
    # Mock addNote response
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": 12345, "error": None}
    mock_requests_post.return_value = mock_response
    
    note_id = anki_connector.add_note(
        deck_name="Test Deck",
        model_name="Basic",
        fields={"Front": "Q", "Back": "A"},
        tags=["test"]
    )
    
    assert note_id == 12345
    mock_requests_post.assert_called_once()

def test_add_note_error(mock_requests_post):
    # Mock API error
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": None, "error": "Deck not found"}
    mock_requests_post.return_value = mock_response
    
    with pytest.raises(RuntimeError, match="Deck not found"):
        anki_connector.add_note("Bad Deck", "Basic", {}, [])

def test_store_media_file(mock_requests_post):
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": "image.jpg", "error": None}
    mock_requests_post.return_value = mock_response
    
    filename = anki_connector.store_media_file("image.jpg", b"123")
    assert filename == "image.jpg"
    mock_requests_post.assert_called_once()

def test_get_deck_names(mock_requests_post):
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": ["Default", "Math"], "error": None}
    mock_requests_post.return_value = mock_response
    
    decks = anki_connector.get_deck_names()
    assert "Math" in decks
    assert len(decks) == 2

def test_sample_examples_from_deck(mock_requests_post):
    # This function makes two calls: findNotes then notesInfo
    
    mock_response_find = MagicMock()
    mock_response_find.json.return_value = {"result": [101], "error": None}
    
    mock_response_info = MagicMock()
    mock_response_info.json.return_value = {
        "result": [
            {"fields": {"Front": {"value": "Q1"}, "Back": {"value": "A1"}}}
        ],
        "error": None
    }
    
    mock_requests_post.side_effect = [mock_response_find, mock_response_info]
    
    examples = anki_connector.sample_examples_from_deck("Test")
    assert "Example 1:" in examples
    assert "Q1" in examples
    assert "A1" in examples

def test_create_deck(mock_requests_post):
    mock_response = MagicMock()
    # Success: returns deck ID
    mock_response.json.return_value = {"result": 12345, "error": None}
    mock_requests_post.return_value = mock_response
    
    success = anki_connector.create_deck("New Deck")
    assert success is True
    
    # Error case: result is None (or _invoke raises RuntimeError)
    mock_response.json.return_value = {"result": None, "error": "Already exists"}
    assert anki_connector.create_deck("New Deck") is False

def test_delete_notes(mock_requests_post):
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": None, "error": None}
    mock_requests_post.return_value = mock_response
    
    anki_connector.delete_notes([1, 2, 3])
    mock_requests_post.assert_called_once()

def test_update_note_fields(mock_requests_post):
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": None, "error": None}
    mock_requests_post.return_value = mock_response
    
    anki_connector.update_note_fields(123, {"Front": "New Q"})
    mock_requests_post.assert_called_once()
