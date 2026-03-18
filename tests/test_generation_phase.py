from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from lectern import config
from lectern.events.domain import ProgressUpdatedEvent
from lectern.events.service_events import ServiceEvent
from lectern.orchestration.phases import GenerationPhase
from lectern.orchestration.pipeline_context import SessionConfig, SessionContext
from lectern.orchestration.session_orchestrator import (
    GenerationSetupConfig,
    GenerationSetupResult,
    SessionOrchestrator,
)


@dataclass
class RecordingEmitter:
    events: list[ServiceEvent]

    def __init__(self) -> None:
        self.events = []

    async def emit_event(self, event: ServiceEvent) -> None:
        self.events.append(event)


def _context() -> SessionContext:
    return SessionContext(
        config=SessionConfig(
            pdf_path="/tmp/slides.pdf",
            deck_name="Deck A",
            model_name="gemini-3-flash",
            tags=[],
            skip_export=False,
            focus_prompt=None,
            target_card_count=24,
            session_id="s-1",
            entry_id="e-1",
        )
    )


def test_prepare_generation_computes_targets_and_initial_coverage() -> None:
    orchestrator = SessionOrchestrator()
    pages = [{"number": i} for i in range(8)]
    concept_map = {"document_type": "script", "concepts": [], "relations": []}

    with patch(
        "lectern.orchestration.session_orchestrator.derive_effective_target",
        return_value=(2.5, "script"),
    ) as derive_mock, patch(
        "lectern.orchestration.session_orchestrator.estimate_card_cap",
        return_value=(42, True),
    ) as cap_mock, patch(
        "lectern.orchestration.session_orchestrator.compute_coverage_data",
        return_value={"total_pages": 8, "covered_page_count": 0},
    ) as coverage_mock:
        setup = orchestrator.prepare_generation(
            GenerationSetupConfig(
                pages=pages,
                concept_map=concept_map,
                examples="few-shot examples",
                estimated_text_chars=6400,
                image_count=3,
                target_card_count=24,
            )
        )

    derive_mock.assert_called_once_with(
        page_count=8,
        estimated_text_chars=6400,
        target_card_count=24,
        density_target=None,
        script_base_chars=config.SCRIPT_BASE_CHARS,
        force_mode="script",
    )
    cap_mock.assert_called_once_with(
        page_count=8,
        estimated_text_chars=6400,
        image_count=3,
        density_target=None,
        target_card_count=24,
        script_base_chars=config.SCRIPT_BASE_CHARS,
        force_mode="script",
    )
    coverage_mock.assert_called_once_with(
        cards=[],
        concept_map=concept_map,
        total_pages=8,
    )

    assert setup.effective_target == 2.5
    assert setup.total_cards_cap == 42
    assert setup.is_script_mode is True
    assert setup.chars_per_page == 800.0
    assert setup.initial_coverage["total_pages"] == 8
    assert orchestrator.state.pages == pages
    assert orchestrator.state.concept_map == concept_map
    assert orchestrator.state.examples == "few-shot examples"


@pytest.mark.asyncio
async def test_generation_phase_maps_domain_events_and_updates_context() -> None:
    emitter = RecordingEmitter()
    context = _context()
    context.pages = [{"number": i} for i in range(8)]
    context.concept_map = {"concepts": [], "relations": []}
    context.examples = "example style"
    context.pdf.metadata_chars = 6400
    context.pdf.image_count = 3

    fake_orchestrator = MagicMock()
    fake_orchestrator.state = SimpleNamespace(
        all_cards=[{"front": "Q1", "back": "A1"}],
        seen_keys={"q1"},
    )
    fake_orchestrator.prepare_generation.return_value = GenerationSetupResult(
        effective_target=2.5,
        total_cards_cap=42,
        is_script_mode=True,
        chars_per_page=800.0,
        initial_coverage={"total_pages": 8, "covered_page_count": 0},
    )
    fake_orchestrator.should_stop.return_value = False

    async def run_generation(*args, **kwargs):
        del args, kwargs
        yield ProgressUpdatedEvent(current=1)

    async def run_reflection(*args, **kwargs):
        del args, kwargs
        if False:
            yield

    fake_orchestrator.run_generation = run_generation
    fake_orchestrator.run_reflection = run_reflection

    with patch(
        "lectern.orchestration.phases.SessionOrchestrator",
        return_value=fake_orchestrator,
    ), patch(
        "lectern.orchestration.phases.compute_coverage_data",
        return_value={"total_pages": 8, "covered_page_count": 1},
    ):
        await GenerationPhase().execute(context, emitter, MagicMock())

    assert context.targets.effective_target == 2.5
    assert context.targets.total_cards_cap == 42
    assert context.targets.is_script_mode is True
    assert context.all_cards == [{"front": "Q1", "back": "A1"}]
    assert context.final_coverage["total_pages"] == 8
    assert any(ev.type == "progress_update" for ev in emitter.events)
