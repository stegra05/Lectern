"""Domain event definitions for the Lectern generation system.

These are pure data classes representing business events in the generation
lifecycle. They are immutable (frozen) and contain no side effects.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from lectern.domain_types import CardData, CoverageData


class DomainEventType(Enum):
    """Enumeration of all domain event types."""

    GENERATION_BATCH_STARTED = "generation_batch_started"
    GENERATION_BATCH_COMPLETED = "generation_batch_completed"
    CARD_GENERATED = "card_generated"
    COVERAGE_UPDATED = "coverage_updated"
    COVERAGE_THRESHOLD_MET = "coverage_threshold_met"
    WARNING_EMITTED = "warning_emitted"
    ERROR_OCCURRED = "error_occurred"
    PROGRESS_UPDATED = "progress_updated"
    GENERATION_STOPPED = "generation_stopped"
    # Reflection events
    CARDS_REPLACED = "cards_replaced"
    REFLECTION_ROUND_STARTED = "reflection_round_started"
    REFLECTION_ROUND_COMPLETED = "reflection_round_completed"
    REFLECTION_STOPPED = "reflection_stopped"


@dataclass(frozen=True)
class DomainEvent:
    """Base class for all domain events."""

    event_type: DomainEventType
    batch_index: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert event to dictionary representation."""
        result = {"event_type": self.event_type.value}
        if self.batch_index is not None:
            result["batch_index"] = self.batch_index
        return result


@dataclass(frozen=True)
class GenerationBatchStartedEvent(DomainEvent):
    """Emitted when a new generation batch begins."""

    event_type: DomainEventType = field(
        default=DomainEventType.GENERATION_BATCH_STARTED, init=False
    )
    limit: int = 0


@dataclass(frozen=True)
class CardGeneratedEvent(DomainEvent):
    """Emitted when a new card is generated."""

    event_type: DomainEventType = field(
        default=DomainEventType.CARD_GENERATED, init=False
    )
    card: CardData = field(default_factory=dict)
    is_refined: bool = False  # True if from reflection phase


@dataclass(frozen=True)
class CoverageUpdatedEvent(DomainEvent):
    """Emitted when coverage data is updated."""

    event_type: DomainEventType = field(
        default=DomainEventType.COVERAGE_UPDATED, init=False
    )
    coverage_data: CoverageData = field(default_factory=dict)
    cards_count: int = 0


@dataclass(frozen=True)
class CoverageThresholdMetEvent(DomainEvent):
    """Emitted when coverage threshold is satisfied."""

    event_type: DomainEventType = field(
        default=DomainEventType.COVERAGE_THRESHOLD_MET, init=False
    )
    coverage_data: CoverageData = field(default_factory=dict)
    reason: str = ""


@dataclass(frozen=True)
class WarningEmittedEvent(DomainEvent):
    """Emitted when a non-fatal warning occurs."""

    event_type: DomainEventType = field(
        default=DomainEventType.WARNING_EMITTED, init=False
    )
    message: str = ""
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ErrorOccurredEvent(DomainEvent):
    """Emitted when an error occurs."""

    event_type: DomainEventType = field(
        default=DomainEventType.ERROR_OCCURRED, init=False
    )
    message: str = ""
    recoverable: bool = False
    stage: str = ""


@dataclass(frozen=True)
class ProgressUpdatedEvent(DomainEvent):
    """Emitted to update progress indicators."""

    event_type: DomainEventType = field(
        default=DomainEventType.PROGRESS_UPDATED, init=False
    )
    current: int = 0
    total: Optional[int] = None


@dataclass(frozen=True)
class GenerationBatchCompletedEvent(DomainEvent):
    """Emitted when a generation batch completes."""

    event_type: DomainEventType = field(
        default=DomainEventType.GENERATION_BATCH_COMPLETED, init=False
    )
    cards_added: int = 0
    model_done: bool = False


@dataclass(frozen=True)
class GenerationStoppedEvent(DomainEvent):
    """Emitted when generation stops before completing."""

    event_type: DomainEventType = field(
        default=DomainEventType.GENERATION_STOPPED, init=False
    )
    reason: str = ""  # "user_cancel", "no_new_cards"


@dataclass(frozen=True)
class CardsReplacedEvent(DomainEvent):
    """Emitted when reflection replaces cards."""

    event_type: DomainEventType = field(
        default=DomainEventType.CARDS_REPLACED, init=False
    )
    cards: List[CardData] = field(default_factory=list)
    coverage_data: CoverageData = field(default_factory=dict)
    reflection_text: str = ""
    selection_summary: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ReflectionRoundStartedEvent(DomainEvent):
    """Emitted when a reflection round begins."""

    event_type: DomainEventType = field(
        default=DomainEventType.REFLECTION_ROUND_STARTED, init=False
    )
    round_number: int = 1
    total_rounds: int = 1


@dataclass(frozen=True)
class ReflectionRoundCompletedEvent(DomainEvent):
    """Emitted when a reflection round completes."""

    event_type: DomainEventType = field(
        default=DomainEventType.REFLECTION_ROUND_COMPLETED, init=False
    )
    round_number: int = 1
    quality_delta: float = 0.0
    cards_changed: bool = False
    selection_summary: Dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ReflectionStoppedEvent(DomainEvent):
    """Emitted when reflection stops."""

    event_type: DomainEventType = field(
        default=DomainEventType.REFLECTION_STOPPED, init=False
    )
    reason: str = ""
