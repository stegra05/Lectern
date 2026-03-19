from __future__ import annotations

import json
import hashlib
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from lectern import config
from lectern.events.domain import ProgressUpdatedEvent
from lectern.events.service_events import ServiceEvent
from lectern.orchestration import phases
from lectern.orchestration.phases import GenerationPhase
from lectern.orchestration.pipeline_context import SessionConfig, SessionContext
from lectern.orchestration.session_orchestrator import (
    GenerationSetupConfig,
    GenerationSetupResult,
    SessionOrchestrator,
)
from lectern.utils.history import HistoryManager
from gui.backend.main import app
from gui.backend.dependencies import get_generation_service


@dataclass
class RecordingEmitter:
    events: list[ServiceEvent]

    def __init__(self) -> None:
        self.events = []

    async def emit_event(self, event: ServiceEvent) -> None:
        self.events.append(event)


client = TestClient(app)


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


def test_compute_hybrid_batch_size_prefers_target_with_page_guardrail() -> None:
    helper = getattr(phases, "_compute_hybrid_batch_size", None)
    assert helper is not None
    assert helper(total_cards_cap=100, page_count=60) == 21


def test_compute_hybrid_batch_size_small_target_hits_dynamic_min() -> None:
    helper = getattr(phases, "_compute_hybrid_batch_size", None)
    assert helper is not None
    assert helper(total_cards_cap=20, page_count=20) == 10


def test_compute_hybrid_batch_size_normalizes_inverted_bounds() -> None:
    helper = getattr(phases, "_compute_hybrid_batch_size", None)
    assert helper is not None
    assert (
        helper(
            total_cards_cap=100,
            page_count=60,
            dynamic_min=30,
            dynamic_max=12,
            guardrail_min_ratio=0.0,
            guardrail_max_ratio=10.0,
            guardrail_floor=0,
        )
        == 15
    )


def test_compute_hybrid_batch_size_applies_guardrail_max_cap() -> None:
    helper = getattr(phases, "_compute_hybrid_batch_size", None)
    assert helper is not None
    assert (
        helper(
            total_cards_cap=100,
            page_count=16,
            guardrail_min_ratio=0.0,
            guardrail_max_ratio=0.8,
            guardrail_floor=0,
            dynamic_min=1,
            dynamic_max=100,
        )
        == 6
    )


def test_compute_hybrid_batch_size_applies_dynamic_max_clamp() -> None:
    helper = getattr(phases, "_compute_hybrid_batch_size", None)
    assert helper is not None
    assert (
        helper(
            total_cards_cap=200,
            page_count=100,
            dynamic_ratio=0.5,
            dynamic_min=1,
            dynamic_max=17,
            guardrail_min_ratio=0.0,
            guardrail_max_ratio=10.0,
            guardrail_floor=0,
        )
        == 17
    )


def test_compute_hybrid_batch_size_normalizes_inverted_guardrail_ratios() -> None:
    helper = getattr(phases, "_compute_hybrid_batch_size", None)
    assert helper is not None
    assert (
        helper(
            total_cards_cap=100,
            page_count=60,
            guardrail_min_ratio=1.3,
            guardrail_max_ratio=0.7,
        )
        == 21
    )


def test_compute_hybrid_batch_size_uses_python_round_semantics() -> None:
    helper = getattr(phases, "_compute_hybrid_batch_size", None)
    assert helper is not None
    assert (
        helper(
            total_cards_cap=50,
            page_count=20,
            dynamic_ratio=0.25,
            dynamic_min=1,
            dynamic_max=100,
            guardrail_min_ratio=0.0,
            guardrail_max_ratio=10.0,
            guardrail_floor=0,
        )
        == 12
    )


def test_compute_hybrid_batch_size_non_positive_cap_falls_back_to_page_center() -> None:
    helper = getattr(phases, "_compute_hybrid_batch_size", None)
    assert helper is not None
    assert helper(total_cards_cap=0, page_count=60) == 25


def test_compute_hybrid_batch_size_zero_pages_returns_valid_bounded_result() -> None:
    helper = getattr(phases, "_compute_hybrid_batch_size", None)
    assert helper is not None
    result = helper(total_cards_cap=100, page_count=0)
    assert 10 <= result <= 25
    assert result == 10


@pytest.mark.parametrize(
    "invalid_ratio",
    [0, -0.1, "oops", float("nan"), float("inf"), float("-inf")],
)
def test_compute_hybrid_batch_size_invalid_ratio_falls_back_to_default(
    invalid_ratio: object,
) -> None:
    helper = getattr(phases, "_compute_hybrid_batch_size", None)
    assert helper is not None
    assert helper(total_cards_cap=100, page_count=60, dynamic_ratio=invalid_ratio) == 21


