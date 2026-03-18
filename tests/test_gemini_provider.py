from __future__ import annotations

from typing import Any

import pytest

from lectern.providers.gemini_provider import GeminiProvider


class _StubGeminiClient:
    log_path = "/tmp/test-gemini-provider.log"

    def __init__(self) -> None:
        self.upload_pdf_calls: list[tuple[str, int]] = []
        self.upload_document_calls: list[str] = []
        self.concept_map_from_file_calls: list[tuple[str, str]] = []
        self.concept_map_calls: list[list[dict[str, Any]]] = []
        self.generate_more_cards_calls: list[dict[str, Any]] = []
        self.reflect_calls: list[dict[str, Any]] = []

        self.upload_pdf_result: Any = {
            "uri": "gs://uploaded.pdf",
            "mime_type": "application/pdf",
        }
        self.upload_pdf_error: Exception | None = None

        self.concept_map_from_file_result: Any = {"concepts": []}
        self.concept_map_result: Any = {"concepts": []}
        self.generate_more_cards_result: Any = {"cards": [], "done": True}
        self.reflect_result: Any = {"reflection": "", "cards": [], "done": True}

    async def upload_pdf(self, pdf_path: str, retries: int = 3) -> Any:
        self.upload_pdf_calls.append((pdf_path, retries))
        if self.upload_pdf_error is not None:
            raise self.upload_pdf_error
        return self.upload_pdf_result

    async def upload_document(self, pdf_path: str) -> Any:
        self.upload_document_calls.append(pdf_path)
        raise AssertionError("GeminiProvider should use upload_pdf compatibility path")

    async def concept_map_from_file(
        self, file_uri: str, mime_type: str = "application/pdf"
    ) -> Any:
        self.concept_map_from_file_calls.append((file_uri, mime_type))
        return self.concept_map_from_file_result

    async def concept_map(self, pdf_content: list[dict[str, Any]]) -> Any:
        self.concept_map_calls.append(pdf_content)
        return self.concept_map_result

    async def generate_more_cards(self, **kwargs: Any) -> Any:
        self.generate_more_cards_calls.append(kwargs)
        return self.generate_more_cards_result

    async def reflect(self, **kwargs: Any) -> Any:
        self.reflect_calls.append(kwargs)
        return self.reflect_result

    def set_slide_set_context(self, deck_name: str, slide_set_name: str) -> None:
        self._context = (deck_name, slide_set_name)

    def drain_warnings(self) -> list[str]:
        return []


@pytest.mark.asyncio
async def test_upload_document_uses_upload_pdf_retry_path() -> None:
    client = _StubGeminiClient()
    provider = GeminiProvider(client=client)

    result = await provider.upload_document("slides.pdf")

    assert result == {"uri": "gs://uploaded.pdf", "mime_type": "application/pdf"}
    assert client.upload_pdf_calls == [("slides.pdf", 3)]
    assert client.upload_document_calls == []


@pytest.mark.asyncio
async def test_upload_document_propagates_upload_pdf_error() -> None:
    client = _StubGeminiClient()
    client.upload_pdf_error = RuntimeError("upload failed")
    provider = GeminiProvider(client=client)

    with pytest.raises(RuntimeError, match="upload failed"):
        await provider.upload_document("slides.pdf")


@pytest.mark.asyncio
async def test_build_concept_map_prefers_native_file_path() -> None:
    client = _StubGeminiClient()
    provider = GeminiProvider(client=client)

    result = await provider.build_concept_map(file_uri="gs://slides.pdf")

    assert result == {"concepts": []}
    assert client.concept_map_from_file_calls == [("gs://slides.pdf", "application/pdf")]
    assert client.concept_map_calls == []


@pytest.mark.asyncio
async def test_build_concept_map_uses_pdf_content_when_no_file_uri() -> None:
    client = _StubGeminiClient()
    provider = GeminiProvider(client=client)
    payload = [{"page": 1, "text": "content"}]

    result = await provider.build_concept_map(pdf_content=payload)

    assert result == {"concepts": []}
    assert client.concept_map_calls == [payload]
    assert client.concept_map_from_file_calls == []


@pytest.mark.asyncio
async def test_schema_guard_returns_empty_dict_for_non_dict_payloads() -> None:
    client = _StubGeminiClient()
    client.concept_map_result = "not-a-dict"
    client.generate_more_cards_result = []
    client.reflect_result = None
    provider = GeminiProvider(client=client)

    assert await provider.build_concept_map(pdf_content=[]) == {}
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
