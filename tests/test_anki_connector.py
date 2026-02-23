import pytest
from unittest.mock import patch, MagicMock
from lectern import anki_connector

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

def test_get_model_field_names(mock_requests_post):
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": ["Front", "Back"], "error": None}
    mock_requests_post.return_value = mock_response
    
    fields = anki_connector.get_model_field_names("Basic")
    assert fields == ["Front", "Back"]

@patch("lectern.anki_connector.get_model_names")
@patch("lectern.anki_connector.get_model_field_names")
def test_detect_builtin_models_localized(mock_get_fields, mock_get_names):
    # Mock German locale: "Einfach" (Basic) and "Lückentext" (Cloze)
    mock_get_names.return_value = ["Einfach", "Lückentext", "Other"]

    def side_effect(name):
        if name == "Einfach":
            return ["Front", "Back"]
        if name == "Lückentext":
            return ["Text"]
        return ["Field1"]

    mock_get_fields.side_effect = side_effect

    detected = anki_connector.detect_builtin_models()
    assert detected["basic"] == "Einfach"
    assert detected["cloze"] == "Lückentext"


# --- Error Handling Tests ---

class TestNetworkTimeout:
    """Tests for network timeout handling."""

    def test_invoke_timeout_on_connect(self, mock_requests_post):
        """Test that connection timeout raises RuntimeError."""
        import requests
        mock_requests_post.side_effect = requests.Timeout("Connection timed out")

        with pytest.raises(RuntimeError, match="Failed to reach AnkiConnect"):
            anki_connector._invoke("version")

    def test_invoke_timeout_on_read(self, mock_requests_post):
        """Test that read timeout raises RuntimeError."""
        import requests
        mock_requests_post.side_effect = requests.ReadTimeout("Read timed out")

        with pytest.raises(RuntimeError, match="Failed to reach AnkiConnect"):
            anki_connector._invoke("version")

    def test_check_connection_handles_timeout(self, mock_requests_post):
        """Test that check_connection returns False on timeout."""
        import requests
        mock_requests_post.side_effect = requests.Timeout("Timeout")

        assert anki_connector.check_connection() is False


class TestPartialResponse:
    """Tests for partial or malformed response handling."""

    def test_non_json_response(self, mock_requests_post):
        """Test that non-JSON response raises RuntimeError."""
        mock_response = MagicMock()
        mock_response.json.side_effect = ValueError("Invalid JSON")
        mock_requests_post.return_value = mock_response

        with pytest.raises(RuntimeError, match="non-JSON response"):
            anki_connector._invoke("version")

    def test_empty_response(self, mock_requests_post):
        """Test that empty response is handled."""
        mock_response = MagicMock()
        mock_response.json.side_effect = ValueError("Empty response")
        mock_requests_post.return_value = mock_response

        with pytest.raises(RuntimeError, match="non-JSON response"):
            anki_connector._invoke("version")

    def test_partial_json_response(self, mock_requests_post):
        """Test handling of partial JSON (missing fields)."""
        mock_response = MagicMock()
        # Response without 'result' key
        mock_response.json.return_value = {}
        mock_requests_post.return_value = mock_response

        # Should not raise, returns None for missing result
        result = anki_connector._invoke("version")
        assert result is None

    def test_notes_info_with_invalid_data(self, mock_requests_post):
        """Test notes_info filters out invalid entries."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "result": [
                {"noteId": 1, "fields": {"Front": {"value": "Q1"}}},
                "invalid_string_entry",
                None,
                {"noteId": 2, "fields": {"Front": {"value": "Q2"}}},
            ],
            "error": None
        }
        mock_requests_post.return_value = mock_response

        result = anki_connector.notes_info([1, 2])
        # Should only return valid dict entries
        assert len(result) == 2
        assert result[0]["noteId"] == 1
        assert result[1]["noteId"] == 2


class TestRetryLogic:
    """Tests for retry behavior with transient failures."""

    def test_retry_on_connection_error(self, mock_requests_post):
        """Test that transient connection errors trigger retry."""
        import requests

        # First two calls fail, third succeeds
        mock_response_success = MagicMock()
        mock_response_success.json.return_value = {"result": 6, "error": None}

        mock_requests_post.side_effect = [
            requests.ConnectionError("Connection refused"),
            requests.ConnectionError("Connection refused"),
            mock_response_success,
        ]

        # Should succeed after retries
        result = anki_connector._invoke("version")
        assert result == 6
        assert mock_requests_post.call_count == 3

    def test_retry_exhausted_raises_last_error(self, mock_requests_post):
        """Test that exhausted retries raise the last error."""
        import requests
        mock_requests_post.side_effect = requests.ConnectionError("Connection refused")

        with pytest.raises(RuntimeError, match="Failed to reach AnkiConnect"):
            anki_connector._invoke("version")

        # Should have tried MAX_RETRIES + 1 times (4 by default)
        assert mock_requests_post.call_count == 4

    def test_no_retry_on_api_error(self, mock_requests_post):
        """Test that API-level errors don't trigger retry."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"result": None, "error": "Deck not found"}
        mock_requests_post.return_value = mock_response

        with pytest.raises(RuntimeError, match="AnkiConnect error"):
            anki_connector._invoke("addNote", {"note": {}})

        # Should only call once (no retry on API error)
        assert mock_requests_post.call_count == 1

    def test_retry_with_exponential_backoff(self, mock_requests_post):
        """Test that retry uses exponential backoff."""
        import requests
        import time

        mock_response_success = MagicMock()
        mock_response_success.json.return_value = {"result": 6, "error": None}

        call_times = []

        def track_calls(*args, **kwargs):
            call_times.append(time.time())
            if len(call_times) < 3:
                raise requests.ConnectionError("Connection refused")
            return mock_response_success

        mock_requests_post.side_effect = track_calls

        anki_connector._invoke("version")

        # Verify there were delays between retries
        if len(call_times) >= 3:
            # First retry delay should be ~0.5s
            delay1 = call_times[1] - call_times[0]
            delay2 = call_times[2] - call_times[1]
            # Allow some tolerance for test execution
            assert delay1 >= 0.3  # Initial delay ~0.5s
            assert delay2 >= delay1 * 1.5  # Exponential backoff


