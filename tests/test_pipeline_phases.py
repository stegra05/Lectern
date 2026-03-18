from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from lectern.ai_client import DocumentUploadError, LecternAIClient, UploadedDocument
from lectern.events.service_events import ServiceEvent
from lectern.orchestration.pipeline_context import PipelinePhase, SessionConfig, SessionContext
from lectern.orchestration.phases import (
    ConceptMappingPhase,
    GenerationPhase,
    InitializationPhase,
    PhaseExecutionHalt,
)


@dataclass
class RecordingEmitter:
    events: list[ServiceEvent]

    def __init__(self) -> None:
        self.events = []

    async def emit_event(self, event: ServiceEvent) -> None:
        self.events.append(event)

    async def emit(self, event_type: str, message: str, data: dict | None = None) -> None:
        self.events.append(ServiceEvent(event_type, message, data or {}))

    async def step_start(self, message: str, data: dict | None = None) -> None:
        await self.emit("step_start", message, data)

    async def step_end(self, message: str, data: dict | None = None) -> None:
        await self.emit("step_end", message, data)

    async def progress_start(self, message: str, data: dict | None = None) -> None:
        await self.emit("progress_start", message, data)

    async def progress_update(self, message: str, data: dict | None = None) -> None:
        await self.emit("progress_update", message, data)

    async def info(self, message: str, data: dict | None = None) -> None:
        await self.emit("info", message, data)

    async def warning(self, message: str, data: dict | None = None) -> None:
        await self.emit("warning", message, data)

    async def error(self, message: str, data: dict | None = None) -> None:
        await self.emit("error", message, data)


def _context(*, pdf_path: str = "/tmp/slides.pdf", skip_export: bool = False) -> SessionContext:
    return SessionContext(
        config=SessionConfig(
            pdf_path=pdf_path,
            deck_name="Deck A",
            model_name="gemini-3-flash",
            tags=[],
            context_deck="",
            skip_export=skip_export,
            focus_prompt=None,
            target_card_count=None,
            session_id="s-1",
            entry_id="e-1",
        )
    )


def test_phases_implement_pipeline_phase_protocol() -> None:
    assert isinstance(InitializationPhase(), PipelinePhase)
    assert isinstance(ConceptMappingPhase(), PipelinePhase)
    assert isinstance(GenerationPhase(), PipelinePhase)


@pytest.mark.asyncio
async def test_initialization_phase_missing_pdf_emits_terminal_error() -> None:
    emitter = RecordingEmitter()
    context = _context(pdf_path="/missing/file.pdf")

    with patch("lectern.orchestration.phases.os.path.exists", return_value=False):
        with pytest.raises(PhaseExecutionHalt):
            await InitializationPhase().execute(context, emitter, MagicMock())

    assert any(
        ev.type == "error" and "PDF path not found" in ev.message for ev in emitter.events
    )


@pytest.mark.asyncio
async def test_initialization_phase_zero_byte_file_emits_terminal_error() -> None:
    emitter = RecordingEmitter()
    context = _context()

    with patch("lectern.orchestration.phases.os.path.exists", return_value=True), patch(
        "lectern.orchestration.phases.os.path.getsize", return_value=0
    ):
        with pytest.raises(PhaseExecutionHalt):
            await InitializationPhase().execute(context, emitter, MagicMock())

    assert any(
        ev.type == "error" and "empty (0 bytes)" in ev.message for ev in emitter.events
    )


@pytest.mark.asyncio
async def test_initialization_phase_populates_metadata_and_anki_success() -> None:
    emitter = RecordingEmitter()
    context = _context(skip_export=False)

    with patch("lectern.orchestration.phases.os.path.exists", return_value=True), patch(
        "lectern.orchestration.phases.os.path.getsize", return_value=4096
    ), patch(
        "lectern.orchestration.phases.extract_pdf_metadata",
        return_value={"page_count": 7, "text_chars": 2000, "image_count": 3},
    ), patch(
        "lectern.orchestration.phases.get_connection_info",
        new=AsyncMock(return_value={"connected": True, "collection_available": True}),
    ):
        await InitializationPhase().execute(context, emitter, MagicMock())

    assert context.pdf.file_size == 4096
    assert context.pdf.page_count == 7
    assert context.pdf.text_chars == 2000
    assert context.pdf.image_count == 3
    assert any(ev.type == "step_end" and ev.message == "AnkiConnect Connected" for ev in emitter.events)


