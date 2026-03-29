from __future__ import annotations

import asyncio
from typing import Any

from fastapi.testclient import TestClient
import pytest

from gui.backend.dependencies import get_history_manager, get_history_repository_v2
from gui.backend.main import app
from gui.backend.routers.history import BatchDeleteRequest, batch_delete_history

client = TestClient(app)


class _LegacyHistoryShouldNotBeUsed:
    def get_all(self) -> list[dict[str, Any]]:
        raise AssertionError("legacy history manager should not be used by /history endpoints")

    def get_entry(self, _entry_id: str) -> dict[str, Any] | None:
        raise AssertionError("legacy history manager should not be used by /history endpoints")

    def delete_entry(self, _entry_id: str) -> bool:
        raise AssertionError("legacy history manager should not be used by /history endpoints")

    def clear_all(self) -> None:
        raise AssertionError("legacy history manager should not be used by /history endpoints")

    def get_entries_by_status(self, _status: str) -> list[dict[str, Any]]:
        raise AssertionError("legacy history manager should not be used by /history endpoints")

    def delete_entries(self, _entry_ids: list[str]) -> int:
        raise AssertionError("legacy history manager should not be used by /history endpoints")


class _HistoryRepoStub:
    def __init__(self, sessions: list[dict[str, Any]] | None = None) -> None:
        self.sessions = sessions or []
        self.delete_calls: list[str] = []
        self.batch_delete_calls: list[list[str]] = []
        self.status_delete_calls: list[str] = []
        self.clear_calls = 0

    async def list_sessions(self, *, limit: int = 500) -> list[dict[str, Any]]:
        return list(self.sessions)[:limit]

    async def delete_session(self, session_id: str) -> bool:
        self.delete_calls.append(session_id)
        before = len(self.sessions)
        self.sessions = [row for row in self.sessions if row.get("session_id") != session_id]
        return len(self.sessions) < before

    async def delete_sessions(self, session_ids: list[str]) -> int:
        self.batch_delete_calls.append(list(session_ids))
        wanted = set(session_ids)
        before = len(self.sessions)
        self.sessions = [row for row in self.sessions if row.get("session_id") not in wanted]
        return before - len(self.sessions)

    async def delete_sessions_by_status(self, status: str) -> int:
        self.status_delete_calls.append(status)
        before = len(self.sessions)
        self.sessions = [row for row in self.sessions if row.get("status") != status]
        return before - len(self.sessions)

    async def clear_sessions(self) -> int:
        self.clear_calls += 1
        count = len(self.sessions)
        self.sessions = []
        return count


def test_get_history_projects_v2_sessions_and_maps_running_to_draft() -> None:
    repo = _HistoryRepoStub(
        sessions=[
            {
                "session_id": "s-running",
                "status": "running",
                "deck_name": "Deck A",
                "source_file_name": "slides-a.pdf",
                "card_count": 2,
                "created_at_ms": 1710000000000,
            },
            {
                "session_id": "s-completed",
                "status": "completed",
                "deck": "Deck B",
                "source_file_name": "slides-b.pdf",
                "card_count": 5,
                "created_at_ms": 1710000005000,
            },
        ]
    )
    app.dependency_overrides[get_history_repository_v2] = lambda: repo
    app.dependency_overrides[get_history_manager] = lambda: _LegacyHistoryShouldNotBeUsed()
    try:
        response = client.get("/history")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert [item["session_id"] for item in payload] == ["s-running", "s-completed"]
    assert payload[0]["id"] == "s-running"
    assert payload[0]["status"] == "draft"
    assert payload[0]["filename"] == "slides-a.pdf"
    assert payload[0]["deck"] == "Deck A"
    assert payload[0]["card_count"] == 2
    assert isinstance(payload[0]["date"], str)
    assert payload[1]["status"] == "completed"


