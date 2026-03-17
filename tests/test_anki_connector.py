import pytest
import httpx
import asyncio
from unittest.mock import patch, MagicMock, AsyncMock
from lectern import anki_connector
from lectern.anki_connector import AnkiTransportError, AnkiApiError

# --- Fixtures ---


@pytest.fixture(autouse=True)
def clear_model_caches():
    """Clear model field caches before each test to prevent test pollution."""
    anki_connector.clear_model_caches()
    yield
    anki_connector.clear_model_caches()


# --- Tests ---


@pytest.mark.asyncio
async def test_check_connection_success(mock_httpx_post):
    # Mock successful version response
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": 6, "error": None}
    mock_response.raise_for_status = MagicMock()
    mock_httpx_post.return_value = mock_response

    assert await anki_connector.check_connection() is True


@pytest.mark.asyncio
async def test_check_connection_failure(mock_httpx_post):
    # Mock connection error
    mock_httpx_post.side_effect = httpx.RequestError("Connection refused")

    assert await anki_connector.check_connection() is False


@pytest.mark.asyncio
async def test_add_note_success(mock_httpx_post):
    # Mock addNote response
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": 12345, "error": None}
    mock_response.raise_for_status = MagicMock()
    mock_httpx_post.return_value = mock_response

    note_id = await anki_connector.add_note(
        deck_name="Test Deck",
        model_name="Basic",
        fields={"Front": "Q", "Back": "A"},
        tags=["test"],
    )

    assert note_id == 12345
    mock_httpx_post.assert_called_once()


@pytest.mark.asyncio
async def test_add_note_error(mock_httpx_post):
    # Mock API error
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": None, "error": "Deck not found"}
    mock_response.raise_for_status = MagicMock()
    mock_httpx_post.return_value = mock_response

    with pytest.raises(AnkiApiError, match="Deck not found"):
        await anki_connector.add_note("Bad Deck", "Basic", {}, [])


@pytest.mark.asyncio
async def test_get_deck_names(mock_httpx_post):
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": ["Default", "Math"], "error": None}
    mock_response.raise_for_status = MagicMock()
    mock_httpx_post.return_value = mock_response

    decks = await anki_connector.get_deck_names()
    assert "Math" in decks
    assert len(decks) == 2


@pytest.mark.asyncio
async def test_get_connection_info_collection_available(mock_httpx_post):
    """Connection info includes collection readiness when deckNames works."""
    mock_version = MagicMock()
    mock_version.json.return_value = {"result": 6, "error": None}
    mock_version.raise_for_status = MagicMock()

    mock_decks = MagicMock()
    mock_decks.json.return_value = {"result": ["Default"], "error": None}
    mock_decks.raise_for_status = MagicMock()

    mock_httpx_post.side_effect = [mock_version, mock_decks]

    info = await anki_connector.get_connection_info()

    assert info["connected"] is True
    assert info["version_ok"] is True
    assert info["collection_available"] is True
    assert info["error_kind"] is None


@pytest.mark.asyncio
async def test_get_connection_info_collection_unavailable_api_error(mock_httpx_post):
    """Connection info classifies API-level collection errors."""
    mock_version = MagicMock()
    mock_version.json.return_value = {"result": 6, "error": None}
    mock_version.raise_for_status = MagicMock()

    mock_decks = MagicMock()
    mock_decks.json.return_value = {
        "result": None,
        "error": "collection is not available",
    }
    mock_decks.raise_for_status = MagicMock()

    mock_httpx_post.side_effect = [mock_version, mock_decks]

    info = await anki_connector.get_connection_info()

    assert info["connected"] is True
    assert info["collection_available"] is False
    assert info["error_kind"] == "api"
    assert "collection is not available" in (info["error"] or "")


@pytest.mark.asyncio
async def test_sample_examples_from_deck(mock_httpx_post):
    # This function makes two calls: findNotes then notesInfo

    mock_response_find = MagicMock()
    mock_response_find.json.return_value = {"result": [101], "error": None}
    mock_response_find.raise_for_status = MagicMock()

    mock_response_info = MagicMock()
    mock_response_info.json.return_value = {
        "result": [
            {
                "modelName": "Basic",
                "fields": {"Front": {"value": "Q1"}, "Back": {"value": "A1"}},
            }
        ],
        "error": None,
    }
    mock_response_info.raise_for_status = MagicMock()

    mock_httpx_post.side_effect = [mock_response_find, mock_response_info]

    examples = await anki_connector.sample_examples_from_deck("Test")
    assert "Example 1 (Basic):" in examples
    assert "Front: Q1" in examples
    assert "Q1" in examples
    assert "A1" in examples


