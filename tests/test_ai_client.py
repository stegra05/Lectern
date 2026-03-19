import pytest
import os
import tempfile
from unittest.mock import patch, MagicMock, AsyncMock
from lectern.ai_client import LecternAIClient, UploadedDocument, DocumentUploadError
from lectern.ai_schemas import CardGenerationResponse, card_generation_schema


@pytest.fixture
def mock_genai_client():
    with patch("google.genai.Client") as MockClient:
        instance = MockClient.return_value
        # Mock chat creation via aio
        mock_chat = MagicMock()
        mock_chat.history = []
        mock_chat.send_message = AsyncMock()
        instance.aio.chats.create.return_value = mock_chat

        # Mock other aio methods
        instance.aio.files.upload = AsyncMock()
        instance.aio.models.count_tokens = AsyncMock()

        yield instance


@pytest.fixture
def ai_client(mock_genai_client):
    with patch("lectern.config.GEMINI_API_KEY", "fake_key"):
        client = LecternAIClient(model_name="test-model")
        return client


def test_initialization(ai_client, mock_genai_client):
    mock_genai_client.aio.chats.create.assert_called_once()
    call_args = mock_genai_client.aio.chats.create.call_args
    assert call_args.kwargs["model"] == "test-model"


@pytest.mark.asyncio
async def test_update_language(ai_client):
    ai_client.update_language("de")
    mock_response = MagicMock()
    mock_response.text = '{"cards": [], "done": true}'
    ai_client._chat.send_message.return_value = mock_response

    await ai_client.generate_more_cards(limit=1)

    call_args = ai_client._chat.send_message.call_args
    sent_prompt = call_args.kwargs["message"]
    assert "Language" in sent_prompt
    assert "de" in sent_prompt


