from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from lectern.domain_types import CardData, CoverageData
from lectern.domain.generation.types import GenerationPhase, SessionMode


class DomainEventType(Enum):
    SESSION_STARTED = "session_started"
    PHASE_STARTED = "phase_started"
    PROGRESS_UPDATED = "progress_updated"
    CARD_EMITTED = "card_emitted"
    CARDS_REPLACED = "cards_replaced"
    WARNING_EMITTED = "warning_emitted"
    ERROR_EMITTED = "error_emitted"
    PHASE_COMPLETED = "phase_completed"
    SESSION_COMPLETED = "session_completed"
    SESSION_CANCELLED = "session_cancelled"


@dataclass(frozen=True)
class SessionStarted:
    session_id: str
    mode: SessionMode
    event_type: DomainEventType = field(default=DomainEventType.SESSION_STARTED, init=False)


@dataclass(frozen=True)
class PhaseStarted:
    phase: GenerationPhase
    event_type: DomainEventType = field(default=DomainEventType.PHASE_STARTED, init=False)


@dataclass(frozen=True)
class ProgressUpdated:
    phase: GenerationPhase
    current: int
    total: int
    event_type: DomainEventType = field(default=DomainEventType.PROGRESS_UPDATED, init=False)


@dataclass(frozen=True)
class CardEmitted:
    card_uid: str
    batch_index: int
    card_payload: CardData
    event_type: DomainEventType = field(default=DomainEventType.CARD_EMITTED, init=False)

    def __post_init__(self) -> None:
        if not self.card_uid.strip():
            raise ValueError("card_uid must be non-empty")


@dataclass(frozen=True)
class CardsReplaced:
    batch_index: int
    cards: list[CardData]
    coverage_data: CoverageData
    event_type: DomainEventType = field(default=DomainEventType.CARDS_REPLACED, init=False)


@dataclass(frozen=True)
class WarningEmitted:
    code: str
    message: str
    details: dict[str, Any]
    event_type: DomainEventType = field(default=DomainEventType.WARNING_EMITTED, init=False)


@dataclass(frozen=True)
class ErrorEmitted:
    code: str
    message: str
    stage: str
    recoverable: bool
    event_type: DomainEventType = field(default=DomainEventType.ERROR_EMITTED, init=False)


@dataclass(frozen=True)
class PhaseCompleted:
    phase: GenerationPhase
    duration_ms: int
    summary: dict[str, Any]
    event_type: DomainEventType = field(default=DomainEventType.PHASE_COMPLETED, init=False)


@dataclass(frozen=True)
class SessionCompleted:
    summary: dict[str, Any]
    terminal: bool = field(default=True, init=False)
    event_type: DomainEventType = field(default=DomainEventType.SESSION_COMPLETED, init=False)


@dataclass(frozen=True)
class SessionCancelled:
    stage: str
    reason: str
    terminal: bool = field(default=True, init=False)
    event_type: DomainEventType = field(default=DomainEventType.SESSION_CANCELLED, init=False)


DomainEvent = (
    SessionStarted
    | PhaseStarted
    | ProgressUpdated
    | CardEmitted
    | CardsReplaced
    | WarningEmitted
    | ErrorEmitted
    | PhaseCompleted
    | SessionCompleted
    | SessionCancelled
)


@dataclass(frozen=True)
class DomainEventRecord:
    session_id: str
    sequence_no: int
    event: DomainEvent

    @property
    def idempotency_key(self) -> str:
        return f"{self.session_id}:{self.sequence_no}"
