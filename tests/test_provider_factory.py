"""Tests for AI provider factory selection and defaults."""

from __future__ import annotations

import pytest

from lectern.providers.factory import DEFAULT_PROVIDER, GeminiProvider, create_provider


class _StubGeminiClient:
    log_path = "/tmp/test-ai.log"

    async def upload_document(self, pdf_path: str):
        return {"uri": f"gs://{pdf_path}", "mime_type": "application/pdf"}

    async def concept_map_from_file(self, file_uri: str, mime_type: str = "application/pdf"):
        return {"uri": file_uri, "mime_type": mime_type}

    async def concept_map(self, pdf_content: list[dict[str, object]]):
        return {"concepts": pdf_content}

    async def generate_more_cards(self, **kwargs):
        return {"cards": [], "done": True, "kwargs": kwargs}

    async def reflect(self, **kwargs):
        return {"cards": [], "done": True, "kwargs": kwargs}

    def set_slide_set_context(self, deck_name: str, slide_set_name: str) -> None:
        self._context = (deck_name, slide_set_name)

    def drain_warnings(self) -> list[str]:
        return []


def test_create_provider_selects_supported_provider() -> None:
    provider = create_provider("gemini", client=_StubGeminiClient())

    assert isinstance(provider, GeminiProvider)


def test_create_provider_rejects_unsupported_provider() -> None:
    with pytest.raises(ValueError, match="Unsupported provider") as excinfo:
        create_provider("openai")

    assert "gemini" in str(excinfo.value)


def test_create_provider_uses_default_provider_when_unspecified() -> None:
    provider = create_provider(client=_StubGeminiClient())

    assert DEFAULT_PROVIDER == "gemini"
    assert isinstance(provider, GeminiProvider)
