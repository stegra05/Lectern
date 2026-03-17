import sys
import os
import logging
from contextlib import asynccontextmanager
from pathlib import Path

# NOTE(Paths): Use Path.resolve() to handle frozen PyInstaller envs correctly.
_here = Path(__file__).resolve().parent  # gui/backend/
_project_root = _here.parent.parent  # project root
sys.path.insert(0, str(_project_root))
sys.path.insert(0, str(_here))

from lectern.version import __version__

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set
import hashlib
import shutil
import tempfile
import json
import time
import requests
import threading

from cachetools import TTLCache

from lectern.cost_estimator import recompute_estimate
from starlette.concurrency import run_in_threadpool

from lectern.anki_connector import (
    check_connection,
    get_deck_names,
    notes_info,
    update_note_fields,
    delete_notes,
    get_connection_info,
)
from lectern import config
from lectern.config import ConfigManager
from lectern.lectern_service import LecternGenerationService, ServiceEvent
from lectern.utils.note_export import export_card_to_anki
from lectern.utils.history import HistoryManager
from lectern.utils.database import DatabaseManager
from lectern.utils.error_handling import capture_exception
from session import (
    SessionManager,
    SessionState,
    LECTERN_TEMP_PREFIX,
    session_manager,
    _get_session_or_404,
)
from streaming import ndjson_event

# Setup logging
from lectern.utils.path_utils import get_app_data_dir, ensure_app_dirs

ensure_app_dirs()
log_file = get_app_data_dir() / "logs" / "backend.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("lectern.backend")


# Redirect stdout and stderr to capture crashes in PyInstaller
class StreamToLogger:
    def __init__(self, logger, level):
        self.logger = logger
        self.level = level

    def write(self, buf):
        for line in buf.rstrip().splitlines():
            self.logger.log(self.level, line.rstrip())

    def flush(self):
        pass

    def isatty(self):
        return False


