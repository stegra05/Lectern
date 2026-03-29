import pytest
import os
import tempfile
from typing import Any
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


@pytest.mark.asyncio
async def test_repair_card_uses_repair_prompt_and_returns_structured_result(ai_client):
    mock_response = MagicMock()
    mock_response.text = '{"card": {"front": "Q repaired", "back": "A repaired"}, "parse_error": ""}'

    captured: dict[str, Any] = {}

    async def fake_send(message: Any, call_config: Any) -> Any:
        captured["message"] = message
        captured["call_config"] = call_config
        return mock_response

    ai_client._send_with_thinking_fallback = fake_send  # type: ignore[method-assign]

    result = await ai_client.repair_card(
        card={"front": "Q", "back": "A"},
        reasons=["missing_source_excerpt", "below_quality_threshold"],
        context={"strict": True},
    )

    assert result == {
        "card": {"front": "Q repaired", "back": "A repaired"},
        "parse_error": "",
    }
    sent_prompt = captured["message"]
    assert "Repair exactly one flashcard" in sent_prompt
    assert "missing_source_excerpt" in sent_prompt
    assert "below_quality_threshold" in sent_prompt
    assert "STRICT MODE" in sent_prompt


@pytest.mark.asyncio
async def test_repair_card_returns_parse_error_when_payload_invalid(ai_client):
    mock_response = MagicMock()
    mock_response.text = '{"cards": [], "done": true}'
    ai_client._send_with_thinking_fallback = AsyncMock(return_value=mock_response)

    result = await ai_client.repair_card(
        card={"front": "Q"},
        reasons=["missing_source_excerpt"],
    )

    assert result["card"] == {}
    assert result["parse_error"]

