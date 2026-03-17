"""Contract tests for pipeline context interfaces."""

from __future__ import annotations

import pytest

from lectern.lectern_service import GenerationConfig as LegacyGenerationConfig
from lectern.orchestration.session_orchestrator import (
    GenerationConfig as OrchestratorGenerationConfig,
)
from lectern.orchestration import (
    GenerationTargets as ExportedGenerationTargets,
    OrchestratorGenerationConfig as ExportedOrchestratorGenerationConfig,
    PDFMetadata as ExportedPDFMetadata,
    PipelinePhase as ExportedPipelinePhase,
    SessionConfig as ExportedSessionConfig,
    SessionContext as ExportedSessionContext,
)
from lectern.orchestration.pipeline_context import (
    GenerationTargets,
    PDFMetadata,
    PipelinePhase,
    SessionConfig,
    SessionContext,
)


def test_orchestration_exports_pipeline_context_types() -> None:
    assert ExportedSessionContext is SessionContext
    assert ExportedSessionConfig is SessionConfig
    assert ExportedPDFMetadata is PDFMetadata
    assert ExportedGenerationTargets is GenerationTargets
    assert ExportedPipelinePhase is PipelinePhase
    assert ExportedOrchestratorGenerationConfig is OrchestratorGenerationConfig


def test_session_config_defaults_and_custom_values() -> None:
    config = SessionConfig(
        pdf_path="/tmp/lecture.pdf",
        deck_name="Deck",
        model_name="Model",
        tags=["one", "two"],
        context_deck="Context",
        skip_export=True,
        focus_prompt="Focus on causality",
        target_card_count=42,
        session_id="session-1",
        entry_id="entry-1",
    )

    assert config.pdf_path == "/tmp/lecture.pdf"
    assert config.deck_name == "Deck"
    assert config.model_name == "Model"
    assert config.tags == ["one", "two"]
    assert config.context_deck == "Context"
    assert config.skip_export is True
    assert config.focus_prompt == "Focus on causality"
    assert config.target_card_count == 42
    assert config.session_id == "session-1"
    assert config.entry_id == "entry-1"


def test_pdf_metadata_derives_filename_from_path() -> None:
    metadata = PDFMetadata(path="/tmp/my_slides.pdf")

    assert metadata.path == "/tmp/my_slides.pdf"
    assert metadata.filename == "my_slides"
    assert metadata.title == ""
    assert metadata.page_count == 0
    assert metadata.text_chars == 0
    assert metadata.image_count == 0
    assert metadata.metadata_pages == 0
    assert metadata.metadata_chars == 0


def test_generation_targets_defaults_are_neutral() -> None:
    targets = GenerationTargets()

    assert targets.effective_target == 0.0
    assert targets.total_cards_cap == 0
    assert targets.actual_batch_size == 0
    assert targets.is_script_mode is False
    assert targets.chars_per_page == 0.0


def test_session_context_convenience_properties() -> None:
    config = SessionConfig(
        pdf_path="/tmp/slides.pdf",
        deck_name="Deck A",
        model_name="Model A",
        tags=["x"],
        session_id="session-abc",
    )
    context = SessionContext(config=config)
    context.all_cards = [{"front": "Q1"}, {"front": "Q2"}]
    context.pages = [{}, {}, {}]

    assert context.pdf.path == "/tmp/slides.pdf"
    assert context.pdf.filename == "slides"
    assert context.total_pages == 3
    assert context.card_count == 2
    assert context.deck_name == "Deck A"
    assert context.session_id == "session-abc"


def test_from_generation_config_factory_maps_legacy_fields() -> None:
    cfg = LegacyGenerationConfig(
        pdf_path="/tmp/legacy.pdf",
        deck_name="Legacy Deck",
        model_name="Legacy Model",
        tags=["legacy"],
        context_deck="Style Deck",
        skip_export=True,
        focus_prompt="Focus on big ideas",
        target_card_count=12,
        session_id="legacy-session",
        entry_id="legacy-entry",
    )

    context = SessionContext.from_generation_config(cfg)

    assert context.config.pdf_path == "/tmp/legacy.pdf"
    assert context.config.deck_name == "Legacy Deck"
    assert context.config.model_name == "Legacy Model"
    assert context.config.tags == ["legacy"]
    assert context.config.context_deck == "Style Deck"
    assert context.config.skip_export is True
    assert context.config.focus_prompt == "Focus on big ideas"
    assert context.config.target_card_count == 12
    assert context.config.session_id == "legacy-session"
    assert context.config.entry_id == "legacy-entry"
    assert context.pdf.path == "/tmp/legacy.pdf"
    assert context.pdf.filename == "legacy"


def test_from_generation_config_rejects_orchestrator_config() -> None:
    orchestrator_cfg = OrchestratorGenerationConfig(
        total_cards_cap=10,
        actual_batch_size=3,
        focus_prompt=None,
        effective_target=1.2,
        stop_check=None,
    )

    with pytest.raises(TypeError, match="expects legacy lectern_service.GenerationConfig"):
        SessionContext.from_generation_config(orchestrator_cfg)


def test_pipeline_phase_protocol_conformance() -> None:
    class DummyPhase:
        async def execute(
            self,
            context: SessionContext,
            emitter: object,
            ai_client: object,
        ) -> None:
            context.batch_index += 1

    phase = DummyPhase()
    assert isinstance(phase, PipelinePhase)
