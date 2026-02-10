import pytest
from unittest.mock import MagicMock, patch
from lectern.ai_client import LecternAIClient
from lectern.ai_schemas import ConceptMapResponse

@patch("lectern.ai_client.genai.Client")
def test_language_detection_integration(mock_client_cls):
    # Setup mock
    mock_chat = MagicMock()
    mock_client_cls.return_value.chats.create.return_value = mock_chat
    
    # Mock response with German language detection
    mock_response = MagicMock()
    mock_response.text = '{"objectives": [], "concepts": [], "relations": [], "language": "de"}'
    mock_chat.send_message.return_value = mock_response
    
    client = LecternAIClient()
    
    # Initial state
    assert client._prompt_config.language == "en"
    
    # Run concept map
    client.concept_map([{"text": "German text"}])
    
    # Verify language updated
    assert client._prompt_config.language == "de"
    
    # Verify prompt builder updated
    assert "Output language: de" in client._prompt_builder.system

@patch("lectern.ai_client.genai.Client")
def test_client_init_with_language(mock_client_cls):
    client = LecternAIClient(language="fr")
    assert client._prompt_config.language == "fr"
    assert "Output language: fr" in client._prompt_builder.system
