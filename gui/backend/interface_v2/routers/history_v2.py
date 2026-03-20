from __future__ import annotations

from typing import Any, Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from gui.backend.card_identity import ensure_cards_have_uid
from gui.backend.dependencies import get_history_repository_v2
from lectern.application.errors import GenerationErrorCode
from lectern.domain.generation.events import CardEmitted, CardsReplaced, DomainEventRecord
from lectern.infrastructure.persistence.history_repository_sqlite import HistoryRepositorySqlite

router = APIRouter()


class SessionNotFoundResponseV2(BaseModel):
    cards: list[dict[str, Any]]
    session_id: str
    not_found: Literal[True]


class SessionResponseV2(BaseModel):
    session_id: str
    status: Optional[str] = None
    cards: list[dict[str, Any]]
    deck: Optional[str] = None
    deck_name: Optional[str] = None
    logs: Optional[list[dict[str, Any]]] = None
    total_pages: Optional[int] = None
    coverage_data: Optional[dict[str, Any]] = None
    cursor: Optional[int] = None


SessionV2Envelope = Union[SessionNotFoundResponseV2, SessionResponseV2]


def _project_cards(events: list[DomainEventRecord]) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    cards: list[dict[str, Any]] = []
    coverage_data: dict[str, Any] | None = None
    for record in events:
        if isinstance(record.event, CardEmitted):
            cards.append(dict(record.event.card_payload))
        elif isinstance(record.event, CardsReplaced):
            cards = [dict(card) for card in record.event.cards]
            coverage_data = dict(record.event.coverage_data)
    return cards, coverage_data


@router.get("/session-v2/{session_id}", response_model=SessionV2Envelope)
async def get_session_v2(
    session_id: str,
    history_repo: HistoryRepositorySqlite = Depends(get_history_repository_v2),
) -> dict[str, Any]:
    snapshot = await history_repo.get_session(session_id)
    if snapshot is None:
        return {"cards": [], "session_id": session_id, "not_found": True}

    try:
        events = await history_repo.get_events_after(session_id, after_sequence_no=0)
    except ValueError as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "code": GenerationErrorCode.HISTORY_CORRUPT_SEQUENCE.value,
                "message": str(exc),
            },
        ) from exc

    cards, derived_coverage = _project_cards(events)
    payload: dict[str, Any] = {
        "session_id": session_id,
        "status": snapshot.get("status"),
        "cards": ensure_cards_have_uid(cards),
        "deck": snapshot.get("deck"),
        "deck_name": snapshot.get("deck_name"),
        "logs": snapshot.get("logs"),
        "total_pages": snapshot.get("total_pages"),
        "coverage_data": snapshot.get("coverage_data") or derived_coverage,
        "cursor": snapshot.get("cursor"),
    }
    return payload
