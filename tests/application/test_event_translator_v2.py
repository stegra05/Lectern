from __future__ import annotations

import time

import pytest

from lectern.application.translators.event_translator import EventTranslator
from lectern.domain.generation.events import (
    CardEmitted,
    CardsReplaced,
    ErrorEmitted,
    PhaseCompleted,
    PhaseStarted,
    ProgressUpdated,
    SessionCancelled,
    SessionCompleted,
    SessionStarted,
    WarningEmitted,
)


FIXED_SESSION_ID = "api-session-123"
FIXED_SEQUENCE_NO = 9
FIXED_NOW_MS = 1710000000123


@pytest.mark.parametrize(
    ("domain_event", "expected_type", "expected_message", "expected_data"),
    [
        (
            SessionStarted(session_id="domain-session-1", mode="start"),
            "session_started",
            "",
            {"mode": "start"},
        ),
        (
            PhaseStarted(phase="generation"),
            "phase_started",
            "",
            {"phase": "generation"},
        ),
        (
            ProgressUpdated(phase="generation", current=2, total=5),
            "progress_updated",
            "",
            {"phase": "generation", "current": 2, "total": 5},
        ),
        (
            CardEmitted(
                card_uid="card-1",
                batch_index=3,
                card_payload={"front": "Front", "back": "Back"},
            ),
            "card_emitted",
            "",
            {"card": {"front": "Front", "back": "Back"}, "batch_index": 3},
        ),
        (
            CardsReplaced(
                batch_index=4,
                cards=[{"front": "Updated", "back": "Card"}],
                coverage_data={"covered_pages": [1], "total_pages": 2},
            ),
            "cards_replaced",
            "",
            {
                "cards": [{"front": "Updated", "back": "Card"}],
                "coverage_data": {"covered_pages": [1], "total_pages": 2},
            },
        ),
        (
            WarningEmitted(
                code="provider_generation_failed",
                message="Retrying provider generation",
                details={"attempt": 2},
            ),
            "warning_emitted",
            "Retrying provider generation",
            {"code": "provider_generation_failed", "details": {"attempt": 2}},
        ),
        (
            ErrorEmitted(
                code="internal_unexpected",
                message="Unexpected provider failure",
                stage="generation",
                recoverable=False,
            ),
            "error_emitted",
            "Unexpected provider failure",
            {
                "code": "internal_unexpected",
                "stage": "generation",
                "recoverable": False,
            },
        ),
        (
            PhaseCompleted(
                phase="reflection",
                duration_ms=1234,
                summary={"cards_refined": 7},
            ),
            "phase_completed",
            "",
            {"phase": "reflection", "duration_ms": 1234, "summary": {"cards_refined": 7}},
        ),
        (
            SessionCompleted(summary={"cards_exported": 42}),
            "session_completed",
            "",
            {"summary": {"cards_exported": 42}},
        ),
        (
            SessionCancelled(stage="reflection", reason="cancel requested"),
            "session_cancelled",
            "",
            {"stage": "reflection", "reason": "cancel requested"},
        ),
    ],
)
def test_to_api_event_maps_all_domain_event_variants(
    domain_event: object,
    expected_type: str,
    expected_message: str,
    expected_data: dict[str, object],
) -> None:
    translator = EventTranslator()
    api_event = translator.to_api_event(
        domain_event,
        session_id=FIXED_SESSION_ID,
        sequence_no=FIXED_SEQUENCE_NO,
        now_ms=FIXED_NOW_MS,
    )

    assert api_event.event_version == 2
    assert api_event.session_id == FIXED_SESSION_ID
    assert api_event.sequence_no == FIXED_SEQUENCE_NO
    assert api_event.type == expected_type
    assert api_event.message == expected_message
    assert api_event.timestamp == FIXED_NOW_MS
    assert api_event.data == expected_data


def test_to_api_event_uses_current_epoch_ms_when_now_ms_not_provided() -> None:
    before_ms = int(time.time() * 1000)
    translator = EventTranslator()
    api_event = translator.to_api_event(
        PhaseStarted(phase="generation"),
        session_id=FIXED_SESSION_ID,
        sequence_no=FIXED_SEQUENCE_NO,
    )
    after_ms = int(time.time() * 1000)

    assert before_ms <= api_event.timestamp <= after_ms