@pytest.mark.asyncio
async def test_create_deck(mock_httpx_post):
    mock_response = MagicMock()
    # Success: returns deck ID
    mock_response.json.return_value = {"result": 12345, "error": None}
    mock_response.raise_for_status = MagicMock()
    mock_httpx_post.return_value = mock_response

    success = await anki_connector.create_deck("New Deck")
    assert success is True

    # Error case: result is None (or _invoke raises RuntimeError)
    mock_response.json.return_value = {"result": None, "error": "Already exists"}
    assert await anki_connector.create_deck("New Deck") is False


@pytest.mark.asyncio
async def test_delete_notes(mock_httpx_post):
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": None, "error": None}
    mock_response.raise_for_status = MagicMock()
    mock_httpx_post.return_value = mock_response

    await anki_connector.delete_notes([1, 2, 3])
    mock_httpx_post.assert_called_once()


@pytest.mark.asyncio
async def test_update_note_fields(mock_httpx_post):
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": None, "error": None}
    mock_response.raise_for_status = MagicMock()
    mock_httpx_post.return_value = mock_response

    await anki_connector.update_note_fields(123, {"Front": "New Q"})
    mock_httpx_post.assert_called_once()


@pytest.mark.asyncio
async def test_get_model_field_names(mock_httpx_post):
    mock_response = MagicMock()
    mock_response.json.return_value = {"result": ["Front", "Back"], "error": None}
    mock_response.raise_for_status = MagicMock()
    mock_httpx_post.return_value = mock_response

    fields = await anki_connector.get_model_field_names("Basic")
    assert fields == ["Front", "Back"]


@pytest.mark.asyncio
@patch("lectern.anki_connector.get_model_names", new_callable=AsyncMock)
@patch("lectern.anki_connector.get_model_field_names", new_callable=AsyncMock)
async def test_detect_builtin_models_localized(mock_get_fields, mock_get_names):
    # Mock German locale: "Einfach" (Basic) and "Lückentext" (Cloze)
    mock_get_names.return_value = ["Einfach", "Lückentext", "Other"]

    async def side_effect(name):
        if name == "Einfach":
            return ["Front", "Back"]
        if name == "Lückentext":
            return ["Text"]
        return ["Field1"]

    mock_get_fields.side_effect = side_effect

    detected = await anki_connector.detect_builtin_models()
    assert detected["basic"] == "Einfach"
    assert detected["cloze"] == "Lückentext"


# --- Error Handling Tests ---


class TestNetworkTimeout:
    """Tests for network timeout handling."""

    @pytest.mark.asyncio
    async def test_invoke_timeout_on_connect(self, mock_httpx_post):
        """Test that connection timeout raises AnkiTransportError."""
        mock_httpx_post.side_effect = httpx.ConnectTimeout("Connection timed out")

        with pytest.raises(AnkiTransportError, match="Failed to reach AnkiConnect"):
            await anki_connector._invoke("version")

    @pytest.mark.asyncio
    async def test_invoke_timeout_on_read(self, mock_httpx_post):
        """Test that read timeout raises AnkiTransportError."""
        mock_httpx_post.side_effect = httpx.ReadTimeout("Read timed out")

        with pytest.raises(AnkiTransportError, match="Failed to reach AnkiConnect"):
            await anki_connector._invoke("version")

    @pytest.mark.asyncio
    async def test_check_connection_handles_timeout(self, mock_httpx_post):
        """Test that check_connection returns False on timeout."""
        mock_httpx_post.side_effect = httpx.TimeoutException("Timeout")

        assert await anki_connector.check_connection() is False


