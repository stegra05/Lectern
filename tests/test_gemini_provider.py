from __future__ import annotations

from typing import Any

import pytest

from lectern.providers.gemini_provider import GeminiProvider


class _StubGeminiClient:
    log_path = "/tmp/test-gemini-provider.log"

    def __init__(self) -> None:
        self.upload_document_calls: list[str] = []
        self.concept_map_from_file_calls: list[tuple[str, str]] = []
        self.generate_more_cards_calls: list[dict[str, Any]] = []
        self.reflect_calls: list[dict[str, Any]] = []
        self.repair_card_calls: list[dict[str, Any]] = []

        self.upload_document_result: Any = {
            "uri": "gs://uploaded-document.pdf",
            "mime_type": "application/pdf",
            "duration_ms": 12,
        }
        self.upload_document_error: Exception | None = None

        self.concept_map_from_file_result: Any = {"concepts": []}
        self.generate_more_cards_result: Any = {"cards": [], "done": True}
        self.reflect_result: Any = {"reflection": "", "cards": [], "done": True}
        self.repair_card_result: Any = {"card": {"front": "Q", "back": "A"}, "parse_error": ""}

    async def upload_document(self, pdf_path: str) -> Any:
        self.upload_document_calls.append(pdf_path)
        if self.upload_document_error is not None:
            raise self.upload_document_error
        return self.upload_document_result

    async def concept_map_from_file(
        self, file_uri: str, mime_type: str = "application/pdf"
    ) -> Any:
        self.concept_map_from_file_calls.append((file_uri, mime_type))
        return self.concept_map_from_file_result

    async def generate_more_cards(self, **kwargs: Any) -> Any:
        self.generate_more_cards_calls.append(kwargs)
        return self.generate_more_cards_result

    async def reflect(self, **kwargs: Any) -> Any:
        self.reflect_calls.append(kwargs)
        return self.reflect_result

    async def repair_card(
        self,
        *,
        card: dict[str, Any],
        reasons: list[str],
        context: dict[str, Any] | None = None,
    ) -> Any:
        self.repair_card_calls.append(
            {"card": card, "reasons": reasons, "context": context}
        )
        return self.repair_card_result

    def set_slide_set_context(self, deck_name: str, slide_set_name: str) -> None:
        self._context = (deck_name, slide_set_name)

    def drain_warnings(self) -> list[str]:
        return []


@pytest.mark.asyncio
async def test_upload_document_uses_upload_document_path() -> None:
    client = _StubGeminiClient()
    provider = GeminiProvider(client=client)

    result = await provider.upload_document("slides.pdf")

    assert result == {
        "uri": "gs://uploaded-document.pdf",
        "mime_type": "application/pdf",
        "duration_ms": 12,
    }
    assert client.upload_document_calls == ["slides.pdf"]


@pytest.mark.asyncio
async def test_upload_document_propagates_upload_document_error() -> None:
    client = _StubGeminiClient()
    client.upload_document_error = RuntimeError("upload failed")
    provider = GeminiProvider(client=client)

    with pytest.raises(RuntimeError, match="upload failed"):
        await provider.upload_document("slides.pdf")


@pytest.mark.asyncio
async def test_build_concept_map_prefers_native_file_path() -> None:
    client = _StubGeminiClient()
    provider = GeminiProvider(client=client)

    result = await provider.build_concept_map(file_uri="gs://slides.pdf")

    assert result == {"concepts": []}
    assert client.concept_map_from_file_calls == [
        ("gs://slides.pdf", "application/pdf")
    ]


@pytest.mark.asyncio
async def test_schema_guard_returns_empty_dict_for_non_dict_payloads() -> None:
    client = _StubGeminiClient()
    client.concept_map_from_file_result = "not-a-dict"
    client.generate_more_cards_result = []
    client.reflect_result = None
    provider = GeminiProvider(client=client)

    assert await provider.build_concept_map(file_uri="gs://slides.pdf") == {}
    assert await provider.generate_cards(limit=2) == {}
    assert await provider.reflect_cards(limit=2) == {}


@pytest.mark.asyncio
async def test_generate_cards_propagates_client_errors() -> None:
    client = _StubGeminiClient()
    provider = GeminiProvider(client=client)

    async def _raise(**kwargs: Any) -> Any:
        raise ValueError("generation failed")

    client.generate_more_cards = _raise  # type: ignore[method-assign]

    with pytest.raises(ValueError, match="generation failed"):
        await provider.generate_cards(limit=5)


@pytest.mark.asyncio
async def test_reflect_cards_propagates_client_errors() -> None:
    client = _StubGeminiClient()
    provider = GeminiProvider(client=client)

    async def _raise(**kwargs: Any) -> Any:
        raise ValueError("reflection failed")

    client.reflect = _raise  # type: ignore[method-assign]

    with pytest.raises(ValueError, match="reflection failed"):
        await provider.reflect_cards(limit=3)


@pytest.mark.asyncio
async def test_repair_card_delegates_to_client() -> None:
    client = _StubGeminiClient()
    provider = GeminiProvider(client=client)

    out = await provider.repair_card(
        card={"front": "Q", "back": "A"},
        reasons=["missing_source_excerpt"],
        context={"strict": True},
    )

    assert out == {"card": {"front": "Q", "back": "A"}, "parse_error": ""}
    assert client.repair_card_calls == [
        {
            "card": {"front": "Q", "back": "A"},
            "reasons": ["missing_source_excerpt"],
            "context": {"strict": True},
        }
    ]


@pytest.mark.asyncio
async def test_repair_card_propagates_client_errors() -> None:
    client = _StubGeminiClient()
    provider = GeminiProvider(client=client)

    async def _raise(
        *,
        card: dict[str, Any],
        reasons: list[str],
        context: dict[str, Any] | None = None,
    ) -> Any:
        raise ValueError("repair failed")

    client.repair_card = _raise  # type: ignore[method-assign]

    with pytest.raises(ValueError, match="repair failed"):
        await provider.repair_card(
            card={"front": "Q"},
            reasons=["missing_source_excerpt"],
        )