sys.stdout = StreamToLogger(logging.getLogger("STDOUT"), logging.INFO)
sys.stderr = StreamToLogger(logging.getLogger("STDERR"), logging.ERROR)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application startup/shutdown lifecycle."""
    yield
    session_manager.shutdown()


app = FastAPI(title="Lectern API", version=__version__, lifespan=lifespan)
session_manager.sweep_orphan_temp_files()

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
    return ndjson_event(event_type, message, data or {})


async def stream_sync_cards(
    cards: List[dict],
    deck_name: str,
    tags: List[str],
    entry_id: Optional[str] = None,
    slide_set_name: str = "",  # NOTE(Tags): Pass through for hierarchical tagging
    allow_updates: bool = False,  # Default to False if not specified
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
                info = notes_info([note_id])
                if info and info[0].get("noteId"):
                    update_note_fields(note_id, card["fields"])
                    updated += 1
                    yield event_json(
                        "note_updated", f"Updated note {note_id}", {"id": note_id}
                    )
                else:
                    success, created_id, error = _export_new_note(card)
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
                success, created_id, error = _export_new_note(card)
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

    if callable(on_complete):
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
            timeout=5,
        )
        if response.status_code == 200:
            data = response.json()
            latest_version = data.get("tag_name", "v0.0.0").lstrip("v")
            release_url = data.get(
                "html_url", "https://github.com/stegra05/Lectern/releases"
            )

            # Simple semver compare (split by dots)
            curr_parts = [int(p) for p in __version__.split(".")]
            late_parts = [int(p) for p in latest_version.split(".")]

            update_available = late_parts > curr_parts

            result: Dict[str, str | bool] = {
                "current": __version__,
                "latest": latest_version,
                "update_available": update_available,
                "release_url": release_url,
            }

            return result
    except Exception as e:
        capture_exception(e, "Version check")

    # Fallback to current only if check fails
    return {
        "current": __version__,
        "latest": None,
        "update_available": False,
        "release_url": "https://github.com/stegra05/Lectern/releases",
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
        capture_exception(e, "Anki health check")
        anki_status = False

    # Safely check Gemini config without reloading the entire module (which is expensive)
    try:
        gemini_configured = bool(config.GEMINI_API_KEY)
    except Exception as e:
        capture_exception(e, "Gemini config check")
        gemini_configured = False

    return {
        "status": "ok",
        "anki_connected": anki_status,
        "gemini_configured": gemini_configured,
        "backend_ready": True,
    }


@app.get("/anki/status")
async def anki_status():
    """Detailed AnkiConnect status with diagnostics."""
    try:
        info = await run_in_threadpool(get_connection_info)
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


@app.get("/config")
async def get_config():
    return {
        "gemini_model": config.DEFAULT_GEMINI_MODEL,
        "anki_url": config.ANKI_CONNECT_URL,
        "basic_model": config.DEFAULT_BASIC_MODEL,
        "cloze_model": config.DEFAULT_CLOZE_MODEL,
        "gemini_configured": bool(config.GEMINI_API_KEY),
    }


@app.post("/config")
async def update_config(cfg: ConfigUpdate):
    updated_fields = []

    # Handle API key separately (Keychain storage)
    if cfg.gemini_api_key:
        try:
            from lectern.utils.keychain_manager import set_gemini_key

            set_gemini_key(cfg.gemini_api_key)
            updated_fields.append("gemini_api_key")
        except Exception as e:
            user_msg, _ = capture_exception(e, "API key update")
            raise HTTPException(status_code=500, detail=user_msg)

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

            anki_info = await run_in_threadpool(get_connection_info)
            if anki_info.get("connected") and anki_info.get(
                "collection_available", False
            ):
                anki_models = await run_in_threadpool(get_model_names)
            else:
                anki_models = []
        except Exception as e:
            capture_exception(e, "Model names fetch")
            anki_models = []
        if anki_models:
            if cfg.basic_model and cfg.basic_model not in anki_models:
                warnings.append(
                    f"Note type '{cfg.basic_model}' not found in Anki — saving anyway."
                )
            if cfg.cloze_model and cfg.cloze_model not in anki_models:
                warnings.append(
                    f"Note type '{cfg.cloze_model}' not found in Anki — saving anyway."
                )

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
            # Use ConfigManager to persist and get live values
            mgr = ConfigManager.instance()
            for key, value in json_updates.items():
                mgr.set(key, value)
        except Exception as e:
            user_msg, _ = capture_exception(e, "Config save")
            raise HTTPException(status_code=500, detail=user_msg)

    # Invalidate the note-export model cache so new values are picked up
    if updated_fields:
        from lectern.utils import note_export as _ne

        _ne._anki_models_cache = None
        _ne._detected_builtins_cache = None
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
        info = await run_in_threadpool(get_connection_info)
        if not info.get("connected") or not info.get("collection_available", False):
            logger.info(
                "Skipping deck list fetch; Anki unavailable (%s).",
                info.get("error") or "unknown reason",
            )
            return {"decks": []}
        decks = await run_in_threadpool(get_deck_names)
        return {"decks": decks}
    except Exception as e:
        logger.warning(f"Deck list fetch failed: {e}")
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
        logger.error(f"Deck creation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/history")
async def clear_history():
    mgr = HistoryManager()
    mgr.clear_all()
    return {"status": "cleared"}


@app.delete("/history/{entry_id}")
async def delete_history_entry(entry_id: str):
    mgr = HistoryManager()
    entry = await run_in_threadpool(mgr.get_entry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    success = await run_in_threadpool(mgr.delete_entry, entry_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete history entry")
    return {"status": "deleted"}


class BatchDeleteRequest(BaseModel):
    ids: Optional[List[str]] = None
    status: Optional[str] = None


# Lock to ensure thread safety for concurrent history modifications
_history_lock = threading.Lock()


def _batch_delete_impl(req_status: Optional[str], req_ids: Optional[List[str]]) -> int:
    with _history_lock:
        mgr = HistoryManager()

        if req_status:
            entries = mgr.get_entries_by_status(req_status)
        elif req_ids:
            entries = [e for e in mgr.get_all() if e["id"] in set(req_ids)]
        else:
            return 0

        entry_ids = [e["id"] for e in entries]
        deleted = mgr.delete_entries(entry_ids)
        return deleted


@app.post("/history/batch-delete")
async def batch_delete_history(req: BatchDeleteRequest):
    if not req.status and not req.ids:
        raise HTTPException(status_code=400, detail="Provide 'ids' or 'status'")

    deleted = await run_in_threadpool(_batch_delete_impl, req.status, req.ids)
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
    target_card_count: Optional[int] = Form(None),
):

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
                target_card_count=target_card_count,
            )
            return data

        # Full path: upload + token count, then cache base data
        service = LecternGenerationService()
        data, base_data = await service.estimate_cost_with_base(
            tmp_path,
            model_name=model_name,
            target_card_count=target_card_count,
        )
        _estimate_base_cache[cache_key] = base_data
        return data
    except Exception as e:
        logger.error(f"Estimation failed: {e}")
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
    target_card_count: Optional[int] = Form(None),
):
    service = LecternGenerationService()

    if focus_prompt:
        logger.info(f"User focus: '{focus_prompt}'")

    try:
        tags_list = json.loads(tags)
    except:
        tags_list = []

    def save_generate_temp():
        with tempfile.NamedTemporaryFile(
            delete=False,
            prefix=LECTERN_TEMP_PREFIX,
            suffix=".pdf",
        ) as tmp:
            shutil.copyfileobj(pdf_file.file, tmp)
            return tmp.name

    tmp_path = await run_in_threadpool(save_generate_temp)

    try:
        uploaded_size = os.fstat(pdf_file.file.fileno()).st_size
    except:
        uploaded_size = -1

    temp_size = os.path.getsize(tmp_path)
    logger.info(
        f"Uploaded file size: {uploaded_size} bytes. Temp file size: {temp_size} bytes. Path: {tmp_path}"
    )

    session = session_manager.create_session(pdf_path=tmp_path)

    history_mgr = HistoryManager()
    entry_id = history_mgr.add_entry(
        filename=pdf_file.filename,
        deck=deck_name,
        session_id=session.session_id,
        status="draft",
    )

    status_handlers = {
        "done": ("completed", True),
        "cancelled": ("cancelled", False),
        "error": ("error", False),
    }

    async def event_generator():
        from typing import Any
        import time
        import json
        import threading
        import queue
        from lectern.snapshot import SnapshotTracker

        session_logs = []

        def emit_event(evt_type: str, message: str, data: Any = None):
            evt = {
                "type": evt_type,
                "message": message,
                "timestamp": int(time.time() * 1000),
            }
            if data is not None:
                evt["data"] = data
            session_logs.append(evt)
            return json.dumps(evt) + "\n"

        yield emit_event(
            "session_start", "Session started", {"session_id": session.session_id}
        )

        # Control-plane: tracks phase/progress, emits lightweight snapshots
        tracker = SnapshotTracker(session_id=session.session_id)

        q = queue.Queue()
        final_cards = []
        final_slide_set_name = "Generation"
        final_total_pages = None
        final_coverage_data = None

        def worker():
            try:
                for event in service.run(
                    pdf_path=tmp_path,
                    deck_name=deck_name,
                    model_name=model_name,
                    tags=tags_list,
                    context_deck=context_deck,
                    focus_prompt=focus_prompt,
                    target_card_count=target_card_count,
                    skip_export=True,
                    stop_check=lambda: (
                        session_manager.get_session(session.session_id).stop_requested
                        if session_manager.get_session(session.session_id)
                        else True
                    ),
                ):
                    q.put(event)
            except Exception as e:
                q.put(e)
            finally:
                q.put(None)

        t = threading.Thread(target=worker, daemon=True)
        t.start()

        while True:
            import asyncio

            # Non-blocking pull from queue to allow async event loop
            try:
                event = q.get_nowait()
            except queue.Empty:
                # Tick the tracker — may emit a timed control_snapshot
                timed_snap = tracker.tick()
                if timed_snap:
                    yield emit_event("control_snapshot", "", timed_snap.to_dict())
                await asyncio.sleep(0.1)
                continue

            if event is None:
                break

            if isinstance(event, Exception):
                session_manager.mark_status(session.session_id, "error")
                yield emit_event("error", f"Generation failed: {str(event)}")
                history_mgr.update_session_logs(session.session_id, session_logs)
                break

            # DATA PLANE: emit the raw event first (real-time feedback)
            yield emit_event(event.type, event.message, event.data)

            # CONTROL PLANE: update tracker state and potentially emit a snapshot
            snap = tracker.process_event(event.type, event.data or {}, event.message)
            if snap:
                yield emit_event("control_snapshot", "", snap.to_dict())

            try:
                event_type = event.type

                if event.data:
                    if "slide_set_name" in event.data:
                        final_slide_set_name = event.data["slide_set_name"]
                    if "total_pages" in event.data:
                        final_total_pages = event.data["total_pages"]
                    if "coverage_data" in event.data:
                        final_coverage_data = event.data["coverage_data"]
                    if "cards" in event.data:
                        final_cards = event.data["cards"]

                if event_type in status_handlers:
                    status, cleanup = status_handlers[event_type]
                    session_manager.mark_status(session.session_id, status)
                    if cleanup:
                        session_manager.cleanup_temp_file(session.session_id)

                    if event_type in ("done", "cancelled", "error"):
                        history_mgr.update_session_logs(
                            session.session_id, session_logs
                        )

                    if (
                        event_type == "done"
                        or event_type == "step_end"
                        or event_type == "cards_replaced"
                    ):
                        history_mgr.sync_session_state(
                            session_id=session.session_id,
                            cards=final_cards,
                            status="completed" if event_type == "done" else None,
                            deck_name=deck_name,
                            slide_set_name=final_slide_set_name,
                            model_name=model_name,
                            tags=tags_list,
                            total_pages=final_total_pages,
                            coverage_data=final_coverage_data,
                        )
            except Exception as e:
                logger.error(f"Error processing event: {e}")

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@app.post("/stop")
async def stop_generation(session_id: str | None = None):
    session = _get_session_or_404(session_id)
    session_manager.stop_session(session.session_id)
    return {"status": "stopped", "session_id": session.session_id}


# Session API (View/Edit Past Sessions)


class SessionCardsUpdate(BaseModel):
    cards: List[dict]


@app.get("/session/{session_id}")
async def get_session(session_id: str):
    db = DatabaseManager()
    entry = db.get_entry_by_session_id(session_id)
    if not entry:
        return {"cards": [], "session_id": session_id, "not_found": True}
    return entry


class AnkiDeleteRequest(BaseModel):
    note_ids: List[int]


@app.delete("/anki/notes")
async def delete_anki_notes(req: AnkiDeleteRequest):
    try:
        delete_notes(req.note_ids)
        return {"status": "deleted", "count": len(req.note_ids)}
    except Exception as e:
        logger.error(f"Failed to delete Anki notes: {e}")
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
        logger.error(f"Failed to update Anki note: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class SyncRequest(BaseModel):
    cards: List[dict]
    deck_name: str
    tags: List[str]
    slide_set_name: str
    allow_updates: bool = False


@app.post("/sync")
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


# Mount static files (Frontend Build)
# In Dev: ../frontend/dist (relative to backend/main.py)
# In Frozen: frontend/dist (relative to sys._MEIPASS root)
if hasattr(sys, "_MEIPASS"):
    frontend_dist = os.path.join(getattr(sys, "_MEIPASS"), "frontend", "dist")
else:
    frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")

if os.path.exists(frontend_dist):
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(frontend_dist, "assets")),
        name="assets",
    )

    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        # Serve index.html for all non-API routes (SPA routing).
        # NOTE(Routing): Dynamically derive API roots from registered routes so we
        # don't have to maintain a manual allowlist whenever a new endpoint is added.
        # NOTE(Typing): Use getattr so static analysers (Pyre2) can resolve .path
        # on BaseRoute without needing a type narrowing guard they can't follow.
        api_roots: Set[str] = {
            getattr(r, "path", "").lstrip("/").split("/")[0]
            for r in app.routes
            if hasattr(r, "methods")
            and getattr(r, "path", None) not in {None, "/", "/{full_path:path}"}
        }
        first_segment = full_path.split("/")[0]
        if first_segment in api_roots or full_path.startswith("assets"):
            raise HTTPException(status_code=404)
        return FileResponse(os.path.join(frontend_dist, "index.html"))

else:
    logger.warning(f"Frontend build not found at {frontend_dist}")
