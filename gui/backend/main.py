import sys
import os
from pathlib import Path

# NOTE(Paths): Use Path.resolve() to handle frozen PyInstaller envs correctly.
_here = Path(__file__).resolve().parent          # gui/backend/
_project_root = _here.parent.parent              # project root
sys.path.insert(0, str(_project_root))
sys.path.insert(0, str(_here))

from lectern.version import __version__

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional
import hashlib
import shutil
import tempfile
import json
import time
import threading
import requests
from uuid import uuid4

from cachetools import TTLCache

from lectern.cost_estimator import recompute_estimate
from pypdf import PdfReader
import io
from starlette.concurrency import run_in_threadpool

from lectern.anki_connector import check_connection, get_deck_names, notes_info, update_note_fields, delete_notes
from lectern import config
from service import GenerationService, DraftStore
from lectern.lectern_service import LecternGenerationService, ServiceEvent
from lectern.utils.note_export import export_card_to_anki
from lectern.utils.history import HistoryManager
from lectern.utils.state import load_state, save_state, StateFile, resolve_state_context, clear_state, sweep_orphan_state_temps
from session import (
    SessionManager,
    SessionState,
    LECTERN_TEMP_PREFIX,
    session_manager,
    _get_session_or_404,
    _get_runtime_or_404,
)

app = FastAPI(title='Lectern API', version='1.6.1')
session_manager.sweep_orphan_temp_files()
sweep_orphan_state_temps()

# NOTE(Estimate): Session-level cache for estimate base data. Key = (content_sha256, model).
# Reuse token count across target/source changes for same PDF. TTL ~1h covers typical session.
_estimate_base_cache: TTLCache = TTLCache(maxsize=50, ttl=3600)

