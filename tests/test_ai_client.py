import pytest
from unittest.mock import patch, MagicMock
from ai_client import LecternAIClient
from ai_schemas import AnkiCard, CardGenerationResponse

@pytest.fixture
def mock_genai_client():
    with patch("google.genai.Client") as MockClient:
        instance = MockClient.return_value
        # Mock chat creation
        mock_chat = MagicMock()
        mock_chat.history = []
        instance.chats.create.return_value = mock_chat
        yield instance

@pytest.fixture
def ai_client(mock_genai_client):
    with patch("config.GEMINI_API_KEY", "fake_key"):
        client = LecternAIClient(model_name="test-model")
        return client

def test_initialization(ai_client, mock_genai_client):
    mock_genai_client.chats.create.assert_called_once()
    call_args = mock_genai_client.chats.create.call_args
    assert call_args.kwargs["model"] == "test-model"

def test_update_language(ai_client):
    ai_client.update_language("de")
    mock_response = MagicMock()
    mock_response.text = '{"cards": [], "done": true}'
    ai_client._chat.send_message.return_value = mock_response

    ai_client.generate_more_cards(limit=1)

    call_args = ai_client._chat.send_message.call_args
    sent_prompt = call_args.kwargs["message"]
    assert "Language" in sent_prompt
    assert "de" in sent_prompt

def test_safe_parse_json_valid(ai_client):
    json_str = '{"cards": [{"model_name": "basic", "fields": [{"name": "Front", "value": "A"}]}], "done": false}'
    result = ai_client._safe_parse_json(json_str, CardGenerationResponse)
    
    assert result is not None
    assert len(result["cards"]) == 1
    # Check if field list to dict conversion happened
    card = result["cards"][0]
    assert isinstance(card["fields"], dict)
    assert card["fields"]["Front"] == "A"

def test_safe_parse_json_invalid(ai_client):
    json_str = '{"cards": ... invalid json ...'
    result = ai_client._safe_parse_json(json_str, CardGenerationResponse)
    assert result is None

def test_safe_parse_json_malformed_fields(ai_client):
    # Field without name/value
    json_str = '{"cards": [{"model_name": "basic", "fields": [{"name": "Front"}]}], "done": false}'
    result = ai_client._safe_parse_json(json_str, CardGenerationResponse)
    
    # The current implementation filters out malformed fields during post-processing
    # instead of failing the whole parse if the structure is technically valid JSON.
    assert result is not None
    assert len(result["cards"]) == 1
    # The malformed field should be dropped
    assert result["cards"][0]["fields"] == {}

def test_history_pruning(ai_client):
    # Mock chat history
    mock_history = [MagicMock(model_dump=lambda **k: {"role": "user", "parts": []}) for _ in range(30)]
    ai_client._chat.history = mock_history
    
    # Trick the get_history to return list of dicts
    history = [{"role": "u", "index": i} for i in range(30)]
    with patch.object(ai_client, "get_history", return_value=history):
        with patch.object(ai_client, "restore_history") as mock_restore:
            ai_client._prune_history()
            
            # verify it called restore
            mock_restore.assert_called_once()
            args = mock_restore.call_args[0][0]
            assert len(args) < len(history)
            assert args[0]["index"] == 0
            assert args[-1]["index"] == 29

def test_generate_more_cards_flow(ai_client):
    # Mock send_message response
    mock_response = MagicMock()
    mock_response.text = '{"cards": [], "done": true}'
    ai_client._chat.send_message.return_value = mock_response
    
    result = ai_client.generate_more_cards(limit=5)
    
    ai_client._chat.send_message.assert_called_once()
    assert result["done"] is True
    assert result["cards"] == []

def test_restore_history(ai_client, mock_genai_client):
    history = [{"role": "user", "parts": [{"text": "Hello"}]}]
    ai_client.restore_history(history)
    
    # Verify new chat was created with history
    mock_genai_client.chats.create.assert_called()
    call_args = mock_genai_client.chats.create.call_args_list[-1]
    assert "history" in call_args.kwargs
    assert len(call_args.kwargs["history"]) == 1

def test_count_tokens(ai_client, mock_genai_client):
    mock_response = MagicMock()
    mock_response.total_tokens = 42
    mock_genai_client.models.count_tokens.return_value = mock_response
    
    content = [{"role": "user", "parts": [{"text": "Hello"}]}]
    tokens = ai_client.count_tokens(content)
    
    assert tokens == 42
    mock_genai_client.models.count_tokens.assert_called_once()

def test_count_tokens_failure(ai_client, mock_genai_client):
    mock_genai_client.models.count_tokens.side_effect = Exception("API error")
    
    content = [{"role": "user", "parts": [{"text": "Hello"}]}]
    tokens = ai_client.count_tokens(content)
    
    assert tokens == 0

def test_concept_map(ai_client, mock_genai_client):
    mock_response = MagicMock()
    mock_response.text = '{"objectives": ["O1"], "concepts": [], "relations": [], "language": "en", "slide_set_name": "Test"}'
    ai_client._chat.send_message.return_value = mock_response
    
    with patch("ai_client._compose_multimodal_content", return_value=[]):
        result = ai_client.concept_map([])
        assert result["slide_set_name"] == "Test"
        assert ai_client._prompt_config.language == "en"

def test_reflect(ai_client, mock_genai_client):
    mock_response = MagicMock()
    mock_response.text = '{"reflection": "Better cards", "cards": [], "done": true}'
    ai_client._chat.send_message.return_value = mock_response
    
    result = ai_client.reflect(limit=5)
    assert result["reflection"] == "Better cards"
    assert result["done"] is True