@pytest.mark.asyncio
async def test_initialization_phase_debug_fallback_sets_skip_export() -> None:
    emitter = RecordingEmitter()
    context = _context(skip_export=False)

    with patch("lectern.orchestration.phases.os.path.exists", return_value=True), patch(
        "lectern.orchestration.phases.os.path.getsize", return_value=1000
    ), patch(
        "lectern.orchestration.phases.extract_pdf_metadata",
        return_value={"page_count": 1, "text_chars": 600, "image_count": 0},
    ), patch(
        "lectern.orchestration.phases.get_connection_info",
        new=AsyncMock(return_value={"connected": False, "error": "Connection refused"}),
    ), patch("lectern.orchestration.phases.config.DEBUG", True):
        await InitializationPhase().execute(context, emitter, MagicMock())

    assert context.config.skip_export is True
    assert any(ev.type == "warning" and "DEBUG is ON" in ev.message for ev in emitter.events)


@pytest.mark.asyncio
async def test_concept_mapping_phase_updates_context_on_success() -> None:
    emitter = RecordingEmitter()
    context = _context(skip_export=False)
    context.pdf.page_count = 10
    context.pdf.text_chars = 3200
    ai_client = MagicMock(spec=LecternAIClient)
    ai_client.upload_document = AsyncMock(
        return_value=UploadedDocument(
            uri="gs://doc.pdf", mime_type="application/pdf", duration_ms=50
        )
    )
    ai_client.concept_map_from_file = AsyncMock(
        return_value={
            "concepts": [{"name": "A"}],
            "relations": [],
            "page_count": 11,
            "estimated_text_chars": 3300,
            "slide_set_name": "Deck Topic",
        }
    )
    ai_client.concept_map = AsyncMock(return_value={})
    ai_client.drain_warnings = MagicMock(return_value=["model warned"])
    ai_client.set_slide_set_context = MagicMock()

    with patch(
        "lectern.orchestration.phases.sample_examples_from_deck",
        new=AsyncMock(return_value="Example 1"),
    ):
        await ConceptMappingPhase().execute(context, emitter, ai_client)

    assert context.examples == "Example 1"
    assert context.uploaded_pdf["uri"] == "gs://doc.pdf"
    assert context.concept_map.get("slide_set_name") == "Deck Topic"
    assert context.slide_set_name == "Deck Topic"
    assert context.pdf.metadata_pages == 11
    assert context.pdf.metadata_chars == 3300
    assert len(context.pages) == 11
    ai_client.set_slide_set_context.assert_called_once()
    assert any(ev.type == "warning" and "model warned" in ev.message for ev in emitter.events)
    session_started = next(
        ev
        for ev in emitter.events
        if ev.type == "step_end" and ev.message == "Session Started"
    )
    assert "duration_ms" in session_started.data


@pytest.mark.asyncio
async def test_concept_mapping_phase_upload_error_halts() -> None:
    emitter = RecordingEmitter()
    context = _context(skip_export=False)
    context.pdf.page_count = 3
    context.pdf.text_chars = 1000
    ai_client = MagicMock(spec=LecternAIClient)
    ai_client.upload_document = AsyncMock(
        side_effect=DocumentUploadError(
            "upload failed",
            user_message="Try again later",
        )
    )

    with patch(
        "lectern.orchestration.phases.sample_examples_from_deck",
        new=AsyncMock(return_value=""),
    ):
        with pytest.raises(PhaseExecutionHalt):
            await ConceptMappingPhase().execute(context, emitter, ai_client)

    error_event = next(
        ev
        for ev in emitter.events
        if ev.type == "error" and "Try again later" in ev.message
    )
    assert "elapsed_ms" in error_event.data
