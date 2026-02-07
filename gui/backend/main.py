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
from uuid import uuid4

# Add parent directory to path to import ankiparse modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
# Add current directory to path to import local modules (service.py)
sys.path.append(os.path.dirname(__file__))

from pdf2image import convert_from_path
from pdf2image.exceptions import PDFInfoNotInstalledError, PDFPageCountError
from pypdf import PdfReader
import io
from starlette.concurrency import run_in_threadpool

from anki_connector import check_connection, get_deck_names
import config
from service import GenerationService, DraftStore
from lectern_service import LecternGenerationService
from utils.note_export import export_card_to_anki
from utils.history import HistoryManager

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
    if cfg.gemini_api_key:
        try:
            # Securely store in keychain
            from utils.keychain_manager import set_gemini_key
            set_gemini_key(cfg.gemini_api_key)
            
            # Remove from .env if present to avoid confusion/leaks
            from starlette.concurrency import run_in_threadpool

            def update_env():
                env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.env"))
                if os.path.exists(env_path):
                    with open(env_path, "r") as f:
                        lines = f.readlines()

                    new_lines = [line for line in lines if not line.startswith("GEMINI_API_KEY=")]

                    with open(env_path, "w") as f:
                        f.writelines(new_lines)

            await run_in_threadpool(update_env)

            # Reload config module to reflect changes immediately
            # We need to set the env var temporarily for the current process if config relies on it
            # But config.py now checks keychain, so we just need to reload it.
            # However, config.py reads at module level.
            from importlib import reload
            reload(config)
            
            return {"status": "updated"}
        except Exception as e:
            print(f"Failed to update config: {e}")
            raise HTTPException(status_code=500, detail=str(e))
            
    return {"status": "no_change"}

@app.get("/history")
async def get_history():
    mgr = HistoryManager()
    return mgr.get_all()

@app.get("/decks")
async def get_decks():
    try:
        decks = await run_in_threadpool(get_deck_names)
        return {"decks": decks}
    except Exception as e:
        print(f"Deck list fetch failed: {e}")
        return {"decks": []}

@app.delete("/history")
async def clear_history():
    mgr = HistoryManager()
    mgr.clear_all()
    return {"status": "cleared"}

@app.delete("/history/{entry_id}")
async def delete_history_entry(entry_id: str):
    mgr = HistoryManager()
    success = mgr.delete_entry(entry_id)
    if not success:
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"status": "deleted"}

@app.post("/estimate")
async def estimate_cost(pdf_file: UploadFile = File(...)):
    from starlette.concurrency import run_in_threadpool
    
    # Save uploaded file to temp in threadpool to avoid blocking
    def save_to_temp():
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            shutil.copyfileobj(pdf_file.file, tmp)
            return tmp.name
            
    tmp_path = await run_in_threadpool(save_to_temp)

    try:
        service = LecternGenerationService()
        data = await service.estimate_cost(tmp_path)
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
    exam_mode: bool = Form(False),  # NEW: Enable exam-focused card generation
    source_type: str = Form("auto"),  # NEW: "auto", "slides", "script"
    max_notes_per_batch: int = Form(config.MAX_NOTES_PER_BATCH),
    reflection_rounds: int = Form(config.REFLECTION_MAX_ROUNDS),
    enable_reflection: bool = Form(config.ENABLE_REFLECTION),
):
    draft_store = DraftStore()
    service = GenerationService(draft_store)
    
    # NOTE(Exam-Mode): exam_mode is now passed through the service chain,
    # not set as a global config mutation. This is thread-safe.
    if exam_mode:
        print("Info: Exam mode ENABLED - prioritizing comparison/application cards")
    
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
                exam_mode=exam_mode,
                source_type=source_type,
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
                fallback_model=config.DEFAULT_BASIC_MODEL,  # NOTE: Anki note type, not Gemini model
                additional_tags=tags,
            )
            
            if result.success:
                created += 1
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

@app.get("/thumbnail/{page_num}")
async def get_thumbnail(page_num: int, session_id: Optional[str] = None):
    """Serve a PNG thumbnail of the specified PDF page (1-based index)."""
    session = _get_session_or_404(session_id)
    pdf_path = session.pdf_path
    cache = session.thumbnail_cache

    if not pdf_path or not os.path.exists(pdf_path):
        raise HTTPException(status_code=404, detail="No active PDF session")

    if page_num < 1:
        raise HTTPException(status_code=400, detail="Page number must be >= 1")

    try:
        reader = PdfReader(pdf_path)
        total_pages = len(reader.pages)
    except Exception as e:
        print(f"Thumbnail page count failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to read PDF page count")

    if page_num > total_pages:
        raise HTTPException(status_code=404, detail="Page out of range")

    # Check cache first
    if page_num in cache:
        return StreamingResponse(io.BytesIO(cache[page_num]), media_type="image/png")

    try:
        def render_page():
            # Convert just the specific page. pdf2image uses 1-based indexing for first_page/last_page
            # 300 DPI is standard, but for thumbnails we can go lower (e.g. 100)
            images = convert_from_path(
                pdf_path,
                first_page=page_num, 
                last_page=page_num,
                dpi=100, 
                size=(400, None) # Limit width to 400px for thumbnails
            )
            if not images:
                return None
            
            img_byte_arr = io.BytesIO()
            images[0].save(img_byte_arr, format='PNG')
            return img_byte_arr.getvalue()

        img_data = await run_in_threadpool(render_page)
        
        if img_data:
            cache[page_num] = img_data
            return StreamingResponse(io.BytesIO(img_data), media_type="image/png")
        else:
            raise HTTPException(status_code=404, detail="Page not found")
    except PDFInfoNotInstalledError:
        raise HTTPException(
            status_code=503,
            detail="Poppler is not installed. Install it to enable thumbnails.",
        )
    except PDFPageCountError as e:
        print(f"Thumbnail page count error: {e}")
        raise HTTPException(status_code=500, detail="Failed to read PDF pages")
    except Exception as e:
        print(f"Thumbnail generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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

