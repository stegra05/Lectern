from __future__ import annotations

import json
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from gui.backend.dependencies import get_generation_app_service_v2
from gui.backend.main import app
from lectern.application.dto import ApiEventV2, StartGenerationRequest
from lectern.application.errors import GenerationApplicationError, GenerationErrorCode

client = TestClient(app)


def _ndjson_lines(body: str) -> list[dict[str, object]]:
    return [json.loads(line) for line in body.splitlines() if line.strip()]


def test_generate_v2_stream_emits_v2_envelope() -> None:
    service = AsyncMock()

    async def run_generation_stream(
        _req: StartGenerationRequest,
    ) -> AsyncIterator[ApiEventV2]:
        yield ApiEventV2(
            session_id="session-1",
            sequence_no=1,
            type="session_started",
            message="",
            timestamp=123,
            data={"mode": "start"},
        )
        yield ApiEventV2(
            session_id="session-1",
            sequence_no=2,
            type="session_completed",
            message="",
            timestamp=124,
            data={"summary": {"cards_generated": 0}},
        )

    service.run_generation_stream = run_generation_stream
    service.run_resume_stream = AsyncMock()
    service.cancel = AsyncMock()
    service.replay_stream = AsyncMock()

    app.dependency_overrides[get_generation_app_service_v2] = lambda: service
    try:
        response = client.post(
            "/generate-v2",
            files={"pdf_file": ("test.pdf", b"%PDF-1.4", "application/pdf")},
            data={"deck_name": "Deck A"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = _ndjson_lines(response.text)
    assert payload[0]["event_version"] == 2
    assert payload[0]["type"] == "session_started"
    assert payload[0]["session_id"] == "session-1"
    assert payload[1]["type"] == "session_completed"
    assert payload[1]["sequence_no"] == 2


def test_generate_v2_pre_stream_error_maps_to_http() -> None:
    service = AsyncMock()

    async def run_generation_stream(
        _req: StartGenerationRequest,
    ) -> AsyncIterator[ApiEventV2]:
        raise GenerationApplicationError(
            GenerationErrorCode.INVALID_INPUT,
            "bad input",
            details={"field": "deck_name"},
        )
        if False:
            yield  # pragma: no cover

    service.run_generation_stream = run_generation_stream
    service.run_resume_stream = AsyncMock()
    service.cancel = AsyncMock()
    service.replay_stream = AsyncMock()

    app.dependency_overrides[get_generation_app_service_v2] = lambda: service
    try:
        response = client.post(
            "/generate-v2",
            files={"pdf_file": ("test.pdf", b"%PDF-1.4", "application/pdf")},
            data={"deck_name": "Deck A"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_input"
    assert detail["details"] == {"field": "deck_name"}


def test_generate_v2_post_stream_error_emits_terminal_error_event() -> None:
    service = AsyncMock()

    async def run_generation_stream(
        _req: StartGenerationRequest,
    ) -> AsyncIterator[ApiEventV2]:
        yield ApiEventV2(
            session_id="session-9",
            sequence_no=1,
            type="session_started",
            message="",
            timestamp=123,
            data={"mode": "start"},
        )
        raise GenerationApplicationError(
            GenerationErrorCode.HISTORY_PERSIST_FAILED,
            "history failed",
        )

    service.run_generation_stream = run_generation_stream
    service.run_resume_stream = AsyncMock()
    service.cancel = AsyncMock()
    service.replay_stream = AsyncMock()

    app.dependency_overrides[get_generation_app_service_v2] = lambda: service
    try:
        response = client.post(
            "/generate-v2",
            files={"pdf_file": ("test.pdf", b"%PDF-1.4", "application/pdf")},
            data={"deck_name": "Deck A"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = _ndjson_lines(response.text)
    assert payload[0]["type"] == "session_started"
    assert payload[-1]["type"] == "error_emitted"
    assert payload[-1]["event_version"] == 2
    assert payload[-1]["data"]["code"] == "history_persist_failed"


def test_generate_v2_rejects_negative_after_sequence_no() -> None:
    service = AsyncMock()
    service.run_generation_stream = AsyncMock()
    service.run_resume_stream = AsyncMock()
    service.cancel = AsyncMock()
    service.replay_stream = AsyncMock()

    app.dependency_overrides[get_generation_app_service_v2] = lambda: service
    try:
        response = client.post(
            "/generate-v2",
            files={"pdf_file": ("test.pdf", b"%PDF-1.4", "application/pdf")},
            data={"deck_name": "Deck A", "after_sequence_no": "-1"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_input"
    assert detail["details"] == {"field": "after_sequence_no"}


def test_generate_v2_rejects_after_sequence_no_without_session_id() -> None:
    service = AsyncMock()
    service.run_generation_stream = AsyncMock()
    service.run_resume_stream = AsyncMock()
    service.replay_stream = AsyncMock()

    app.dependency_overrides[get_generation_app_service_v2] = lambda: service
    try:
        response = client.post(
            "/generate-v2",
            files={"pdf_file": ("test.pdf", b"%PDF-1.4", "application/pdf")},
            data={"deck_name": "Deck A", "after_sequence_no": "3"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_input"
    assert detail["details"] == {"field": "after_sequence_no"}


def test_generate_v2_resume_with_after_sequence_no_replays_before_resume() -> None:
    service = AsyncMock()

    async def replay_stream(_req):
        yield ApiEventV2(
            session_id="session-r",
            sequence_no=3,
            type="phase_started",
            message="",
            timestamp=111,
            data={"phase": "generation"},
        )

    async def run_resume_stream(_req):
        yield ApiEventV2(
            session_id="session-r",
            sequence_no=4,
            type="progress_updated",
            message="",
            timestamp=112,
            data={"phase": "generation", "current": 1, "total": 2},
        )
        yield ApiEventV2(
            session_id="session-r",
            sequence_no=5,
            type="session_completed",
            message="",
            timestamp=113,
            data={"summary": {}},
        )

    service.run_generation_stream = AsyncMock()
    service.replay_stream = replay_stream
    service.run_resume_stream = run_resume_stream

    app.dependency_overrides[get_generation_app_service_v2] = lambda: service
    try:
        response = client.post(
            "/generate-v2",
            files={"pdf_file": ("test.pdf", b"%PDF-1.4", "application/pdf")},
            data={
                "deck_name": "Deck A",
                "session_id": "session-r",
                "after_sequence_no": "2",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = _ndjson_lines(response.text)
    assert [event["sequence_no"] for event in payload] == [3, 4, 5]
    assert payload[0]["type"] == "phase_started"
    assert payload[-1]["type"] == "session_completed"
