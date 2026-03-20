from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi.testclient import TestClient

from gui.backend.dependencies import get_history_repository_v2
from gui.backend.main import app
from lectern.domain.generation.events import CardEmitted, DomainEventRecord

client = TestClient(app)


@dataclass
class _HistoryRepoStub:
    snapshot: dict[str, Any] | None
    events: list[DomainEventRecord]

    async def get_session(self, _session_id: str) -> dict[str, Any] | None:
        return self.snapshot

    async def get_events_after(
        self,
        _session_id: str,
        *,
        after_sequence_no: int,
        limit: int = 1000,
    ) -> list[DomainEventRecord]:
        del limit
        return [event for event in self.events if event.sequence_no > after_sequence_no]


def test_get_session_v2_returns_not_found_payload_for_missing_session() -> None:
    app.dependency_overrides[get_history_repository_v2] = lambda: _HistoryRepoStub(
        snapshot=None,
        events=[],
    )
    try:
        response = client.get("/session-v2/non-existent-session")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == "non-existent-session"
    assert payload["not_found"] is True
    assert payload["cards"] == []


def test_get_session_v2_projects_cards_from_event_log() -> None:
    snapshot = {"session_id": "session-1", "status": "running", "cursor": 1}
    events = [
        DomainEventRecord(
            session_id="session-1",
            sequence_no=1,
            event=CardEmitted(
                card_uid="card-1",
                batch_index=0,
                card_payload={"front": "Q", "back": "A"},
            ),
        )
    ]

    app.dependency_overrides[get_history_repository_v2] = lambda: _HistoryRepoStub(
        snapshot=snapshot,
        events=events,
    )
    try:
        response = client.get("/session-v2/session-1")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"] == "session-1"
    assert payload["status"] == "running"
    assert payload["cards"][0]["front"] == "Q"
    assert payload["cards"][0]["uid"]
