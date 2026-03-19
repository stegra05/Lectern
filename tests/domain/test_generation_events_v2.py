from __future__ import annotations

import pytest

from lectern.domain.generation.events import (
    CardEmitted,
    DomainEventRecord,
    DomainEventType,
    PhaseStarted,
    SessionStarted,
)


def test_domain_event_catalog_matches_v2_spec() -> None:
    expected = {
        "session_started",
        "phase_started",
        "progress_updated",
        "card_emitted",
        "cards_replaced",
        "warning_emitted",
        "error_emitted",
        "phase_completed",
        "session_completed",
        "session_cancelled",
    }

    actual = {event_type.value for event_type in DomainEventType}
    assert actual == expected


def test_domain_event_record_exposes_idempotency_key_tuple() -> None:
    record = DomainEventRecord(
        session_id="session-123",
        sequence_no=7,
        event=SessionStarted(session_id="session-123", mode="start"),
    )

    assert record.idempotency_key == ("session-123", 7)


def test_domain_event_record_sequence_can_be_ordered_per_session() -> None:
    first = DomainEventRecord(
        session_id="s1",
        sequence_no=1,
        event=SessionStarted(session_id="s1", mode="start"),
    )
    second = DomainEventRecord(
        session_id="s1",
        sequence_no=2,
        event=PhaseStarted(phase="generation"),
    )

    assert second.sequence_no > first.sequence_no


@pytest.mark.parametrize("card_uid", ["", "   "])
def test_card_emitted_requires_non_empty_card_uid(card_uid: str) -> None:
    with pytest.raises(ValueError):
        CardEmitted(card_uid=card_uid, batch_index=0, card_payload={})
