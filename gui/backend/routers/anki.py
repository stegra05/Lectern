import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Any, Callable, Dict, List, Literal, Optional, Union

from lectern import config, anki_connector
from lectern.utils.note_export import export_card_to_anki
from lectern.utils.error_handling import capture_exception
from gui.backend.streaming import ndjson_event

router = APIRouter()
logger = logging.getLogger("lectern.backend.anki")

# --- Models ---


class AnkiStatusResponse(BaseModel):
    status: str
    connected: bool
    version: Optional[str] = None
    version_ok: bool = False
    collection_available: Optional[bool] = None
    error: Optional[str] = None


class DeckListResponse(BaseModel):
    decks: List[str]


class DeckCreate(BaseModel):
    name: str


class DeckCreateResponse(BaseModel):
    status: Literal["created"]
    deck: str


class AnkiDeleteRequest(BaseModel):
    note_ids: List[int]


class AnkiDeleteResponse(BaseModel):
    status: Literal["deleted"]
    count: int


class AnkiUpdateRequest(BaseModel):
    fields: Dict[str, str]


class AnkiUpdateResponse(BaseModel):
    status: Literal["updated"]
    note_id: int


class SyncRequest(BaseModel):
    cards: List[dict]
    deck_name: str
    tags: List[str]
    slide_set_name: str
    allow_updates: bool = False


# --- Helpers ---


def event_json(event_type: str, message: str = "", data: Optional[Dict] = None) -> str:
    return ndjson_event(event_type, message, data or {})


async def stream_sync_cards(
    cards: List[dict],
    deck_name: str,
    tags: List[str],
    slide_set_name: str = "",
    allow_updates: bool = False,
):
    created = 0
    updated = 0
    failed = 0

    yield event_json("progress_start", "Syncing to Anki...", {"total": len(cards)})

    async def _export_new_note(card: dict) -> tuple[bool, int | None, str | None]:
        result = await export_card_to_anki(
            card=card,
            deck_name=deck_name,
            slide_set_name=slide_set_name,
            fallback_model=config.DEFAULT_BASIC_MODEL,
            additional_tags=tags,
        )
        if result.success:
            card["anki_note_id"] = result.note_id
            return True, result.note_id, None
        return False, None, result.error

    for idx, card in enumerate(cards, start=1):
        note_id = card.get("anki_note_id")
        try:
            if allow_updates and note_id:
                info = await anki_connector.notes_info([note_id])
                if info and info[0].get("noteId"):
                    await anki_connector.update_note_fields(note_id, card["fields"])
                    updated += 1
                    yield event_json(
                        "note_updated", f"Updated note {note_id}", {"id": note_id}
                    )
                else:
                    success, created_id, error = await _export_new_note(card)
                    if success and created_id is not None:
                        created += 1
                        yield event_json(
                            "note_recreated",
                            f"Re-created note {created_id}",
                            {"id": created_id},
                        )
                    else:
                        failed += 1
                        yield event_json("warning", f"Failed to create note: {error}")
            else:
                success, created_id, error = await _export_new_note(card)
                if success and created_id is not None:
                    created += 1
                    yield event_json(
                        "note_created", f"Created note {created_id}", {"id": created_id}
                    )
                else:
                    failed += 1
                    yield event_json("warning", f"Failed to create note: {error}")
        except Exception as e:
            user_msg, _ = capture_exception(e, f"Sync card {idx}")
            failed += 1
            yield event_json("warning", f"Sync failed for card {idx}: {user_msg}")

        yield event_json("progress_update", "", {"current": created + updated + failed})

    yield event_json(
        "done",
        "Sync Complete",
        {"created": created, "updated": updated, "failed": failed},
    )


# --- Endpoints ---


@router.get("/anki/status", response_model=AnkiStatusResponse)
async def anki_status():
    """Detailed AnkiConnect status with diagnostics."""
    try:
        info = await anki_connector.get_connection_info()
        return {"status": "ok", **info}
    except Exception as e:
        user_msg, _ = capture_exception(e, "Anki status")
        return {
            "status": "error",
            "connected": False,
            "version": None,
            "version_ok": False,
            "error": user_msg,
        }


@router.get("/decks", response_model=DeckListResponse)
async def get_decks():
    try:
        info = await anki_connector.get_connection_info()
        if not info.get("connected") or not info.get("collection_available", False):
            return {"decks": []}
        decks = await anki_connector.get_deck_names()
        return {"decks": decks}
    except Exception as e:
        logger.warning(f"Deck list fetch failed: {e}")
        return {"decks": []}


@router.post("/decks", response_model=DeckCreateResponse)
async def create_deck_endpoint(req: DeckCreate):
    try:
        success = await anki_connector.create_deck(req.name)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to create deck in Anki")
        return {"status": "created", "deck": req.name}
    except Exception as e:
        logger.error(f"Deck creation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/anki/notes", response_model=AnkiDeleteResponse)
async def delete_anki_notes(req: AnkiDeleteRequest):
    try:
        await anki_connector.delete_notes(req.note_ids)
        return {"status": "deleted", "count": len(req.note_ids)}
    except Exception as e:
        logger.error(f"Failed to delete Anki notes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/anki/notes/{note_id}", response_model=AnkiUpdateResponse)
async def update_anki_note(note_id: int, req: AnkiUpdateRequest):
    """Update fields on an existing Anki note."""
    try:
        await anki_connector.update_note_fields(note_id, req.fields)
        return {"status": "updated", "note_id": note_id}
    except Exception as e:
        logger.error(f"Failed to update Anki note: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync")
async def sync_cards(req: SyncRequest):
    async def sync_generator():
        async for payload in stream_sync_cards(
            cards=req.cards,
            deck_name=req.deck_name,
            tags=req.tags,
            slide_set_name=req.slide_set_name,
            allow_updates=req.allow_updates,
        ):
            yield f"{payload}\n"

    return StreamingResponse(sync_generator(), media_type="application/x-ndjson")