def test_delete_history_entry_deletes_v2_session_by_id() -> None:
    repo = _HistoryRepoStub(sessions=[{"session_id": "session-1", "status": "completed"}])
    app.dependency_overrides[get_history_repository_v2] = lambda: repo
    app.dependency_overrides[get_history_manager] = lambda: _LegacyHistoryShouldNotBeUsed()
    try:
        response = client.delete("/history/session-1")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"status": "deleted"}
    assert repo.delete_calls == ["session-1"]


def test_delete_history_entry_returns_404_when_session_missing() -> None:
    repo = _HistoryRepoStub(sessions=[])
    app.dependency_overrides[get_history_repository_v2] = lambda: repo
    app.dependency_overrides[get_history_manager] = lambda: _LegacyHistoryShouldNotBeUsed()
    try:
        response = client.delete("/history/unknown-session")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404


def test_clear_history_clears_v2_sessions() -> None:
    repo = _HistoryRepoStub(
        sessions=[
            {"session_id": "session-1", "status": "running"},
            {"session_id": "session-2", "status": "completed"},
        ]
    )
    app.dependency_overrides[get_history_repository_v2] = lambda: repo
    app.dependency_overrides[get_history_manager] = lambda: _LegacyHistoryShouldNotBeUsed()
    try:
        response = client.delete("/history")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"status": "cleared"}
    assert repo.clear_calls == 1


def test_batch_delete_history_by_ids_uses_v2_repository() -> None:
    repo = _HistoryRepoStub(
        sessions=[
            {"session_id": "session-1", "status": "running"},
            {"session_id": "session-2", "status": "completed"},
            {"session_id": "session-3", "status": "error"},
        ]
    )
    app.dependency_overrides[get_history_repository_v2] = lambda: repo
    app.dependency_overrides[get_history_manager] = lambda: _LegacyHistoryShouldNotBeUsed()
    try:
        response = client.post("/history/batch-delete", json={"ids": ["session-1", "session-3"]})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"status": "deleted", "count": 2}
    assert repo.batch_delete_calls == [["session-1", "session-3"]]


def test_batch_delete_history_by_status_maps_draft_to_running() -> None:
    repo = _HistoryRepoStub(
        sessions=[
            {"session_id": "session-running", "status": "running"},
            {"session_id": "session-completed", "status": "completed"},
        ]
    )
    app.dependency_overrides[get_history_repository_v2] = lambda: repo
    app.dependency_overrides[get_history_manager] = lambda: _LegacyHistoryShouldNotBeUsed()
    try:
        response = client.post("/history/batch-delete", json={"status": "draft"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"status": "deleted", "count": 1}
    assert repo.status_delete_calls == ["running"]


def test_batch_delete_history_rejects_empty_payload() -> None:
    repo = _HistoryRepoStub()
    app.dependency_overrides[get_history_repository_v2] = lambda: repo
    app.dependency_overrides[get_history_manager] = lambda: _LegacyHistoryShouldNotBeUsed()
    try:
        response = client.post("/history/batch-delete", json={})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_batch_delete_history_concurrent_requests_do_not_deadlock() -> None:
    class _SlowHistoryRepo:
        def __init__(self) -> None:
            self.first_call_entered = asyncio.Event()

        async def delete_sessions(self, session_ids: list[str]) -> int:
            self.first_call_entered.set()
            await asyncio.sleep(0.05)
            return len(session_ids)

        async def delete_sessions_by_status(self, status: str) -> int:
            await asyncio.sleep(0.05)
            return 1

    repo = _SlowHistoryRepo()

    first = asyncio.create_task(
        batch_delete_history(
            req=BatchDeleteRequest(ids=["session-1"]),
            history_repo=repo,  # type: ignore[arg-type]
        )
    )
    await asyncio.wait_for(repo.first_call_entered.wait(), timeout=0.5)
    second = asyncio.create_task(
        batch_delete_history(
            req=BatchDeleteRequest(ids=["session-2"]),
            history_repo=repo,  # type: ignore[arg-type]
        )
    )

    responses = await asyncio.wait_for(asyncio.gather(first, second), timeout=0.5)

    assert responses == [
        {"status": "deleted", "count": 1},
        {"status": "deleted", "count": 1},
    ]
