from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


ApiEventType = Literal[
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
]


@dataclass(frozen=True)
class StartGenerationRequest:
    pdf_path: str
    deck_name: str
    model_name: str
    tags: list[str]
    focus_prompt: str | None = None
    target_card_count: int | None = None
    cached_uploaded_uri: str | None = None
    cached_uploaded_mime_type: str | None = None
    stream_version: int = 2


@dataclass(frozen=True)
class ResumeGenerationRequest:
    session_id: str
    pdf_path: str
    deck_name: str
    model_name: str
    cached_uploaded_uri: str | None = None
    cached_uploaded_mime_type: str | None = None
    stream_version: int = 2


@dataclass(frozen=True)
class ReplayStreamRequest:
    session_id: str
    after_sequence_no: int
    stream_version: int = 2


@dataclass(frozen=True)
class CancelGenerationRequest:
    session_id: str


@dataclass(frozen=True)
class ApiEventV2:
    session_id: str
    sequence_no: int
    type: ApiEventType
    message: str
    timestamp: int
    data: dict[str, Any]
    event_version: int = field(default=2, init=False)
