import asyncio
from datetime import UTC, datetime
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Literal, Optional, Union

from gui.backend.card_identity import ensure_cards_have_uid
from gui.backend.dependencies import get_history_repository_v2
from lectern.infrastructure.persistence.history_repository_sqlite import HistoryRepositorySqlite

router = APIRouter()
_history_lock = asyncio.Lock()

# --- Models ---


class HistoryEntryResponse(BaseModel):
    id: Optional[str] = None
    session_id: Optional[str] = None
    filename: Optional[str] = None
    full_path: Optional[str] = None
    deck: Optional[str] = None
    date: Optional[str] = None
    card_count: Optional[int] = None
    status: Optional[str] = None


class HistoryClearResponse(BaseModel):
    status: Literal["cleared"]


class HistoryDeleteResponse(BaseModel):
    status: Literal["deleted"]


class BatchDeleteRequest(BaseModel):
    ids: Optional[List[str]] = None
    status: Optional[str] = None


class HistoryBatchDeleteResponse(BaseModel):
    status: Literal["deleted"]
    count: int


class SessionNotFoundResponse(BaseModel):
    cards: List[dict]
    session_id: str
    not_found: Literal[True]


class SessionEntryResponse(BaseModel):
    id: str
    session_id: str
    status: str
    cards: List[dict]
    deck: Optional[str] = None
    deck_name: Optional[str] = None
    logs: Optional[List[dict]] = None
    total_pages: Optional[int] = None
    coverage_data: Optional[dict] = None
    filename: Optional[str] = None
    full_path: Optional[str] = None
    date: Optional[str] = None
    card_count: Optional[int] = None
    slide_set_name: Optional[str] = None
    model_name: Optional[str] = None
    tags: Optional[List[str]] = None


SessionResponse = Union[SessionNotFoundResponse, SessionEntryResponse]

# --- Endpoints ---


@router.get("/history", response_model=List[HistoryEntryResponse])
async def get_history(
    history_repo: HistoryRepositorySqlite = Depends(get_history_repository_v2),
):
    sessions = await history_repo.list_sessions(limit=500)
    return [_project_history_entry(session) for session in sessions]


@router.delete("/history", response_model=HistoryClearResponse)
async def clear_history(
    history_repo: HistoryRepositorySqlite = Depends(get_history_repository_v2),
):
    await history_repo.clear_sessions()
    return {"status": "cleared"}


@router.delete("/history/{entry_id}", response_model=HistoryDeleteResponse)
async def delete_history_entry(
    entry_id: str, history_repo: HistoryRepositorySqlite = Depends(get_history_repository_v2)
):
    deleted = await history_repo.delete_session(entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"status": "deleted"}


def _normalize_batch_status(status: str) -> str:
    return "running" if status == "draft" else status


@router.post("/history/batch-delete", response_model=HistoryBatchDeleteResponse)
async def batch_delete_history(
    req: BatchDeleteRequest,
    history_repo: HistoryRepositorySqlite = Depends(get_history_repository_v2),
):
    if not req.status and not req.ids:
        raise HTTPException(status_code=400, detail="Provide 'ids' or 'status'")
    async with _history_lock:
        if req.status:
            deleted = await history_repo.delete_sessions_by_status(
                _normalize_batch_status(req.status)
            )
        elif req.ids:
            deleted = await history_repo.delete_sessions(req.ids)
        else:
            deleted = 0
    return {"status": "deleted", "count": deleted}


@router.get("/session/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str):
    # Legacy endpoint retained for compatibility; resolve via V2 snapshot projection.
    history_repo = get_history_repository_v2()
    snapshot = await history_repo.get_session(session_id)
    if not snapshot:
        return {"cards": [], "session_id": session_id, "not_found": True}
    payload = {
        "id": session_id,
        "session_id": session_id,
        "status": _map_history_status(snapshot.get("status")),
        "cards": ensure_cards_have_uid(list(snapshot.get("cards") or [])),
        "deck": snapshot.get("deck") or snapshot.get("deck_name"),
        "deck_name": snapshot.get("deck_name") or snapshot.get("deck"),
        "logs": snapshot.get("logs"),
        "total_pages": snapshot.get("total_pages"),
        "coverage_data": snapshot.get("coverage_data"),
        "filename": snapshot.get("source_file_name") or snapshot.get("filename"),
        "full_path": snapshot.get("source_path") or snapshot.get("full_path"),
        "date": _as_iso_datetime(snapshot),
        "card_count": _derive_card_count(snapshot),
        "slide_set_name": snapshot.get("slide_set_name"),
        "model_name": snapshot.get("model_name"),
        "tags": snapshot.get("tags"),
    }
    return payload


def _map_history_status(raw_status: object) -> str:
    status = str(raw_status or "draft")
    return "draft" if status == "running" else status


def _derive_card_count(snapshot: dict) -> int:
    if isinstance(snapshot.get("card_count"), int):
        return int(snapshot["card_count"])
    cards = snapshot.get("cards")
    if isinstance(cards, list):
        return len(cards)
    runner_state = snapshot.get("runner_state")
    if isinstance(runner_state, dict) and isinstance(runner_state.get("all_cards"), list):
        return len(runner_state["all_cards"])
    return 0


def _as_iso_datetime(snapshot: dict) -> str:
    created_at_ms = snapshot.get("created_at_ms")
    if isinstance(created_at_ms, (int, float)):
        return datetime.fromtimestamp(float(created_at_ms) / 1000.0, tz=UTC).isoformat()

    updated_at = snapshot.get("updated_at")
    if isinstance(updated_at, (int, float)):
        return datetime.fromtimestamp(float(updated_at), tz=UTC).isoformat()
    return datetime.fromtimestamp(0, tz=UTC).isoformat()


def _project_history_entry(snapshot: dict) -> HistoryEntryResponse:
    session_id = str(snapshot.get("session_id") or "")
    filename = (
        snapshot.get("source_file_name")
        or snapshot.get("filename")
        or "Unknown session"
    )
    deck = snapshot.get("deck_name") or snapshot.get("deck") or ""
    return HistoryEntryResponse(
        id=session_id,
        session_id=session_id,
        filename=str(filename),
        full_path=snapshot.get("source_path") or snapshot.get("full_path"),
        deck=str(deck),
        date=_as_iso_datetime(snapshot),
        card_count=_derive_card_count(snapshot),
        status=_map_history_status(snapshot.get("status")),
    )