class TestPartialResponse:
    """Tests for partial or malformed response handling."""

    @pytest.mark.asyncio
    async def test_non_json_response(self, mock_httpx_post):
        """Test that non-JSON response raises AnkiTransportError."""
        mock_response = MagicMock()
        mock_response.json.side_effect = ValueError("Invalid JSON")
        mock_response.raise_for_status = MagicMock()
        mock_httpx_post.return_value = mock_response

        with pytest.raises(AnkiTransportError, match="non-JSON response"):
            await anki_connector._invoke("version")

    @pytest.mark.asyncio
    async def test_empty_response(self, mock_httpx_post):
        """Test that empty response is handled."""
        mock_response = MagicMock()
        mock_response.json.side_effect = ValueError("Empty response")
        mock_response.raise_for_status = MagicMock()
        mock_httpx_post.return_value = mock_response

        with pytest.raises(AnkiTransportError, match="non-JSON response"):
            await anki_connector._invoke("version")

    @pytest.mark.asyncio
    async def test_partial_json_response(self, mock_httpx_post):
        """Test handling of partial JSON (missing fields)."""
        mock_response = MagicMock()
        # Response without 'result' key
        mock_response.json.return_value = {}
        mock_response.raise_for_status = MagicMock()
        mock_httpx_post.return_value = mock_response

        # Should not raise, returns None for missing result
        result = await anki_connector._invoke("version")
        assert result is None

    @pytest.mark.asyncio
    async def test_notes_info_with_invalid_data(self, mock_httpx_post):
        """Test notes_info filters out invalid entries."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "result": [
                {"noteId": 1, "fields": {"Front": {"value": "Q1"}}},
                "invalid_string_entry",
                None,
                {"noteId": 2, "fields": {"Front": {"value": "Q2"}}},
            ],
            "error": None,
        }
        mock_response.raise_for_status = MagicMock()
        mock_httpx_post.return_value = mock_response

        result = await anki_connector.notes_info([1, 2])
        # Should only return valid dict entries
        assert len(result) == 2
        assert result[0]["noteId"] == 1
        assert result[1]["noteId"] == 2


class TestRetryLogic:
    """Tests for retry behavior with transient failures."""

    @pytest.mark.asyncio
    async def test_retry_on_connection_error(self, mock_httpx_post):
        """Test that transient connection errors trigger retry."""
        # First two calls fail, third succeeds
        mock_response_success = MagicMock()
        mock_response_success.json.return_value = {"result": 6, "error": None}
        mock_response_success.raise_for_status = MagicMock()

        mock_httpx_post.side_effect = [
            httpx.ConnectError("Connection refused"),
            httpx.ConnectError("Connection refused"),
            mock_response_success,
        ]

        with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            # Should succeed after retries
            result = await anki_connector._invoke("version")
            assert result == 6
            assert mock_httpx_post.call_count == 3
            assert mock_sleep.call_count == 2

    @pytest.mark.asyncio
    async def test_retry_exhausted_raises_last_error(self, mock_httpx_post):
        """Test that exhausted retries raise the last error."""
        mock_httpx_post.side_effect = httpx.ConnectError("Connection refused")

        with patch("asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(AnkiTransportError, match="Failed to reach AnkiConnect"):
                await anki_connector._invoke("version")

        # Should have tried MAX_RETRIES + 1 times (4 by default)
        assert mock_httpx_post.call_count == 4

    @pytest.mark.asyncio
    async def test_no_retry_on_api_error(self, mock_httpx_post):
        """Test that API-level errors don't trigger retry."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"result": None, "error": "Deck not found"}
        mock_response.raise_for_status = MagicMock()
        mock_httpx_post.return_value = mock_response

        with pytest.raises(AnkiApiError, match="AnkiConnect error"):
            await anki_connector._invoke("addNote", {"note": {}})

        # Should only call once (no retry on API error)
        assert mock_httpx_post.call_count == 1

    @pytest.mark.asyncio
    async def test_retry_with_exponential_backoff(self, mock_httpx_post):
        """Test that retry uses exponential backoff."""
        mock_response_success = MagicMock()
        mock_response_success.json.return_value = {"result": 6, "error": None}
        mock_response_success.raise_for_status = MagicMock()

        async def track_calls(*args, **kwargs):
            if mock_httpx_post.call_count < 3:
                raise httpx.ConnectError("Connection refused")
            return mock_response_success

        mock_httpx_post.side_effect = track_calls

        with patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep:
            await anki_connector._invoke("version")

            # Verify there were delays between retries
            assert mock_sleep.call_count == 2

            # Check delays (0.5s, 1.0s)
            delays = [call.args[0] for call in mock_sleep.call_args_list]
            assert delays[0] == 0.5
            assert delays[1] == 1.0


