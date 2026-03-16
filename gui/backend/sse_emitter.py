"""SSE Emitter - transforms domain events to SSE format for frontend consumption.

This is the ONLY layer that knows about:
- ServiceEvent dataclass
- EventType literals
- ndjson_event format
"""

from __future__ import annotations

from typing import Generator

from lectern.events.domain import (
    CardGeneratedEvent,
    CardsReplacedEvent,
    CoverageThresholdMetEvent,
    CoverageUpdatedEvent,
    DomainEvent,
    DomainEventType,
    ErrorOccurredEvent,
    GenerationBatchCompletedEvent,
    GenerationBatchStartedEvent,
    GenerationStoppedEvent,
    ProgressUpdatedEvent,
    ReflectionRoundCompletedEvent,
    ReflectionRoundStartedEvent,
    ReflectionStoppedEvent,
    WarningEmittedEvent,
)
from lectern.events.service_events import EventType, ServiceEvent

from gui.backend.streaming import ndjson_event

_DOMAIN_TO_SERVICE_EVENT_TYPE: dict[DomainEventType, EventType] = {
    DomainEventType.GENERATION_BATCH_STARTED: "status",
    DomainEventType.GENERATION_BATCH_COMPLETED: "info",
    DomainEventType.GENERATION_STOPPED: "warning",
    DomainEventType.CARD_GENERATED: "card",
    DomainEventType.CARDS_REPLACED: "cards_replaced",
    DomainEventType.COVERAGE_UPDATED: "info",
    DomainEventType.COVERAGE_THRESHOLD_MET: "info",
    DomainEventType.WARNING_EMITTED: "warning",
    DomainEventType.ERROR_OCCURRED: "error",
    DomainEventType.PROGRESS_UPDATED: "progress_update",
    DomainEventType.REFLECTION_ROUND_STARTED: "status",
    DomainEventType.REFLECTION_ROUND_COMPLETED: "info",
    DomainEventType.REFLECTION_STOPPED: "warning",
}


class SSEEmitter:
    """
    Transforms domain events to SSE format for frontend consumption.

    This is the ONLY layer that knows about:
    - ServiceEvent dataclass
    - EventType literals
    - ndjson_event formatting
    """

    @staticmethod
    def domain_to_service_event(event: DomainEvent) -> ServiceEvent:
        """Convert a domain event to a ServiceEvent."""

        if isinstance(event, CardGeneratedEvent):
            return ServiceEvent(
                type="card",
                message="Refined card" if event.is_refined else "New card",
                data={"card": event.card},
            )

        elif isinstance(event, CoverageUpdatedEvent):
            return ServiceEvent(
                type="progress_update",
                message="",
                data={"current": event.cards_count},
            )

        elif isinstance(event, CoverageThresholdMetEvent):
            return ServiceEvent(
                type="info",
                message=event.reason,
                data={"batch": event.batch_index} if event.batch_index else {},
            )

        elif isinstance(event, WarningEmittedEvent):
            return ServiceEvent(
                type="warning",
                message=event.message,
                data=event.details,
            )

        elif isinstance(event, ErrorOccurredEvent):
            return ServiceEvent(
                type="error",
                message=event.message,
                data={
                    "recoverable": event.recoverable,
                    "stage": event.stage,
                },
            )

        elif isinstance(event, ProgressUpdatedEvent):
            data: dict = {"current": event.current}
            if event.total is not None:
                data["total"] = event.total
            return ServiceEvent(
                type="progress_update",
                message="",
                data=data,
            )

        elif isinstance(event, GenerationBatchStartedEvent):
            return ServiceEvent(
                type="status",
                message=f"Generating batch {event.batch_index} (limit={event.limit})...",
            )

        elif isinstance(event, GenerationBatchCompletedEvent):
            return ServiceEvent(
                type="info",
                message=f"Batch {event.batch_index} summary: +{event.cards_added} cards",
                data={
                    "batch": event.batch_index,
                    "added": event.cards_added,
                    "model_done": event.model_done,
                },
            )

        elif isinstance(event, GenerationStoppedEvent):
            return ServiceEvent(
                type="warning" if event.reason == "user_cancel" else "info",
                message=f"Generation stopped: {event.reason}",
            )

        elif isinstance(event, CardsReplacedEvent):
            return ServiceEvent(
                type="cards_replaced",
                message="Applied reflection batch",
                data={
                    "cards": event.cards,
                    "coverage_data": event.coverage_data,
                    "reflection": event.reflection_text,
                    "selection_summary": event.selection_summary,
                },
            )

        elif isinstance(event, ReflectionRoundStartedEvent):
            return ServiceEvent(
                type="status",
                message=f"Reflection Round {event.round_number}/{event.total_rounds}",
            )

        elif isinstance(event, ReflectionRoundCompletedEvent):
            return ServiceEvent(
                type="info",
                message=(
                    f"Reflection round {event.round_number} summary: "
                    f"quality delta {event.quality_delta:.1f}"
                ),
                data={
                    "round": event.round_number,
                    "cards_changed": event.cards_changed,
                    "selection_summary": event.selection_summary,
                },
            )

        elif isinstance(event, ReflectionStoppedEvent):
            return ServiceEvent(
                type="warning",
                message=f"Reflection stopped: {event.reason}",
            )

        # Generic fallback
        event_type = _DOMAIN_TO_SERVICE_EVENT_TYPE.get(event.event_type, "info")
        return ServiceEvent(
            type=event_type,
            message="",
            data=event.to_dict(),
        )

    @staticmethod
    def to_ndjson(event: DomainEvent) -> str:
        """Convert domain event directly to NDJSON string."""
        service_event = SSEEmitter.domain_to_service_event(event)
        return ndjson_event(
            event_type=service_event.type,
            message=service_event.message,
            data=service_event.data,
        )

    @staticmethod
    def stream_events(
        domain_events: Generator[DomainEvent, None, None],
    ) -> Generator[str, None, None]:
        """Transform a stream of domain events to NDJSON strings."""
        for event in domain_events:
            yield SSEEmitter.to_ndjson(event)