app.add_middleware(
    CORSMiddleware,
    allow_origins=getattr(config, "FRONTEND_ORIGINS", ["http://localhost:5173"]),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration Models
class ConfigUpdate(BaseModel):
    gemini_api_key: Optional[str] = None
    anki_url: Optional[str] = None
    basic_model: Optional[str] = None
    cloze_model: Optional[str] = None
    gemini_model: Optional[str] = None


def event_json(event_type: str, message: str = "", data: Optional[Dict] = None) -> str:
    return ServiceEvent(event_type, message, data or {}).to_json()


async def stream_sync_cards(
    cards: List[dict],
    deck_name: str,
    slide_set_name: str,
    additional_tags: List[str],
    *,
    allow_updates: bool,
    on_complete: Optional[Callable[[List[dict], int, int, int], None]] = None,
):
    created = 0
    updated = 0
    failed = 0

    yield event_json("progress_start", "Syncing to Anki...", {"total": len(cards)})

    def _export_new_note(card: dict) -> tuple[bool, int | None, str | None]:
        result = export_card_to_anki(
            card=card,
            deck_name=deck_name,
            slide_set_name=slide_set_name,
            fallback_model=config.DEFAULT_BASIC_MODEL,
            additional_tags=additional_tags,
        )
        if result.success:
            card["anki_note_id"] = result.note_id
            return True, result.note_id, None
        return False, None, result.error

    for idx, card in enumerate(cards, start=1):
        note_id = card.get("anki_note_id")
        try:
            if allow_updates and note_id:
                info = notes_info([note_id])
                if info and info[0].get("noteId"):
                    update_note_fields(note_id, card["fields"])
                    updated += 1
                    yield event_json("note_updated", f"Updated note {note_id}", {"id": note_id})
                else:
                    success, created_id, error = _export_new_note(card)
                    if success and created_id is not None:
                        created += 1
                        yield event_json("note_recreated", f"Re-created note {created_id}", {"id": created_id})
                    else:
                        failed += 1
                        yield event_json("warning", f"Failed to create note: {error}")
            else:
                success, created_id, error = _export_new_note(card)
                if success and created_id is not None:
                    created += 1
                    yield event_json("note_created", f"Created note {created_id}", {"id": created_id})
                else:
                    failed += 1
                    yield event_json("warning", f"Failed to create note: {error}")
        except Exception as e:
            failed += 1
            yield event_json("warning", f"Sync failed for card {idx}: {str(e)}")

        yield event_json("progress_update", "", {"current": created + updated + failed})

    if on_complete:
        on_complete(cards, created, updated, failed)

    yield event_json(
        "done",
        "Sync Complete",
        {"created": created, "updated": updated, "failed": failed},
    )

@app.get("/version")
async def get_version():
    """Returns local version and checks GitHub for updates."""
    # Check GitHub
    try:
        # We use a timeout to avoid hanging the UI
        response = await run_in_threadpool(
            requests.get,
            "https://api.github.com/repos/stegra05/Lectern/releases/latest",
            headers={"Accept": "application/vnd.github.v3+json"},
            timeout=5
        )
        if response.status_code == 200:
            data = response.json()
            latest_version = data.get("tag_name", "v0.0.0").lstrip("v")
            release_url = data.get("html_url", "https://github.com/stegra05/Lectern/releases")
            
            # Simple semver compare (split by dots)
            curr_parts = [int(p) for p in __version__.split(".")]
            late_parts = [int(p) for p in latest_version.split(".")]
            
            update_available = late_parts > curr_parts
            
            result: Dict[str, str | bool] = {
                "current": __version__,
                "latest": latest_version,
                "update_available": update_available,
                "release_url": release_url
            }

            return result
    except Exception as e:
        print(f"Update check failed: {e}")
    
    # Fallback to current only if check fails
    return {
        "current": __version__,
        "latest": None,
        "update_available": False,
        "release_url": "https://github.com/stegra05/Lectern/releases"
    }

@app.get("/health")
async def health_check():
    """Health check endpoint that safely checks system status.
    
    Returns status even if individual checks fail to prevent blocking the UI.
    """
    anki_status = False
    gemini_configured = False
    
    # Safely check Anki connection
    try:
        anki_status = await run_in_threadpool(check_connection)
    except Exception as e:
        print(f"Anki connection check failed: {e}")
        anki_status = False
    
    # Safely check Gemini config without reloading the entire module (which is expensive)
    try:
        gemini_configured = bool(config.GEMINI_API_KEY)
    except Exception as e:
        print(f"Gemini config check failed: {e}")
        gemini_configured = False
        
    return {
        "status": "ok",
        "anki_connected": anki_status,
        "gemini_configured": gemini_configured,
        "backend_ready": True
    }

@app.get("/config")
async def get_config():
    return {
        "gemini_model": config.DEFAULT_GEMINI_MODEL,
        "anki_url": config.ANKI_CONNECT_URL,
        "basic_model": config.DEFAULT_BASIC_MODEL,
        "cloze_model": config.DEFAULT_CLOZE_MODEL,
        "gemini_configured": bool(config.GEMINI_API_KEY)
    }

@app.post("/config")
async def update_config(cfg: ConfigUpdate):
    updated_fields = []
    
    # Handle API key separately (Keychain storage)
    if cfg.gemini_api_key:
        try:
            from lectern.utils.keychain_manager import set_gemini_key
            set_gemini_key(cfg.gemini_api_key)
            
            # Remove from .env if present to avoid confusion/leaks
            def update_env():
                env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.env"))
                if os.path.exists(env_path):
                    with open(env_path, "r") as f:
                        lines = f.readlines()
                    new_lines = [line for line in lines if not line.startswith("GEMINI_API_KEY=")]
                    with open(env_path, "w") as f:
                        f.writelines(new_lines)

            await run_in_threadpool(update_env)
            updated_fields.append("gemini_api_key")
        except Exception as e:
            print(f"Failed to update API key: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    # Handle other settings (JSON storage)
    json_updates = {}
    if cfg.anki_url:
        json_updates["anki_url"] = cfg.anki_url
        updated_fields.append("anki_url")

    # Validate note-type names against Anki before saving
    warnings = []
    if cfg.basic_model or cfg.cloze_model:
        try:
            from lectern.anki_connector import get_model_names
            anki_models = await run_in_threadpool(get_model_names)
        except Exception:
            anki_models = []
        if anki_models:
            if cfg.basic_model and cfg.basic_model not in anki_models:
                warnings.append(f"Note type '{cfg.basic_model}' not found in Anki — saving anyway.")
            if cfg.cloze_model and cfg.cloze_model not in anki_models:
                warnings.append(f"Note type '{cfg.cloze_model}' not found in Anki — saving anyway.")

    if cfg.basic_model:
        json_updates["basic_model"] = cfg.basic_model
        updated_fields.append("basic_model")
    if cfg.cloze_model:
        json_updates["cloze_model"] = cfg.cloze_model
        updated_fields.append("cloze_model")
    if cfg.gemini_model:
        json_updates["gemini_model"] = cfg.gemini_model
        updated_fields.append("gemini_model")
    
    if json_updates:
        try:
            config.save_user_config(json_updates)
        except Exception as e:
            print(f"Failed to save user config: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    # Reload config module to reflect changes immediately
    if updated_fields:
        from importlib import reload
        reload(config)
        # Also invalidate the note-export model cache
        from lectern.utils import note_export as _ne
        _ne._anki_models_cache = None
        result: dict = {"status": "updated", "fields": updated_fields}
        if warnings:
            result["warnings"] = warnings
        return result
            
    return {"status": "no_change"}

@app.get("/history")
async def get_history():
    mgr = HistoryManager()
    return await run_in_threadpool(mgr.get_all)

@app.get("/decks")
async def get_decks():
    try:
        decks = await run_in_threadpool(get_deck_names)
        return {"decks": decks}
    except Exception as e:
        print(f"Deck list fetch failed: {e}")
        return {"decks": []}

class DeckCreate(BaseModel):
    name: str

@app.post("/decks")
async def create_deck_endpoint(req: DeckCreate):
    from lectern.anki_connector import create_deck
    try:
        success = await run_in_threadpool(create_deck, req.name)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to create deck in Anki")
        return {"status": "created", "deck": req.name}
    except Exception as e:
        print(f"Deck creation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/history")
async def clear_history():
    mgr = HistoryManager()
    # Clean up state files before clearing history
    for entry in mgr.get_all():
        session_id = entry.get("session_id")
        if session_id:
            clear_state(session_id)
    mgr.clear_all()
    return {"status": "cleared"}

@app.delete("/history/{entry_id}")
async def delete_history_entry(entry_id: str):
    mgr = HistoryManager()
    entry = mgr.get_entry(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    
    # Clean up persistent session state
    session_id = entry.get("session_id")
    if session_id:
        clear_state(session_id)
        
    success = mgr.delete_entry(entry_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete history entry")
    return {"status": "deleted"}


class BatchDeleteRequest(BaseModel):
    ids: Optional[List[str]] = None
    status: Optional[str] = None

@app.post("/history/batch-delete")
async def batch_delete_history(req: BatchDeleteRequest):
    mgr = HistoryManager()

    if req.status:
        entries = mgr.get_entries_by_status(req.status)
    elif req.ids:
        entries = [e for e in mgr.get_all() if e["id"] in set(req.ids)]
    else:
        raise HTTPException(status_code=400, detail="Provide 'ids' or 'status'")

    # Clean up state files
    for entry in entries:
        sid = entry.get("session_id")
        if sid:
            clear_state(sid)

    entry_ids = [e["id"] for e in entries]
    deleted = mgr.delete_entries(entry_ids)
    return {"status": "deleted", "count": deleted}

def _estimate_cache_key(tmp_path: str, model: str) -> tuple:
    """Content-based key for same PDF+model. Reuses cache when same file uploaded again."""
    h = hashlib.sha256()
    with open(tmp_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return (h.hexdigest(), model or "")


@app.post("/estimate")
async def estimate_cost(
    pdf_file: UploadFile = File(...),
    model_name: Optional[str] = Form(None),
    source_type: str = Form("auto"),
    target_card_count: Optional[int] = Form(None),
):
    from starlette.concurrency import run_in_threadpool

    model = model_name or config.DEFAULT_GEMINI_MODEL

    # Save uploaded file to temp in threadpool to avoid blocking
    def save_to_temp():
        with tempfile.NamedTemporaryFile(
            delete=False,
            prefix=LECTERN_TEMP_PREFIX,
            suffix=".pdf",
        ) as tmp:
            shutil.copyfileobj(pdf_file.file, tmp)
            return tmp.name

    tmp_path = await run_in_threadpool(save_to_temp)

    try:
        cache_key = _estimate_cache_key(tmp_path, model)
        base_data = _estimate_base_cache.get(cache_key)

        if base_data is not None:
            # Fast path: reuse token count, recompute card count + cost
            data = recompute_estimate(
                token_count=base_data["token_count"],
                page_count=base_data["page_count"],
                text_chars=base_data["text_chars"],
                image_count=base_data["image_count"],
                model=base_data["model"],
                source_type=source_type,
                target_card_count=target_card_count,
            )
            return data

        # Full path: upload + token count, then cache base data
        service = LecternGenerationService()
        data, base_data = await service.estimate_cost_with_base(
            tmp_path,
            model_name=model_name,
            source_type=source_type,
            target_card_count=target_card_count,
        )
        _estimate_base_cache[cache_key] = base_data
        return data
    except Exception as e:
        print(f"Estimation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

@app.post("/generate")
async def generate_cards(
    pdf_file: UploadFile = File(...),
    deck_name: str = Form(...),
    model_name: str = Form(config.DEFAULT_GEMINI_MODEL),
    tags: str = Form("[]"),  # JSON string
    context_deck: str = Form(""),
    focus_prompt: str = Form(""),  # Optional user focus
    source_type: str = Form("auto"),  # "auto", "slides", "script"
    target_card_count: Optional[int] = Form(None),
):
    draft_store = DraftStore()
    service = GenerationService(draft_store)
    
    # NOTE(Exam-Mode): exam_mode is removed in favor of focus_prompt.
    if focus_prompt:
        print(f"Info: User focus: '{focus_prompt}'")
    
    if source_type != "auto":
        print(f"Info: Source type override: {source_type}")
    
    # Parse tags from JSON string
    try:
        tags_list = json.loads(tags)
    except:
        tags_list = []

    # Save uploaded file to temp
    # We use delete=False so it persists for thumbnail generation
    # Run in threadpool to avoid blocking
    from starlette.concurrency import run_in_threadpool
    def save_generate_temp():
        with tempfile.NamedTemporaryFile(
            delete=False,
            prefix=LECTERN_TEMP_PREFIX,
            suffix=".pdf",
        ) as tmp:
            shutil.copyfileobj(pdf_file.file, tmp)
            return tmp.name
            
    tmp_path = await run_in_threadpool(save_generate_temp)
    
    # Debug: Check file sizes
    try:
        uploaded_size = os.fstat(pdf_file.file.fileno()).st_size
    except:
        uploaded_size = -1 # Cannot determine
        
    temp_size = os.path.getsize(tmp_path)
    print(f"Info: Uploaded file size: {uploaded_size} bytes. Temp file size: {temp_size} bytes. Path: {tmp_path}")
        
    session = session_manager.create_session(
        pdf_path=tmp_path,
        generation_service=service,
        draft_store=draft_store,
    )

    # Create history entry
    history_mgr = HistoryManager()
    entry_id = history_mgr.add_entry(
        filename=pdf_file.filename,
        deck=deck_name,
        session_id=session.session_id,
        status="draft"
    )

    status_handlers = {
        "done": ("completed", True),
        "cancelled": ("cancelled", False),
        "error": ("error", False),
    }

    async def event_generator():
        yield event_json(
            "session_start",
            "Session started",
            {"session_id": session.session_id},
        ) + "\n"
        try:
            async for event_str in service.run_generation(
                pdf_path=tmp_path,
                deck_name=deck_name,
                model_name=model_name,
                tags=tags_list,
                context_deck=context_deck,
                entry_id=entry_id,
                focus_prompt=focus_prompt,
                source_type=source_type,
                target_card_count=target_card_count,
                session_id=session.session_id,
            ):
                yield f"{event_str}\n"
                try:
                    parsed = json.loads(event_str)
                    event_type = parsed.get("type")
                    if event_type in status_handlers:
                        status, cleanup = status_handlers[event_type]
                        session_manager.mark_status(session.session_id, status)
                        if cleanup:
                            session_manager.cleanup_temp_file(session.session_id)
                except Exception:
                    pass
        except Exception as e:
            session_manager.mark_status(session.session_id, "error")
            yield f'{{"type": "error", "message": "Generation failed: {str(e)}", "timestamp": 0}}\n'

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

@app.post("/stop")
async def stop_generation(session_id: Optional[str] = None):
    session = _get_session_or_404(session_id)
    runtime = _get_runtime_or_404(session.session_id, session=session)
    runtime.draft_store.clear()
    session_manager.stop_session(session.session_id)
    return {"status": "stopped", "session_id": session.session_id}

# Draft API
@app.get("/drafts")
async def get_drafts(session_id: Optional[str] = None):
    session = _get_session_or_404(session_id, require_session_id=True)
    runtime = _get_runtime_or_404(session.session_id, session=session)
    return {"cards": runtime.draft_store.get_drafts(), "session_id": session.session_id}

class DraftUpdate(BaseModel):
    card: dict

@app.put("/drafts/{index}")
async def update_draft(index: int, update: DraftUpdate, session_id: Optional[str] = None):
    session = _get_session_or_404(session_id, require_session_id=True)
    runtime = _get_runtime_or_404(session.session_id, session=session)
    success = runtime.draft_store.update_draft(index, update.card)
    if not success:
        raise HTTPException(status_code=404, detail="Draft not found")
    return {"status": "updated", "session_id": session.session_id}

@app.delete("/drafts/{index}")
async def delete_draft(index: int, session_id: Optional[str] = None):
    session = _get_session_or_404(session_id, require_session_id=True)
    runtime = _get_runtime_or_404(session.session_id, session=session)
    success = runtime.draft_store.delete_draft(index)
    if not success:
        raise HTTPException(status_code=404, detail="Draft not found")
    return {"status": "deleted", "session_id": session.session_id}

@app.post("/drafts/sync")
async def sync_drafts(session_id: Optional[str] = None):
    session = _get_session_or_404(session_id, require_session_id=True)
    runtime = _get_runtime_or_404(session.session_id, session=session)
    store = runtime.draft_store
    state = load_state(session.session_id)
    state_ctx = resolve_state_context(
        session.session_id,
        state=state,
        fallback={
            "cards": store.get_drafts(),
            "deck_name": store.deck_name,
            "model_name": store.model_name,
            "tags": store.tags,
            "slide_set_name": store.slide_set_name,
            "entry_id": store.entry_id,
        },
    )
    cards = state_ctx["cards"]
    
    if not cards:
        return {"created": 0, "failed": 0, "session_id": session.session_id}
        
    deck_name = state_ctx["deck_name"] or store.deck_name
    model_name = state_ctx["model_name"] or store.model_name
    tags = state_ctx["tags"] or store.tags
    slide_set_name = state_ctx["slide_set_name"] or store.slide_set_name
    entry_id = state_ctx["entry_id"] or store.entry_id

    def on_complete(updated_cards: List[dict], created: int, updated: int, failed: int) -> None:
        StateFile(session.session_id).update_cards(
            updated_cards,
            deck_name=deck_name,
            slide_set_name=slide_set_name,
            model_name=model_name,
            tags=tags,
            entry_id=entry_id,
        )

        if entry_id:
            history_mgr = HistoryManager()
            history_mgr.update_entry(
                entry_id=entry_id,
                status="completed" if failed == 0 else "error",
                card_count=created + updated,
            )

        store.clear()
        if failed == 0:
            session_manager.mark_status(session.session_id, "completed")
            session_manager.cleanup_session(session.session_id)
        else:
            session_manager.mark_status(session.session_id, "error")

    async def sync_generator():
        async for payload in stream_sync_cards(
            cards=cards,
            deck_name=deck_name,
            slide_set_name=slide_set_name or "Draft Sync",
            additional_tags=tags or [],
            allow_updates=False,
            on_complete=on_complete,
        ):
            yield f"{payload}\n"

    return StreamingResponse(sync_generator(), media_type="application/x-ndjson")

# Session API (View/Edit Past Sessions)

class SessionCardsUpdate(BaseModel):
    cards: List[dict]

@app.get("/session/{session_id}")
async def get_session(session_id: str):
    state = load_state(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    return state

@app.get("/session/{session_id}/status")
async def get_session_status(session_id: str):
    session = session_manager.get_session(session_id)
    if not session:
        return {"active": False, "status": "missing"}
    is_active = session.status == "active"
    return {"active": is_active, "status": session.status}

@app.put("/session/{session_id}/cards")
async def update_session_cards(session_id: str, update: SessionCardsUpdate):
    state = load_state(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Save the updated cards back to the session state
    StateFile(session_id).update_cards(update.cards)
    return {"status": "ok", "session_id": session_id}

@app.delete("/session/{session_id}/cards/{card_index}")
async def delete_session_card(session_id: str, card_index: int):
    state = load_state(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    
    cards = state["cards"]
    if card_index < 0 or card_index >= len(cards):
        raise HTTPException(status_code=404, detail="Card not found")
    
    cards.pop(card_index)
    
    # Save the updated cards back to the session state
    StateFile(session_id).update_cards(cards)

    # Try to update history card count via session_id lookup
    try:
        mgr = HistoryManager()
        entry = mgr.get_entry_by_session_id(session_id)
        if entry:
            mgr.update_entry(entry["id"], card_count=len(cards))
    except Exception as e:
        print(f"Warning: Failed to update history card count: {e}")

    return {"status": "ok", "remaining": len(cards)}

class AnkiDeleteRequest(BaseModel):
    note_ids: List[int]

@app.delete("/anki/notes")
async def delete_anki_notes(req: AnkiDeleteRequest):
    try:
        delete_notes(req.note_ids)
        return {"status": "deleted", "count": len(req.note_ids)}
    except Exception as e:
        print(f"Failed to delete Anki notes: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class AnkiUpdateRequest(BaseModel):
    fields: Dict[str, str]

@app.put("/anki/notes/{note_id}")
async def update_anki_note(note_id: int, req: AnkiUpdateRequest):
    """Update fields on an existing Anki note."""
    try:
        from lectern.anki_connector import update_note_fields
        update_note_fields(note_id, req.fields)
        return {"status": "updated", "note_id": note_id}
    except Exception as e:
        print(f"Failed to update Anki note: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/session/{session_id}/sync")
async def sync_session_to_anki(session_id: str):
    state = load_state(session_id)
    state_ctx = resolve_state_context(session_id, state=state)
    if not state_ctx["state"]:
        raise HTTPException(status_code=404, detail="Session not found")

    cards = state_ctx["cards"]
    if not cards:
        return {"created": 0, "updated": 0, "failed": 0, "session_id": session_id}
        
    deck_name = state_ctx["deck_name"]
    slide_set_name = state_ctx["slide_set_name"] or "Session Sync"

    def on_complete(updated_cards: List[dict], created: int, updated: int, failed: int) -> None:
        StateFile(session_id).update_cards(updated_cards)

    async def sync_generator():
        async for payload in stream_sync_cards(
            cards=cards,
            deck_name=deck_name,
            slide_set_name=slide_set_name,
            additional_tags=[],
            allow_updates=True,
            on_complete=on_complete,
        ):
            yield f"{payload}\n"

    return StreamingResponse(sync_generator(), media_type="application/x-ndjson")



# Mount static files (Frontend Build)
# Mount static files (Frontend Build)
# In Dev: ../frontend/dist (relative to backend/main.py)
# In Frozen: frontend/dist (relative to sys._MEIPASS root)
if hasattr(sys, '_MEIPASS'):
    frontend_dist = os.path.join(sys._MEIPASS, "frontend/dist")
else:
    frontend_dist = os.path.join(os.path.dirname(__file__), "../frontend/dist")

if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")
    
    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        # Serve index.html for any non-api route (SPA routing)
        if full_path.startswith("api") or full_path.startswith("assets") or full_path == "health" or full_path == "generate" or full_path == "config" or full_path == "history":
            raise HTTPException(status_code=404)
        return FileResponse(os.path.join(frontend_dist, "index.html"))
else:
    print(f"Warning: Frontend build not found at {frontend_dist}")


@app.on_event("shutdown")
async def shutdown_cleanup():
    session_manager.shutdown()
