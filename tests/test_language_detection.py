import pytest
import json
from unittest.mock import MagicMock, patch, AsyncMock
from lectern.ai_client import LecternAIClient


@pytest.mark.asyncio
@patch("lectern.ai_client.genai.Client")
async def test_language_detection_integration(mock_client_cls):
    # Setup mock
    mock_chat = MagicMock()
    # LecternAIClient uses self._client.aio.chats.create
    mock_client_cls.return_value.aio.chats.create.return_value = mock_chat

    # Mock response with German language detection
    mock_response = MagicMock()
    mock_response.text = '{"objectives": [], "concepts": [], "relations": [], "language": "de", "slide_set_name": "Test", "page_count": 1, "estimated_text_chars": 100, "document_type": "slides"}'
    # Ensure send_message is an AsyncMock and returns our mock response
    mock_chat.send_message = AsyncMock(return_value=mock_response)

    client = LecternAIClient()

    # Initial state
    assert client._prompt_config.language == "en"

    # Run concept map
    await client.concept_map([{"text": "German text"}])

    # Verify language updated
    assert client._prompt_config.language == "de"
