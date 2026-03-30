from __future__ import annotations

import json
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from gui.backend.dependencies import get_generation_app_service_v2
from gui.backend.main import app
from gui.backend.interface_v2.routers import generation_v2
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


def test_generate_v2_uses_runtime_default_model_when_not_provided() -> None:
    service = AsyncMock()
    captured_req: StartGenerationRequest | None = None

    async def run_generation_stream(
        req: StartGenerationRequest,
    ) -> AsyncIterator[ApiEventV2]:
        nonlocal captured_req
        captured_req = req
        yield ApiEventV2(
            session_id="session-default-model",
            sequence_no=1,
            type="session_completed",
            message="",
            timestamp=1,
            data={},
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
    assert captured_req is not None
    assert captured_req.model_name == str(generation_v2.config.DEFAULT_GEMINI_MODEL)


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


def test_generate_v2_pre_stream_unexpected_error_maps_to_http_500() -> None:
    service = AsyncMock()

    async def run_generation_stream(
        _req: StartGenerationRequest,
    ) -> AsyncIterator[ApiEventV2]:
        raise RuntimeError("429 RESOURCE_EXHAUSTED. spending cap exceeded")
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

    assert response.status_code == 500
    detail = response.json()["detail"]
    assert detail["code"] == "internal_unexpected"
    assert "spending cap" in detail["message"].lower()


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


def test_generate_v2_rejects_malformed_tags_json() -> None:
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
            data={"deck_name": "Deck A", "tags": "{not-json"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_input"
    assert detail["details"] == {"field": "tags", "reason": "invalid_json"}


def test_generate_v2_rejects_non_string_tag_payloads() -> None:
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
            data={"deck_name": "Deck A", "tags": "[1,2,3]"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_input"
    assert detail["details"] == {"field": "tags", "reason": "invalid_type"}


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


def test_estimate_v2_returns_estimation_payload() -> None:
    async def fake_estimate_cost_with_base(
        _pdf_path: str,
        model_name: str | None = None,
        target_card_count: int | None = None,
    ):
        return (
            {
                "tokens": 120,
                "input_tokens": 150,
                "output_tokens": 200,
                "input_cost": 0.01,
                "output_cost": 0.02,
                "cost": 0.03,
                "pages": 3,
                "text_chars": 900,
                "model": model_name or "gemini-2.5-flash",
                "suggested_card_count": 3,
                "estimated_card_count": target_card_count or 4,
                "image_count": 0,
                "document_type": "slides",
            },
            {
                "token_count": 120,
                "page_count": 3,
                "text_chars": 900,
                "image_count": 0,
                "model": model_name or "gemini-2.5-flash",
            },
        )

    original_impl = generation_v2.estimate_cost_with_base_impl
    generation_v2.estimate_cost_with_base_impl = fake_estimate_cost_with_base
    try:
        response = client.post(
            "/estimate-v2",
            files={"pdf_file": ("test.pdf", b"%PDF-1.4", "application/pdf")},
            data={"model_name": "gemini-2.5-flash", "target_card_count": "4"},
        )
    finally:
        generation_v2.estimate_cost_with_base_impl = original_impl

    assert response.status_code == 200
    payload = response.json()
    assert payload["tokens"] == 120
    assert payload["estimated_card_count"] == 4
    assert payload["model"] == "gemini-2.5-flash"


def test_generate_v2_uses_cached_upload_from_estimate() -> None:
    captured_req: StartGenerationRequest | None = None
    service = AsyncMock()

    async def run_generation_stream(req: StartGenerationRequest) -> AsyncIterator[ApiEventV2]:
        nonlocal captured_req
        captured_req = req
        yield ApiEventV2(
            session_id="session-cache",
            sequence_no=1,
            type="session_completed",
            message="",
            timestamp=1,
            data={"summary": {}},
        )

    async def fake_estimate_cost_with_base(
        _pdf_path: str,
        model_name: str | None = None,
        target_card_count: int | None = None,
    ):
        del target_card_count
        return (
            {
                "tokens": 120,
                "input_tokens": 150,
                "output_tokens": 200,
                "input_cost": 0.01,
                "output_cost": 0.02,
                "cost": 0.03,
                "pages": 3,
                "text_chars": 900,
                "model": model_name or "gemini-2.5-flash",
                "suggested_card_count": 3,
                "estimated_card_count": 4,
                "image_count": 0,
                "document_type": "slides",
            },
            {
                "token_count": 120,
                "page_count": 3,
                "text_chars": 900,
                "image_count": 0,
                "model": model_name or "gemini-2.5-flash",
                "uploaded_uri": "gs://cached-estimate.pdf",
                "uploaded_mime_type": "application/pdf",
            },
        )

    service.run_generation_stream = run_generation_stream
    service.run_resume_stream = AsyncMock()
    service.cancel = AsyncMock()
    service.replay_stream = AsyncMock()

    original_impl = generation_v2.estimate_cost_with_base_impl
    generation_v2.estimate_cost_with_base_impl = fake_estimate_cost_with_base
    app.dependency_overrides[get_generation_app_service_v2] = lambda: service
    try:
        estimate_response = client.post(
            "/estimate-v2",
            files={"pdf_file": ("test.pdf", b"%PDF-1.4 cache", "application/pdf")},
            data={"model_name": "gemini-2.5-flash", "target_card_count": "4"},
        )
        assert estimate_response.status_code == 200
        generate_response = client.post(
            "/generate-v2",
            files={"pdf_file": ("test.pdf", b"%PDF-1.4 cache", "application/pdf")},
            data={"deck_name": "Deck A", "model_name": "gemini-2.5-flash", "target_card_count": "4"},
        )
    finally:
        generation_v2.estimate_cost_with_base_impl = original_impl
        app.dependency_overrides.clear()

    assert generate_response.status_code == 200
    assert captured_req is not None
    assert captured_req.cached_uploaded_uri == "gs://cached-estimate.pdf"
    assert captured_req.cached_uploaded_mime_type == "application/pdf"


def test_stop_v2_calls_cancel_with_session_id() -> None:
    service = AsyncMock()
    service.run_generation_stream = AsyncMock()
    service.run_resume_stream = AsyncMock()
    service.cancel = AsyncMock(
        return_value={"ok": True, "session_id": "session-1", "code": "cancelled"}
    )
    service.replay_stream = AsyncMock()

    app.dependency_overrides[get_generation_app_service_v2] = lambda: service
    try:
        response = client.post("/stop-v2?session_id=session-1")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {"stopped": True, "session_id": "session-1"}
    service.cancel.assert_awaited_once()
    cancel_req = service.cancel.await_args.args[0]
    assert cancel_req.session_id == "session-1"


def test_stop_v2_requires_session_id() -> None:
    service = AsyncMock()
    service.run_generation_stream = AsyncMock()
    service.run_resume_stream = AsyncMock()
    service.cancel = AsyncMock()
    service.replay_stream = AsyncMock()

    app.dependency_overrides[get_generation_app_service_v2] = lambda: service
    try:
        response = client.post("/stop-v2")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_input"
    assert detail["details"] == {"field": "session_id"}
    service.cancel.assert_not_awaited()
