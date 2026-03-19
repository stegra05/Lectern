from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from lectern.lectern_service import LecternGenerationService


class _FakeProvider:
    def __init__(self) -> None:
        self.log_path = "/tmp/provider.log"
        self.upload_document_calls: list[str] = []
        self.build_concept_map_calls: list[dict[str, Any]] = []
        self.generate_cards_calls: list[dict[str, Any]] = []
        self.reflect_cards_calls: list[dict[str, Any]] = []
        self.slide_set_context_calls: list[tuple[str, str]] = []
        self._generation_done = False

    async def upload_document(self, pdf_path: str) -> Any:
        self.upload_document_calls.append(pdf_path)
        from lectern.ai_client import UploadedDocument

        return UploadedDocument(
            uri="gs://provider-uploaded.pdf",
            mime_type="application/pdf",
            duration_ms=12,
        )

    async def build_concept_map(
        self,
        *,
        file_uri: str,
        mime_type: str = "application/pdf",
    ) -> dict[str, Any]:
        self.build_concept_map_calls.append(
            {
                "file_uri": file_uri,
                "mime_type": mime_type,
            }
        )
        return {
            "concepts": [],
            "relations": [],
            "page_count": 3,
            "estimated_text_chars": 1200,
            "slide_set_name": "Provider Lecture",
        }

    async def generate_cards(self, **kwargs: Any) -> dict[str, Any]:
        self.generate_cards_calls.append(kwargs)
        if self._generation_done:
            return {"cards": [], "done": True}
        self._generation_done = True
        return {
            "cards": [
                {
                    "fields": {"Front": "What is TDD?", "Back": "Test-first workflow"},
                    "slide_number": 1,
                    "slide_topic": "Testing",
                    "rationale": "Definition is explicitly stated on slide 1.",
                    "source_excerpt": "Slide 1 defines TDD as a test-first workflow.",
                }
            ],
            "done": True,
        }

    async def reflect_cards(self, **kwargs: Any) -> dict[str, Any]:
        self.reflect_cards_calls.append(kwargs)
        return {"cards": [], "done": True}

    def set_slide_set_context(self, *, deck_name: str, slide_set_name: str) -> None:
        self.slide_set_context_calls.append((deck_name, slide_set_name))

    def drain_warnings(self) -> list[str]:
        return []


@pytest.fixture
def pipeline_env():
    with (
        patch(
            "lectern.orchestration.phases.extract_pdf_metadata",
            return_value={"page_count": 3, "text_chars": 1200, "image_count": 0},
        ),
        patch(
            "lectern.orchestration.phases.sample_examples_from_deck",
            new_callable=AsyncMock,
            return_value="",
        ),
        patch("lectern.orchestration.phases.os.path.exists", return_value=True),
        patch("lectern.orchestration.phases.os.path.getsize", return_value=1024),
        patch("lectern.lectern_service.HistoryManager"),
    ):
        yield


@pytest.mark.asyncio
async def test_run_routes_through_provider_factory_and_preserves_event_lifecycle(
    pipeline_env,
) -> None:
    provider = _FakeProvider()
    with (
        patch(
            "lectern.lectern_service.create_provider",
            return_value=provider,
            create=True,
        ) as mock_create_provider,
        patch(
            "lectern.lectern_service.LecternAIClient",
            side_effect=AssertionError(
                "Service must not instantiate LecternAIClient directly"
            ),
            create=True,
        ) as legacy_ctor,
    ):
        service = LecternGenerationService()
        events = [
            event
            async for event in service.run(
                pdf_path="/fake/path.pdf",
                deck_name="Provider Deck",
                model_name="gemini-3-flash-preview",
                tags=["provider"],
                skip_export=True,
                focus_prompt="Prioritize definitions",
            )
        ]

    mock_create_provider.assert_called_once()
    _, create_kwargs = mock_create_provider.call_args
    assert "client" not in create_kwargs
    assert create_kwargs["model_name"] == "gemini-3-flash-preview"
    assert create_kwargs["focus_prompt"] == "Prioritize definitions"
    legacy_ctor.assert_not_called()

    event_types = [event.type for event in events if event.type != "control_snapshot"]
    assert "step_start" in event_types
    assert "step_end" in event_types
    assert any(event.type == "card" for event in events)
    assert any(event.type == "done" for event in events)

    assert provider.upload_document_calls == ["/fake/path.pdf"]
    assert provider.build_concept_map_calls
    assert provider.generate_cards_calls
    assert provider.reflect_cards_calls
    assert provider.slide_set_context_calls == [("Provider Deck", "Provider Lecture")]


@pytest.mark.asyncio
async def test_service_accepts_injected_provider_factory(pipeline_env) -> None:
    provider = _FakeProvider()
    captured: dict[str, Any] = {}

    def _provider_factory(provider_name: str | None = None, **kwargs: Any):
        captured["provider_name"] = provider_name
        captured["kwargs"] = kwargs
        return provider

    service = LecternGenerationService(
        provider_factory=_provider_factory,
        provider_name="gemini",
    )

    events = [
        event
        async for event in service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Provider Deck",
            model_name="gemini-3-flash-preview",
            tags=["provider"],
            skip_export=True,
        )
    ]

    assert captured["provider_name"] == "gemini"
    assert "client" not in captured["kwargs"]
    assert captured["kwargs"]["model_name"] == "gemini-3-flash-preview"
    assert any(event.type == "done" for event in events)


@pytest.mark.asyncio
async def test_run_passes_provider_adapter_through_canonical_entry(pipeline_env) -> None:
    provider = _FakeProvider()
    captured: dict[str, Any] = {}

    async def _capture_entry(*, context, emitter, ai_client, history_mgr, start_time):
        captured["context"] = context
        captured["emitter"] = emitter
        captured["ai_client"] = ai_client
        captured["history_mgr"] = history_mgr
        captured["start_time"] = start_time

    with (
        patch(
            "lectern.lectern_service.create_provider",
            return_value=provider,
            create=True,
        ),
        patch(
            "lectern.lectern_service.run_orchestration_entry",
            new_callable=AsyncMock,
            side_effect=_capture_entry,
            create=True,
        ) as mock_entry,
    ):
        service = LecternGenerationService()
        async for _ in service.run(
            pdf_path="/fake/path.pdf",
            deck_name="Provider Deck",
            model_name="gemini-3-flash-preview",
            tags=["provider"],
            skip_export=True,
        ):
            pass

    mock_entry.assert_awaited_once()
    assert captured["context"].config.deck_name == "Provider Deck"
    assert hasattr(captured["ai_client"], "generate_cards")
    assert hasattr(captured["ai_client"], "reflect_cards")