def test_compute_hybrid_batch_size_invalid_min_max_and_floor_fallback_to_defaults() -> None:
    helper = getattr(phases, "_compute_hybrid_batch_size", None)
    assert helper is not None
    assert (
        helper(
            total_cards_cap=100,
            page_count=16,
            dynamic_ratio=1.0,
            dynamic_min=0,
            dynamic_max=-3,
            guardrail_min_ratio=0.0,
            guardrail_max_ratio=10.0,
            guardrail_floor=-9,
        )
        == 25
    )


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
    assert context.targets.actual_batch_size == 10
    assert context.all_cards == [{"front": "Q1", "back": "A1"}]
    assert context.final_coverage["total_pages"] == 8
    assert any(ev.type == "progress_update" for ev in emitter.events)


def test_generate_rejects_malformed_tags_payload_with_structured_error() -> None:
    files = {"pdf_file": ("test.pdf", b"pdf content", "application/pdf")}
    data = {
        "deck_name": "Deck A",
        "tags": "{not-valid-json",
    }

    response = client.post("/generate", files=files, data=data)

    assert response.status_code == 400
    assert response.json()["detail"] == {
        "code": "invalid_generation_input",
        "field": "tags",
        "reason": "invalid_json",
        "message": "Invalid generation input for 'tags': expected JSON array of strings.",
    }


def test_generate_rejects_resume_when_source_pdf_hash_mismatches() -> None:
    history_mgr = HistoryManager()
    history_mgr.clear_all()

    session_id = "resume-invariant-source-hash"
    try:
        history_mgr.add_entry(
            filename="original.pdf",
            deck="Deck A",
            session_id=session_id,
            status="draft",
            source_file_name="original.pdf",
            source_pdf_sha256="persisted-hash-value",
        )
        history_mgr.sync_session_state(
            session_id=session_id,
            cards=[],
            model_name="gemini-3-flash",
            source_file_name="original.pdf",
            source_pdf_sha256="persisted-hash-value",
        )

        async def mock_run(*args, **kwargs):
            del args, kwargs
            yield ServiceEvent("done", "Finished")

        mock_service = MagicMock()
        mock_service.run = mock_run
        app.dependency_overrides[get_generation_service] = lambda: mock_service
        response = client.post(
            "/generate",
            files={"pdf_file": ("incoming.pdf", b"new-pdf-content", "application/pdf")},
            data={
                "deck_name": "Deck A",
                "model_name": "gemini-3-flash",
                "tags": "[]",
                "session_id": session_id,
            },
        )
        assert response.status_code == 200
        events = [json.loads(line) for line in response.text.splitlines() if line.strip()]
        assert not any(evt["type"] == "session_resumed" for evt in events)
        assert any(
            evt["type"] == "warning"
            and evt.get("data", {}).get("warning_kind") == "invalid_resume_invariants"
            and "source_pdf_sha256"
            in evt.get("data", {}).get("mismatched_fields", [])
            for evt in events
        )
    finally:
        app.dependency_overrides.clear()
        history_mgr.clear_all()


def test_generate_session_resumed_includes_uid_for_legacy_cards() -> None:
    history_mgr = HistoryManager()
    history_mgr.clear_all()

    session_id = "resume-legacy-card-uid"
    pdf_bytes = b"legacy-resume-content"
    source_hash = hashlib.sha256(pdf_bytes).hexdigest()

    try:
        history_mgr.add_entry(
            filename="resume.pdf",
            deck="Deck A",
            session_id=session_id,
            status="draft",
            source_file_name="resume.pdf",
            source_pdf_sha256=source_hash,
        )
        history_mgr.sync_session_state(
            session_id=session_id,
            cards=[{"front": "Legacy Q", "back": "Legacy A"}],
            model_name="gemini-3-flash",
            source_file_name="resume.pdf",
            source_pdf_sha256=source_hash,
        )

        async def mock_run(*args, **kwargs):
            del args, kwargs
            yield ServiceEvent("done", "Finished")

        mock_service = MagicMock()
        mock_service.run = mock_run
        app.dependency_overrides[get_generation_service] = lambda: mock_service

        response = client.post(
            "/generate",
            files={"pdf_file": ("resume.pdf", pdf_bytes, "application/pdf")},
            data={
                "deck_name": "Deck A",
                "model_name": "gemini-3-flash",
                "tags": "[]",
                "session_id": session_id,
            },
        )

        assert response.status_code == 200
        events = [json.loads(line) for line in response.text.splitlines() if line.strip()]
        resumed_event = next(evt for evt in events if evt["type"] == "session_resumed")
        resumed_cards = resumed_event["data"]["cards"]
        assert len(resumed_cards) == 1
        assert resumed_cards[0].get("uid")
    finally:
        app.dependency_overrides.clear()
        history_mgr.clear_all()