class TestVersionMismatch:
    """Tests for version mismatch graceful degradation."""

    def test_connection_info_old_version(self, mock_requests_post):
        """Test that old AnkiConnect version is detected gracefully."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"result": 5, "error": None}
        mock_requests_post.return_value = mock_response

        info = anki_connector.get_connection_info()

        assert info["connected"] is True
        assert info["version"] == 5
        assert info["version_ok"] is False
        assert "too old" in info["error"]

    def test_connection_info_version_6_ok(self, mock_requests_post):
        """Test that version 6 is accepted."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"result": 6, "error": None}
        mock_requests_post.return_value = mock_response

        info = anki_connector.get_connection_info()

        assert info["connected"] is True
        assert info["version"] == 6
        assert info["version_ok"] is True
        assert info["error"] is None

    def test_connection_info_future_version(self, mock_requests_post):
        """Test that future versions are accepted."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"result": 10, "error": None}
        mock_requests_post.return_value = mock_response

        info = anki_connector.get_connection_info()

        assert info["connected"] is True
        assert info["version"] == 10
        assert info["version_ok"] is True

    def test_connection_info_invalid_version_type(self, mock_requests_post):
        """Test handling of non-integer version."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"result": "6.0", "error": None}
        mock_requests_post.return_value = mock_response

        info = anki_connector.get_connection_info()

        assert info["connected"] is True
        assert info["version"] == "6.0"
        assert info["version_ok"] is False  # String is not valid

    def test_connection_info_with_api_error(self, mock_requests_post):
        """Test handling when AnkiConnect returns an error."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"result": None, "error": "Some API error"}
        mock_requests_post.return_value = mock_response

        info = anki_connector.get_connection_info()

        assert info["connected"] is False
        assert "AnkiConnect error" in info["error"]


class TestGracefulDegradation:
    """Tests for functions that should degrade gracefully on errors."""

    def test_get_deck_names_returns_empty_on_error(self, mock_requests_post):
        """Test get_deck_names returns empty list on failure."""
        mock_requests_post.side_effect = Exception("Connection failed")

        result = anki_connector.get_deck_names()
        assert result == []

    def test_get_model_names_returns_empty_on_error(self, mock_requests_post):
        """Test get_model_names returns empty list on failure."""
        mock_requests_post.side_effect = Exception("Connection failed")

        result = anki_connector.get_model_names()
        assert result == []

    def test_get_all_tags_returns_empty_on_error(self, mock_requests_post):
        """Test get_all_tags returns empty list on failure."""
        mock_requests_post.side_effect = Exception("Connection failed")

        result = anki_connector.get_all_tags()
        assert result == []

    def test_sample_examples_returns_empty_on_error(self, mock_requests_post):
        """Test sample_examples_from_deck returns empty string on failure."""
        mock_requests_post.side_effect = Exception("Connection failed")

        result = anki_connector.sample_examples_from_deck("Test Deck")
        assert result == ""

    def test_detect_builtin_models_defaults_on_error(self, mock_requests_post):
        """Test detect_builtin_models returns defaults on failure."""
        mock_requests_post.side_effect = Exception("Connection failed")

        result = anki_connector.detect_builtin_models()
        assert result == {"basic": "Basic", "cloze": "Cloze"}
