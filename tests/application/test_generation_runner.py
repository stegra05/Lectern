from __future__ import annotations

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import pytest

from lectern.application.dto import ResumeGenerationRequest, StartGenerationRequest
from lectern.domain.generation.events import (
    CardEmitted,
    DomainEventRecord,
    PhaseStarted,
    SessionCompleted,
    WarningEmitted,
)
from lectern.generation_utils import evaluate_grounding_gate, get_card_key


def _start_request() -> StartGenerationRequest:
    return StartGenerationRequest(
        pdf_path="/tmp/deck.pdf",
        deck_name="Deck",
        model_name="gemini-2.5-flash",
        tags=["lecture"],
        focus_prompt="focus",
        target_card_count=8,
    )


def _resume_request(session_id: str = "session-1") -> ResumeGenerationRequest:
    return ResumeGenerationRequest(
        session_id=session_id,
        pdf_path="/tmp/deck.pdf",
        deck_name="Deck",
        model_name="gemini-2.5-flash",
    )


def _weak_card(front: str = "Weak Q") -> dict[str, Any]:
    return {
        "model_name": "Basic",
        "fields": {"Front": front, "Back": "A"},
        "source_pages": [1],
        "concept_ids": ["c1"],
    }


def _strong_card(front: str = "Strong Q") -> dict[str, Any]:
    return {
        "model_name": "Basic",
        "fields": {"Front": front, "Back": "A"},
        "source_pages": [1],
        "concept_ids": ["c1"],
        "rationale": "Essential foundational definition.",
        "source_excerpt": "Grounded in slide content.",
    }


@dataclass
class _StubPdfExtractor:
    metadata: Any

    async def extract_metadata(self, pdf_path: str) -> Any:
        del pdf_path
        return self.metadata


class _StubAIProvider:
    def __init__(self) -> None:
        self.upload_calls: list[str] = []
        self.concept_map_calls: list[dict[str, Any]] = []
        self.generate_calls: list[dict[str, Any]] = []
        self.reflect_calls: list[dict[str, Any]] = []
        self.repair_calls: list[dict[str, Any]] = []
        self._warnings: list[str] = []

        self.upload_result: Any = {
            "uri": "gs://deck.pdf",
            "mime_type": "application/pdf",
        }
        self.concept_map_result: dict[str, Any] = {
            "objectives": ["Understand c1"],
            "concepts": [
                {
                    "id": "c1",
                    "name": "Concept 1",
                    "importance": "high",
                    "page_references": [1],
                }
            ],
            "relations": [],
            "page_count": 1,
            "estimated_text_chars": 600,
            "document_type": "slides",
        }
        self.generate_responses: list[dict[str, Any]] = []
        self.reflect_responses: list[dict[str, Any]] = []
        self.repair_responses: list[dict[str, Any]] = []

    async def upload_document(self, pdf_path: str) -> Any:
        self.upload_calls.append(pdf_path)
        return self.upload_result

    async def build_concept_map(self, file_uri: str, mime_type: str) -> dict[str, Any]:
        self.concept_map_calls.append({"file_uri": file_uri, "mime_type": mime_type})
        return self.concept_map_result

    async def generate_cards(self, *, limit: int, context: Any) -> dict[str, Any]:
        self.generate_calls.append({"limit": limit, "context": context})
        if self.generate_responses:
            return self.generate_responses.pop(0)
        return {"cards": [], "done": True, "parse_error": "", "warnings": []}

    async def reflect_cards(self, *, limit: int, context: Any) -> dict[str, Any]:
        self.reflect_calls.append({"limit": limit, "context": context})
        if self.reflect_responses:
            return self.reflect_responses.pop(0)
        return {"reflection": "", "cards": [], "done": True, "parse_error": "", "warnings": []}

    async def repair_card(
        self,
        *,
        card: dict[str, Any],
        reasons: list[str],
        context: Any = None,
    ) -> dict[str, Any]:
        self.repair_calls.append({"card": card, "reasons": reasons, "context": context})
        if self.repair_responses:
            return self.repair_responses.pop(0)
        return {"card": {}, "parse_error": "missing", "warnings": []}

    def drain_warnings(self) -> list[str]:
        warnings = list(self._warnings)
        self._warnings = []
        return warnings


