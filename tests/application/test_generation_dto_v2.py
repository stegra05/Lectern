from __future__ import annotations

import pytest

from lectern.application.dto import (
    ApiEventV2,
    CancelGenerationRequest,
    ReplayStreamRequest,
    ResumeGenerationRequest,
    StartGenerationRequest,
)
from lectern.application.errors import GenerationApplicationError, GenerationErrorCode


def test_start_generation_request_defaults_stream_version() -> None:
    req = StartGenerationRequest(
        pdf_path="/tmp/a.pdf",
        deck_name="Deck",
        model_name="gemini-3-flash",
        tags=[],
    )

    assert req.stream_version == 2
    assert req.cached_uploaded_uri is None
    assert req.cached_uploaded_mime_type is None


def test_resume_generation_request_defaults_stream_version() -> None:
    req = ResumeGenerationRequest(
        session_id="session-123",
        pdf_path="/tmp/a.pdf",
        deck_name="Deck",
        model_name="gemini-3-flash",
    )

    assert req.stream_version == 2
    assert req.cached_uploaded_uri is None
    assert req.cached_uploaded_mime_type is None


def test_replay_stream_request_defaults_stream_version() -> None:
    req = ReplayStreamRequest(session_id="session-123", after_sequence_no=10)

    assert req.stream_version == 2


def test_cancel_generation_request_has_session_id() -> None:
    req = CancelGenerationRequest(session_id="session-123")

    assert req.session_id == "session-123"


def test_api_event_v2_contains_required_envelope_fields() -> None:
    event = ApiEventV2(
        session_id="session-123",
        sequence_no=7,
        type="phase_started",
        message="Started generation",
        timestamp=1710000000000,
        data={"phase": "generate"},
    )

    assert event.event_version == 2
    assert event.session_id == "session-123"
    assert event.sequence_no == 7
    assert event.type == "phase_started"
    assert event.message == "Started generation"
    assert event.timestamp == 1710000000000
    assert event.data == {"phase": "generate"}


@pytest.mark.parametrize(
    "missing_field",
    ["session_id", "sequence_no", "type", "message", "timestamp", "data"],
)
def test_api_event_v2_envelope_fields_are_required(missing_field: str) -> None:
    payload = {
        "session_id": "session-123",
        "sequence_no": 1,
        "type": "session_started",
        "message": "Session started",
        "timestamp": 1710000000000,
        "data": {"mode": "start"},
    }
    payload.pop(missing_field)

    with pytest.raises(TypeError):
        ApiEventV2(**payload)


def test_error_code_enum_matches_spec_exactly() -> None:
    expected = {
        "invalid_input",
        "pdf_unavailable",
        "provider_upload_failed",
        "provider_generation_failed",
        "provider_reflection_failed",
        "history_persist_failed",
        "history_corrupt_sequence",
        "session_not_found",
        "resume_version_mismatch",
        "resume_conflict_already_running",
        "cancel_idempotent_noop",
        "stream_disconnected",
        "internal_unexpected",
    }

    actual = {code.value for code in GenerationErrorCode}
    assert actual == expected


def test_generation_application_error_exposes_contract_fields() -> None:
    error = GenerationApplicationError(
        code=GenerationErrorCode.INVALID_INPUT,
        message="after_sequence_no must be >= 0",
        details={"field": "after_sequence_no"},
        context={"session_id": "session-123"},
    )

    assert error.code is GenerationErrorCode.INVALID_INPUT
    assert error.message == "after_sequence_no must be >= 0"
    assert error.details == {"field": "after_sequence_no"}
    assert error.context == {"session_id": "session-123"}
    assert str(error) == "invalid_input: after_sequence_no must be >= 0"
