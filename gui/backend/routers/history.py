import threading
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Literal, Optional, Union
from starlette.concurrency import run_in_threadpool

from lectern.utils.history import HistoryManager
from lectern.utils.database import DatabaseManager
from gui.backend.dependencies import get_history_manager

router = APIRouter()
_history_lock = threading.Lock()

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
async def get_history(history_mgr: HistoryManager = Depends(get_history_manager)):
    return await run_in_threadpool(history_mgr.get_all)


@router.delete("/history", response_model=HistoryClearResponse)
async def clear_history(history_mgr: HistoryManager = Depends(get_history_manager)):
    await run_in_threadpool(history_mgr.clear_all)
    return {"status": "cleared"}


@router.delete("/history/{entry_id}", response_model=HistoryDeleteResponse)
async def delete_history_entry(
    entry_id: str, history_mgr: HistoryManager = Depends(get_history_manager)
):
    entry = await run_in_threadpool(history_mgr.get_entry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    success = await run_in_threadpool(history_mgr.delete_entry, entry_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete history entry")
    return {"status": "deleted"}


def _batch_delete_impl(
    history_mgr: HistoryManager, req_status: Optional[str], req_ids: Optional[List[str]]
) -> int:
    with _history_lock:
        if req_status:
            entries = history_mgr.get_entries_by_status(req_status)
        elif req_ids:
            entries = [e for e in history_mgr.get_all() if e["id"] in set(req_ids)]
        else:
            return 0

        entry_ids = [e["id"] for e in entries]
        deleted = history_mgr.delete_entries(entry_ids)
        return deleted


@router.post("/history/batch-delete", response_model=HistoryBatchDeleteResponse)
async def batch_delete_history(
    req: BatchDeleteRequest, history_mgr: HistoryManager = Depends(get_history_manager)
):
    if not req.status and not req.ids:
        raise HTTPException(status_code=400, detail="Provide 'ids' or 'status'")

    deleted = await run_in_threadpool(
        _batch_delete_impl, history_mgr, req.status, req.ids
    )
    return {"status": "deleted", "count": deleted}


@router.get("/session/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str):
    db = DatabaseManager()
    entry = await run_in_threadpool(db.get_entry_by_session_id, session_id)
    if not entry:
        return {"cards": [], "session_id": session_id, "not_found": True}
    return entry
