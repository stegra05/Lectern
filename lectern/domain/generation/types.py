from __future__ import annotations

from typing import Literal, TypedDict

from lectern.domain_types import ConceptMapData

LifecycleState = Literal[
    "idle",
    "running",
    "stopped",
    "error",
    "completed",
    "cancelled",
]

EngineOperation = Literal[
    "start",
    "resume",
    "cancel",
    "stop",
    "complete",
    "fail",
]

GenerationPhase = Literal[
    "generation",
    "reflection",
    "export",
]

SessionMode = Literal[
    "start",
    "resume",
]


class ConceptMapResult(ConceptMapData):
    pass


class DomainEventSummary(TypedDict, total=False):
    cards_exported: int
    cards_generated: int
    cards_reflected: int
    warnings_count: int
    errors_count: int
    duration_ms: int


class DomainEventRecordMetadata(TypedDict, total=False):
    event_id: str
    correlation_id: str
    causation_id: str
    persisted_at_ms: int
    producer: str