class TestVersionMismatch:
    """Tests for version mismatch graceful degradation."""

    @pytest.mark.asyncio
    async def test_connection_info_old_version(self, mock_httpx_post):
        """Test that old AnkiConnect version is detected gracefully."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"result": 5, "error": None}
        mock_response.raise_for_status = MagicMock()
        mock_httpx_post.return_value = mock_response

        info = await anki_connector.get_connection_info()

        assert info["connected"] is True
        assert info["version"] == 5
        assert info["version_ok"] is False
        assert "too old" in info["error"]

    @pytest.mark.asyncio
    async def test_connection_info_version_6_ok(self, mock_httpx_post):
        """Test that version 6 is accepted."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"result": 6, "error": None}
        mock_response.raise_for_status = MagicMock()
        mock_httpx_post.return_value = mock_response

        info = await anki_connector.get_connection_info()

        assert info["connected"] is True
        assert info["version"] == 6
        assert info["version_ok"] is True
        assert info["error"] is None

    @pytest.mark.asyncio
    async def test_connection_info_future_version(self, mock_httpx_post):
        """Test that future versions are accepted."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"result": 10, "error": None}
        mock_response.raise_for_status = MagicMock()
        mock_httpx_post.return_value = mock_response

        info = await anki_connector.get_connection_info()

        assert info["connected"] is True
        assert info["version"] == 10
        assert info["version_ok"] is True

    @pytest.mark.asyncio
    async def test_connection_info_invalid_version_type(self, mock_httpx_post):
        """Test handling of non-integer version."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"result": "6.0", "error": None}
        mock_response.raise_for_status = MagicMock()
        mock_httpx_post.return_value = mock_response

        info = await anki_connector.get_connection_info()

        assert info["connected"] is True
        assert info["version"] == "6.0"
        assert info["version_ok"] is False  # String is not valid

    @pytest.mark.asyncio
    async def test_connection_info_with_api_error(self, mock_httpx_post):
        """Test handling when AnkiConnect returns an error."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"result": None, "error": "Some API error"}
        mock_response.raise_for_status = MagicMock()
        mock_httpx_post.return_value = mock_response

        info = await anki_connector.get_connection_info()

        assert info["connected"] is False
        assert "AnkiConnect error" in info["error"]


class TestGracefulDegradation:
    """Tests for functions that should degrade gracefully on errors."""

    @pytest.mark.asyncio
    async def test_get_deck_names_returns_empty_on_error(self, mock_httpx_post):
        """Test get_deck_names returns empty list on failure."""
        mock_httpx_post.side_effect = Exception("Connection failed")

        result = await anki_connector.get_deck_names()
        assert result == []

    @pytest.mark.asyncio
    async def test_get_model_names_returns_empty_on_error(self, mock_httpx_post):
        """Test get_model_names returns empty list on failure."""
        mock_httpx_post.side_effect = Exception("Connection failed")

        result = await anki_connector.get_model_names()
        assert result == []

    @pytest.mark.asyncio
    async def test_get_all_tags_returns_empty_on_error(self, mock_httpx_post):
        """Test get_all_tags returns empty list on failure."""
        mock_httpx_post.side_effect = Exception("Connection failed")

        result = await anki_connector.get_all_tags()
        assert result == []

    @pytest.mark.asyncio
    async def test_sample_examples_returns_empty_on_error(self, mock_httpx_post):
        """Test sample_examples_from_deck returns empty string on failure."""
        mock_httpx_post.side_effect = Exception("Connection failed")

        result = await anki_connector.sample_examples_from_deck("Test Deck")
        assert result == ""

    @pytest.mark.asyncio
    async def test_detect_builtin_models_defaults_on_error(self, mock_httpx_post):
        """Test detect_builtin_models returns defaults on failure."""
        mock_httpx_post.side_effect = Exception("Connection failed")

        result = await anki_connector.detect_builtin_models()
        assert result == {"basic": "Basic", "cloze": "Cloze"}


class TestExceptionHierarchy:
    """Tests for the typed exception hierarchy."""

    def test_anki_transport_error_is_retriable(self):
        """Test that AnkiTransportError is marked as retriable."""
        exc = AnkiTransportError("Connection failed")
        assert exc.retriable is True
        assert isinstance(exc, anki_connector.AnkiConnectError)
        assert isinstance(exc, RuntimeError)

    def test_anki_api_error_is_not_retriable(self):
        """Test that AnkiApiError is marked as not retriable."""
        exc = AnkiApiError("Deck not found")
        assert exc.retriable is False
        assert isinstance(exc, anki_connector.AnkiConnectError)
        assert isinstance(exc, RuntimeError)

    def test_anki_connect_error_base(self):
        """Test that AnkiConnectError can be used directly."""
        exc = anki_connector.AnkiConnectError("Generic error", retriable=False)
        assert exc.retriable is False

    @pytest.mark.asyncio
    async def test_transport_error_inheritance_catch(self, mock_httpx_post):
        """Test that AnkiTransportError can be caught as AnkiConnectError."""
        mock_httpx_post.side_effect = httpx.ConnectError("Connection refused")

        with pytest.raises(anki_connector.AnkiConnectError):
            await anki_connector._invoke("version")

    @pytest.mark.asyncio
    async def test_api_error_inheritance_catch(self, mock_httpx_post):
        """Test that AnkiApiError can be caught as AnkiConnectError."""
        mock_response = MagicMock()
        mock_response.json.return_value = {"result": None, "error": "Invalid action"}
        mock_response.raise_for_status = MagicMock()
        mock_httpx_post.return_value = mock_response

        with pytest.raises(anki_connector.AnkiConnectError):
            await anki_connector._invoke("invalidAction")
