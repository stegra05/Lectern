from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dataclasses import dataclass, field
from typing import Dict, List, Optional
import os
import sys
import shutil
import tempfile
import json
import time
import threading
import requests
from uuid import uuid4
from version import __version__

# Add parent directory to path to import ankiparse modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
# Add current directory to path to import local modules (service.py)
sys.path.append(os.path.dirname(__file__))


from pypdf import PdfReader
import io
from starlette.concurrency import run_in_threadpool

from anki_connector import check_connection, get_deck_names, notes_info, update_note_fields, delete_notes
import config
from service import GenerationService, DraftStore
from lectern_service import LecternGenerationService
from utils.note_export import export_card_to_anki
from utils.history import HistoryManager
from utils.state import load_state, save_state

app = FastAPI(title='Lectern API', version='1.0.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=getattr(config, "FRONTEND_ORIGINS", ["http://localhost:5173"]),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSION_TTL_SECONDS = 60 * 60 * 4

@dataclass
class SessionState:
    session_id: str
    pdf_path: str
    generation_service: GenerationService
    draft_store: DraftStore
    thumbnail_cache: Dict[int, bytes] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    last_accessed: float = field(default_factory=time.time)
    status: str = "active"
    completed_at: Optional[float] = None

    def touch(self) -> None:
        self.last_accessed = time.time()

class SessionManager:
    def __init__(self):
        self._sessions: Dict[str, SessionState] = {}
        self._lock = threading.Lock()
        self._latest_session_id: Optional[str] = None

    def create_session(self, pdf_path: str, generation_service: GenerationService, draft_store: DraftStore) -> SessionState:
        session_id = uuid4().hex
        session = SessionState(
            session_id=session_id,
            pdf_path=pdf_path,
            generation_service=generation_service,
            draft_store=draft_store,
        )
        with self._lock:
            self._sessions[session_id] = session
            self._latest_session_id = session_id
            self._prune_locked()
        return session

    def get_session(self, session_id: str) -> Optional[SessionState]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.touch()
            self._prune_locked()
            return session

    def get_latest_session(self) -> Optional[SessionState]:
        if not self._latest_session_id:
            return None
        return self.get_session(self._latest_session_id)

    def mark_status(self, session_id: str, status: str) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return
            session.status = status
            if status in {"completed", "cancelled", "error"}:
                session.completed_at = time.time()

    def stop_session(self, session_id: str) -> None:
        session = self.get_session(session_id)
        if not session:
            return
        session.generation_service.stop()
        self.mark_status(session_id, "cancelled")
        self._cleanup_session_files(session)
        with self._lock:
            self._sessions.pop(session_id, None)

    def cleanup_session(self, session_id: str) -> None:
        session = self.get_session(session_id)
        if not session:
            return
        self._cleanup_session_files(session)
        with self._lock:
            self._sessions.pop(session_id, None)

    def prune(self) -> None:
        with self._lock:
            self._prune_locked()

    def _cleanup_session_files(self, session: SessionState) -> None:
        if session.pdf_path and os.path.exists(session.pdf_path):
            try:
                os.remove(session.pdf_path)
            except Exception as e:
                print(f"Warning: Failed to cleanup PDF: {e}")
        session.thumbnail_cache = {}

    def _prune_locked(self) -> None:
        now = time.time()
        to_remove = []
        for session_id, session in self._sessions.items():
            if session.status == "active":
                continue
            completed_at = session.completed_at or session.last_accessed
            if now - completed_at > SESSION_TTL_SECONDS:
                to_remove.append(session_id)
        for session_id in to_remove:
            session = self._sessions.get(session_id)
            if session:
                self._cleanup_session_files(session)
            self._sessions.pop(session_id, None)

session_manager = SessionManager()

def _get_session_or_404(session_id: Optional[str], *, require_session_id: bool = False) -> SessionState:
    if require_session_id and not session_id:
        raise HTTPException(status_code=400, detail="session_id is required")
    session = session_manager.get_session(session_id) if session_id else session_manager.get_latest_session()
    if not session:
        raise HTTPException(status_code=404, detail="No active session")
    return session

# Configuration Models
class ConfigUpdate(BaseModel):
    gemini_api_key: Optional[str] = None
    anki_url: Optional[str] = None
    basic_model: Optional[str] = None
    cloze_model: Optional[str] = None
    gemini_model: Optional[str] = None

# Update Cache
_update_cache = {
    "data": None,
    "expires_at": 0
}
_update_lock = threading.Lock()

@app.get("/version")
async def get_version():
    """Returns local version and checks GitHub for updates."""
    global _update_cache
    
    now = time.time()
    
    with _update_lock:
        if _update_cache["data"] and now < _update_cache["expires_at"]:
            return _update_cache["data"]

    # Check GitHub
    try:
        # We use a timeout to avoid hanging the UI
        response = requests.get(
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
            
            result = {
                "current": __version__,
                "latest": latest_version,
                "update_available": update_available,
                "release_url": release_url
            }
            
            with _update_lock:
                _update_cache = {
                    "data": result,
                    "expires_at": now + 3600  # 1 hour cache
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
            from utils.keychain_manager import set_gemini_key
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
        return {"status": "updated", "fields": updated_fields}
            
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
    from anki_connector import create_deck
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
        from utils.state import clear_state
        clear_state(session_id)
        
    success = mgr.delete_entry(entry_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete history entry")
    return {"status": "deleted"}

@app.post("/estimate")
async def estimate_cost(pdf_file: UploadFile = File(...), model_name: Optional[str] = None):
    from starlette.concurrency import run_in_threadpool
    
    # Save uploaded file to temp in threadpool to avoid blocking
    def save_to_temp():
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            shutil.copyfileobj(pdf_file.file, tmp)
            return tmp.name
            
    tmp_path = await run_in_threadpool(save_to_temp)

    try:
        service = LecternGenerationService()
        data = await service.estimate_cost(tmp_path, model_name)
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
    density_target: float = Form(config.CARDS_PER_SLIDE_TARGET),  # Detail level
    max_notes_per_batch: int = Form(config.MAX_NOTES_PER_BATCH),
    reflection_rounds: int = Form(config.REFLECTION_MAX_ROUNDS),
    enable_reflection: bool = Form(config.ENABLE_REFLECTION),
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
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
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

    async def event_generator():
        yield json.dumps({
            "type": "session_start",
            "message": "Session started",
            "data": {"session_id": session.session_id},
            "timestamp": time.time(),
        }) + "\n"
        try:
            async for event_json in service.run_generation(
                pdf_path=tmp_path,
                deck_name=deck_name,
                model_name=model_name,
                tags=tags_list,
                context_deck=context_deck,
                entry_id=entry_id,
                focus_prompt=focus_prompt,
                source_type=source_type,
                density_target=density_target,
                max_notes_per_batch=max_notes_per_batch,
                reflection_rounds=reflection_rounds,
                enable_reflection=enable_reflection,
                session_id=session.session_id,
            ):
                yield f"{event_json}\n"
                try:
                    parsed = json.loads(event_json)
                    event_type = parsed.get("type")
                    if event_type in {"done"}:
                        session_manager.mark_status(session.session_id, "completed")
                    elif event_type in {"cancelled"}:
                        session_manager.mark_status(session.session_id, "cancelled")
                    elif event_type in {"error"}:
                        session_manager.mark_status(session.session_id, "error")
                except Exception:
                    pass
        except Exception as e:
            session_manager.mark_status(session.session_id, "error")
            yield f'{{"type": "error", "message": "Generation failed: {str(e)}", "timestamp": 0}}\n'
        finally:
            session_manager.prune()

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

@app.post("/stop")
async def stop_generation(session_id: Optional[str] = None):
    session = _get_session_or_404(session_id)
    session.draft_store.clear()
    session_manager.stop_session(session.session_id)
    return {"status": "stopped", "session_id": session.session_id}

# Draft API
@app.get("/drafts")
async def get_drafts(session_id: Optional[str] = None):
    session = _get_session_or_404(session_id, require_session_id=True)
    return {"cards": session.draft_store.get_drafts(), "session_id": session.session_id}

class DraftUpdate(BaseModel):
    card: dict

@app.put("/drafts/{index}")
async def update_draft(index: int, update: DraftUpdate, session_id: Optional[str] = None):
    session = _get_session_or_404(session_id, require_session_id=True)
    success = session.draft_store.update_draft(index, update.card)
    if not success:
        raise HTTPException(status_code=404, detail="Draft not found")
    return {"status": "updated", "session_id": session.session_id}

@app.delete("/drafts/{index}")
async def delete_draft(index: int, session_id: Optional[str] = None):
    session = _get_session_or_404(session_id, require_session_id=True)
    success = session.draft_store.delete_draft(index)
    if not success:
        raise HTTPException(status_code=404, detail="Draft not found")
    return {"status": "deleted", "session_id": session.session_id}

@app.post("/drafts/sync")
async def sync_drafts(session_id: Optional[str] = None):
    session = _get_session_or_404(session_id, require_session_id=True)
    store = session.draft_store
    cards = store.get_drafts()
    
    if not cards:
        return {"created": 0, "failed": 0, "session_id": session.session_id}
        
    deck_name = store.deck_name
    model_name = store.model_name
    tags = store.tags
    
    created = 0
    failed = 0
    
    # We can stream progress here too if we want, but for now let's just do it and return result
    # Or better, use StreamingResponse to show progress bar in UI
    
    async def sync_generator():
        nonlocal created, failed
        
        yield json.dumps({"type": "progress_start", "message": "Syncing to Anki...", "data": {"total": len(cards)}}) + "\n"
        
        for idx, card in enumerate(cards, start=1):
            result = export_card_to_anki(
                card=card,
                card_index=idx,
                deck_name=deck_name,
                slide_set_name=store.slide_set_name,
                fallback_model=config.DEFAULT_BASIC_MODEL,
                additional_tags=tags,
            )
            
            if result.success:
                created += 1
                card["anki_note_id"] = result.note_id
                # Update the card in the store so it has the note_id for session state persistence
                store.update_draft(idx - 1, card)
                yield json.dumps({"type": "note_created", "message": f"Created note {result.note_id}", "data": {"id": result.note_id}}) + "\n"
            else:
                failed += 1
                yield json.dumps({"type": "warning", "message": f"Failed to create note: {result.error}"}) + "\n"
            
            yield json.dumps({"type": "progress_update", "message": "", "data": {"current": created + failed}}) + "\n"

        yield json.dumps({"type": "done", "message": "Sync Complete", "data": {"created": created, "failed": failed}}) + "\n"
        
        # Update history entry
        if store.entry_id:
            history_mgr = HistoryManager()
            history_mgr.update_entry(
                entry_id=store.entry_id,
                status="completed",
                card_count=created
            )

        # Clear drafts after successful sync
        store.clear()
        if failed == 0:
            session_manager.mark_status(session.session_id, "completed")
            session_manager.cleanup_session(session.session_id)
        else:
            session_manager.mark_status(session.session_id, "error")

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

@app.put("/session/{session_id}/cards")
async def update_session_cards(session_id: str, update: SessionCardsUpdate):
    state = load_state(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Save the updated cards back to the session state
    save_state(
        pdf_path=state["pdf_path"],
        deck_name=state["deck_name"],
        cards=update.cards,
        concept_map=state["concept_map"],
        history=state["history"],
        log_path=state.get("log_path", ""),
        session_id=session_id,
        slide_set_name=state.get("slide_set_name"),
    )
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
    save_state(
        pdf_path=state["pdf_path"],
        deck_name=state["deck_name"],
        cards=cards,
        concept_map=state["concept_map"],
        history=state["history"],
        log_path=state.get("log_path", ""),
        session_id=session_id,
        slide_set_name=state.get("slide_set_name"),
    )

    # Try to update history card count if this session corresponds to a history entry
    try:
        mgr = HistoryManager()
        # Assume session_id is the entry_id for persistent sessions
        mgr.update_entry(session_id, card_count=len(cards))
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
        from anki_connector import update_note_fields
        update_note_fields(note_id, req.fields)
        return {"status": "updated", "note_id": note_id}
    except Exception as e:
        print(f"Failed to update Anki note: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/session/{session_id}/sync")
async def sync_session_to_anki(session_id: str):
    state = load_state(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found")
    
    cards = state["cards"]
    if not cards:
        return {"created": 0, "updated": 0, "failed": 0, "session_id": session_id}
        
    deck_name = state["deck_name"]
    # We need slide_set_name. If missing in state, try to infer from tags or use "Default"
    # For re-sync, we usually have tags in cards.
    # Note: history entry in state might have more details.
    
    created = 0
    updated = 0
    failed = 0
    
    async def sync_generator():
        nonlocal created, updated, failed
        
        yield json.dumps({"type": "progress_start", "message": "Syncing to Anki...", "data": {"total": len(cards)}}) + "\n"
        
        # We need a slide_set_name for tag building if the card doesn't have it.
        # Let's try to get it from historical tags if possible.
        # We need a slide_set_name for tag building if the card doesn't have it.
        # Let's try to get it from historical tags if possible.
        slide_set_name = state.get("slide_set_name") or "Session Sync"

        for idx, card in enumerate(cards, start=1):
            note_id = card.get("anki_note_id")
            
            try:
                if note_id:
                    # Validate existence
                    info = notes_info([note_id])
                    if info and info[0].get("noteId"):
                        # Update
                        update_note_fields(note_id, card["fields"])
                        updated += 1
                        yield json.dumps({"type": "note_updated", "message": f"Updated note {note_id}", "data": {"id": note_id}}) + "\n"
                    else:
                        # Re-create (deleted externally)
                        result = export_card_to_anki(
                            card=card,
                            card_index=idx,
                            deck_name=deck_name,
                            slide_set_name=slide_set_name,
                            fallback_model=config.DEFAULT_BASIC_MODEL,
                            additional_tags=[], # Assume tags already in card
                        )
                        if result.success:
                            card["anki_note_id"] = result.note_id
                            created += 1
                            yield json.dumps({"type": "note_recreated", "message": f"Re-created note {result.note_id}", "data": {"id": result.note_id}}) + "\n"
                        else:
                            raise RuntimeError(result.error)
                else:
                    # New sync
                    result = export_card_to_anki(
                        card=card,
                        card_index=idx,
                        deck_name=deck_name,
                        slide_set_name=slide_set_name,
                        fallback_model=config.DEFAULT_BASIC_MODEL,
                        additional_tags=[],
                    )
                    if result.success:
                        card["anki_note_id"] = result.note_id
                        created += 1
                        yield json.dumps({"type": "note_created", "message": f"Created note {result.note_id}", "data": {"id": result.note_id}}) + "\n"
                    else:
                        raise RuntimeError(result.error)
            except Exception as e:
                failed += 1
                yield json.dumps({"type": "warning", "message": f"Sync failed for card {idx}: {str(e)}"}) + "\n"
            
            yield json.dumps({"type": "progress_update", "message": "", "data": {"current": created + updated + failed}}) + "\n"

        # Save updated state with new anki_note_ids
        save_state(
            pdf_path=state["pdf_path"],
            deck_name=state["deck_name"],
            cards=cards,
            concept_map=state["concept_map"],
            history=state["history"],
            log_path=state.get("log_path", ""),
            session_id=session_id,
            slide_set_name=state.get("slide_set_name"),
        )

        yield json.dumps({"type": "done", "message": "Sync Complete", "data": {"created": created, "updated": updated, "failed": failed}}) + "\n"

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

