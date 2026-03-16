"""Domain events for the Lectern generation system."""

from lectern.events.domain import (
    DomainEvent,
    DomainEventType,
    GenerationBatchStartedEvent,
    GenerationBatchCompletedEvent,
    CardGeneratedEvent,
    CoverageUpdatedEvent,
    CoverageThresholdMetEvent,
    WarningEmittedEvent,
    ErrorOccurredEvent,
    ProgressUpdatedEvent,
    GenerationStoppedEvent,
    CardsReplacedEvent,
    ReflectionRoundStartedEvent,
    ReflectionRoundCompletedEvent,
    ReflectionStoppedEvent,
)

__all__ = [
    "DomainEvent",
    "DomainEventType",
    "GenerationBatchStartedEvent",
    "GenerationBatchCompletedEvent",
    "CardGeneratedEvent",
    "CoverageUpdatedEvent",
    "CoverageThresholdMetEvent",
    "WarningEmittedEvent",
    "ErrorOccurredEvent",
    "ProgressUpdatedEvent",
    "GenerationStoppedEvent",
    "CardsReplacedEvent",
    "ReflectionRoundStartedEvent",
    "ReflectionRoundCompletedEvent",
    "ReflectionStoppedEvent",
]