class _StubHistoryRepository:
    def __init__(self, records: list[DomainEventRecord]) -> None:
        self.records = sorted(records, key=lambda record: record.sequence_no)
        self.calls: list[dict[str, Any]] = []

    async def get_events_after(
        self,
        session_id: str,
        *,
        after_sequence_no: int,
        limit: int = 1000,
    ) -> list[DomainEventRecord]:
        self.calls.append(
            {
                "session_id": session_id,
                "after_sequence_no": after_sequence_no,
                "limit": limit,
            }
        )
        out = [
            record
            for record in self.records
            if record.session_id == session_id and record.sequence_no > after_sequence_no
        ]
        return out[:limit]


async def _collect_events(async_iter: Any) -> list[Any]:
    return [event async for event in async_iter]


def _session_completed_summary(events: list[Any]) -> dict[str, Any]:
    for event in events:
        if isinstance(event, SessionCompleted):
            return event.summary
    raise AssertionError("SessionCompleted event not found")


def test_get_card_key_normalizes_front_and_cloze_markup() -> None:
    card = {"front": "What is {{c1::ATP}}?<br>"}
    assert get_card_key(card) == "what is atp"


def test_evaluate_grounding_gate_enforces_quality_and_provenance() -> None:
    card = {"quality_score": 45.0, "quality_flags": ["missing_source_excerpt"]}
    ok, reasons = evaluate_grounding_gate(card, min_quality=60.0)
    assert ok is False
    assert "missing_source_excerpt" in reasons
    assert "below_quality_threshold" in reasons


@pytest.mark.asyncio
async def test_start_runner_repairs_then_promotes_card() -> None:
    from lectern.application.runners.generation_runner import make_start_runner

    ai_provider = _StubAIProvider()
    ai_provider.generate_responses = [
        {"cards": [_weak_card("Repair me")], "done": True, "parse_error": "", "warnings": []}
    ]
    ai_provider.repair_responses = [
        {"card": _strong_card("Repair me"), "parse_error": "", "warnings": []}
    ]
    ai_provider.reflect_responses = [
        {"reflection": "ok", "cards": [], "done": True, "parse_error": "", "warnings": []}
    ]

    runner = make_start_runner(
        pdf_extractor=_StubPdfExtractor(
            SimpleNamespace(page_count=1, text_chars=600, image_count=0)
        ),
        ai_provider=ai_provider,
    )

    events = await _collect_events(runner(_start_request()))

    assert any(isinstance(event, CardEmitted) for event in events)
    assert not any(
        isinstance(event, WarningEmitted) and event.code == "card_dropped_after_repair"
        for event in events
    )
    assert ai_provider.repair_calls[0]["context"]["strict"] is False


@pytest.mark.asyncio
async def test_start_runner_drops_card_after_strict_retry_failure() -> None:
    from lectern.application.runners.generation_runner import make_start_runner

    ai_provider = _StubAIProvider()
    ai_provider.generate_responses = [
        {"cards": [_weak_card("Drop me")], "done": True, "parse_error": "", "warnings": []},
        {"cards": [], "done": True, "parse_error": "", "warnings": []},
    ]
    ai_provider.repair_responses = [
        {"card": _weak_card("Drop me"), "parse_error": "", "warnings": []},
        {"card": _weak_card("Drop me"), "parse_error": "", "warnings": []},
    ]
    ai_provider.reflect_responses = [
        {"reflection": "ok", "cards": [], "done": True, "parse_error": "", "warnings": []}
    ]

    runner = make_start_runner(
        pdf_extractor=_StubPdfExtractor(
            SimpleNamespace(page_count=1, text_chars=600, image_count=0)
        ),
        ai_provider=ai_provider,
    )

    events = await _collect_events(runner(_start_request()))

    dropped = [
        event
        for event in events
        if isinstance(event, WarningEmitted) and event.code == "card_dropped_after_repair"
    ]
    assert len(dropped) == 1
    assert int(dropped[0].details["attempts"]) == 2
    assert not any(isinstance(event, CardEmitted) for event in events)
    assert ai_provider.repair_calls[1]["context"]["strict"] is True


