from __future__ import annotations

import time

from lectern.application.dto import ApiEventV2
from lectern.domain.generation.events import (
    CardEmitted,
    CardsReplaced,
    DomainEvent,
    ErrorEmitted,
    PhaseCompleted,
    PhaseStarted,
    ProgressUpdated,
    SessionCancelled,
    SessionCompleted,
    SessionStarted,
    WarningEmitted,
)




class EventTranslator:
    def to_api_event(
        self,
        event: DomainEvent,
        *,
        session_id: str,
        sequence_no: int,
        now_ms: int | None = None,
    ) -> ApiEventV2:
        timestamp = now_ms if now_ms is not None else int(time.time() * 1000)

        if isinstance(event, SessionStarted):
            return ApiEventV2(
                session_id=session_id,
                sequence_no=sequence_no,
                type="session_started",
                message="",
                timestamp=timestamp,
                data={"mode": event.mode},
            )
        if isinstance(event, PhaseStarted):
            return ApiEventV2(
                session_id=session_id,
                sequence_no=sequence_no,
                type="phase_started",
                message="",
                timestamp=timestamp,
                data={"phase": event.phase},
            )
        if isinstance(event, ProgressUpdated):
            return ApiEventV2(
                session_id=session_id,
                sequence_no=sequence_no,
                type="progress_updated",
                message="",
                timestamp=timestamp,
                data={"phase": event.phase, "current": event.current, "total": event.total},
            )
        if isinstance(event, CardEmitted):
            return ApiEventV2(
                session_id=session_id,
                sequence_no=sequence_no,
                type="card_emitted",
                message="",
                timestamp=timestamp,
                data={"card": event.card_payload, "batch_index": event.batch_index},
            )
        if isinstance(event, CardsReplaced):
            return ApiEventV2(
                session_id=session_id,
                sequence_no=sequence_no,
                type="cards_replaced",
                message="",
                timestamp=timestamp,
                data={"cards": event.cards, "coverage_data": event.coverage_data},
            )
        if isinstance(event, WarningEmitted):
            return ApiEventV2(
                session_id=session_id,
                sequence_no=sequence_no,
                type="warning_emitted",
                message=event.message,
                timestamp=timestamp,
                data={"code": event.code, "details": event.details},
            )
        if isinstance(event, ErrorEmitted):
            return ApiEventV2(
                session_id=session_id,
                sequence_no=sequence_no,
                type="error_emitted",
                message=event.message,
                timestamp=timestamp,
                data={"code": event.code, "stage": event.stage, "recoverable": event.recoverable},
            )
        if isinstance(event, PhaseCompleted):
            return ApiEventV2(
                session_id=session_id,
                sequence_no=sequence_no,
                type="phase_completed",
                message="",
                timestamp=timestamp,
                data={"phase": event.phase, "duration_ms": event.duration_ms, "summary": event.summary},
            )
        if isinstance(event, SessionCompleted):
            return ApiEventV2(
                session_id=session_id,
                sequence_no=sequence_no,
                type="session_completed",
                message="",
                timestamp=timestamp,
                data={"summary": event.summary},
            )
        if isinstance(event, SessionCancelled):
            return ApiEventV2(
                session_id=session_id,
                sequence_no=sequence_no,
                type="session_cancelled",
                message="",
                timestamp=timestamp,
                data={"stage": event.stage, "reason": event.reason},
            )

        raise TypeError(f"unsupported domain event type: {type(event).__name__}")



def to_api_event(
    event: DomainEvent,
    *,
    session_id: str,
    sequence_no: int,
    now_ms: int | None = None,
) -> ApiEventV2:
    return EventTranslator().to_api_event(
        event, session_id=session_id, sequence_no=sequence_no, now_ms=now_ms
    )