@pytest.mark.asyncio
async def test_resume_runner_continues_generation_phase_from_snapshot() -> None:
    from lectern.application.runners.generation_runner import make_resume_runner

    existing_card = _strong_card("Existing Card")
    history = _StubHistoryRepository(
        [
            DomainEventRecord(
                session_id="session-1",
                sequence_no=1,
                event=CardEmitted(
                    card_uid="existing-uid",
                    batch_index=1,
                    card_payload=existing_card,
                ),
            )
        ]
    )
    ai_provider = _StubAIProvider()
    ai_provider.generate_responses = [
        {"cards": [], "done": True, "parse_error": "", "warnings": []}
    ]
    ai_provider.reflect_responses = [
        {"reflection": "done", "cards": [], "done": True, "parse_error": "", "warnings": []}
    ]

    runner = make_resume_runner(
        pdf_extractor=_StubPdfExtractor(
            SimpleNamespace(page_count=1, text_chars=600, image_count=0)
        ),
        ai_provider=ai_provider,
        history=history,
    )
    session = {"session_id": "session-1", "phase": "generation", "cursor": 1}

    events = await _collect_events(runner(_resume_request(), session))

    assert any(
        isinstance(event, PhaseStarted) and event.phase == "generation"
        for event in events
    )
    assert ai_provider.generate_calls
    avoid_fronts = ai_provider.generate_calls[0]["context"]["avoid_fronts"]
    assert any("existing card" in front for front in avoid_fronts)


@pytest.mark.asyncio
async def test_resume_runner_continues_reflection_phase_from_snapshot() -> None:
    from lectern.application.runners.generation_runner import make_resume_runner

    history = _StubHistoryRepository(
        [
            DomainEventRecord(
                session_id="session-1",
                sequence_no=1,
                event=CardEmitted(
                    card_uid="existing-uid",
                    batch_index=1,
                    card_payload=_strong_card("Card 1"),
                ),
            )
        ]
    )
    ai_provider = _StubAIProvider()
    ai_provider.reflect_responses = [
        {"reflection": "done", "cards": [], "done": True, "parse_error": "", "warnings": []}
    ]

    runner = make_resume_runner(
        pdf_extractor=_StubPdfExtractor(
            SimpleNamespace(page_count=1, text_chars=600, image_count=0)
        ),
        ai_provider=ai_provider,
        history=history,
    )
    session = {"session_id": "session-1", "phase": "reflection", "cursor": 1}

    events = await _collect_events(runner(_resume_request(), session))

    assert any(
        isinstance(event, PhaseStarted) and event.phase == "reflection"
        for event in events
    )
    assert ai_provider.generate_calls == []
    assert ai_provider.reflect_calls


@pytest.mark.asyncio
async def test_start_runner_emits_user_facing_under_target_completion_summary() -> None:
    from lectern.application.runners.generation_runner import make_start_runner

    ai_provider = _StubAIProvider()
    ai_provider.generate_responses = [
        {"cards": [_strong_card("Only one strong card")], "done": True, "parse_error": "", "warnings": []}
    ]
    ai_provider.reflect_responses = [
        {"reflection": "ok", "cards": [], "done": True, "parse_error": "", "warnings": []}
    ]

    runner = make_start_runner(
        pdf_extractor=_StubPdfExtractor(
            SimpleNamespace(page_count=1, text_chars=600, image_count=0)
        ),
        ai_provider=ai_provider,
    )

    events = await _collect_events(runner(_start_request()))
    summary = _session_completed_summary(events)

    assert summary["requested_card_target"] == 8
    assert summary["cards_generated"] == 1
    assert summary["target_shortfall"] == 7
    assert summary["termination_reason_code"] == "coverage_sufficient_model_done"
    assert isinstance(summary["termination_reason_text"], str)
    assert summary["termination_reason_text"].strip()
    assert isinstance(summary["run_summary_text"], str)
    assert "Generated 1 of requested 8 cards" in summary["run_summary_text"]
