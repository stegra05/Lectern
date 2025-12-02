from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
import os
import sys
import shutil
import tempfile
import json

# Add parent directory to path to import ankiparse modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
# Add current directory to path to import local modules (service.py)
sys.path.append(os.path.dirname(__file__))

import fitz # type: ignore
import io

from anki_connector import check_connection
import config
from service import GenerationService, DraftStore
from anki_connector import add_note, check_connection, store_media_file
from utils.tags import build_grouped_tags
import base64
from utils.history import HistoryManager
import pdf_parser
from ai_client import LecternAIClient
from ai_common import _compose_multimodal_content

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state for the current session's PDF path
# This allows us to serve thumbnails on demand
CURRENT_SESSION_PDF_PATH: Optional[str] = None
CURRENT_GENERATION_SERVICE: Optional[GenerationService] = None

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
        anki_status = check_connection()
    except Exception as e:
        print(f"Anki connection check failed: {e}")
        anki_status = False
    
    # Safely reload and check Gemini config
    try:
        from importlib import reload
        reload(config)
        gemini_configured = bool(getattr(config, 'GEMINI_API_KEY', None))
    except Exception as e:
        print(f"Config reload failed: {e}")
        # Try to read from environment as fallback
        try:
            import os
            gemini_configured = bool(os.getenv('GEMINI_API_KEY'))
        except:
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
        # Write to .env file in project root
        env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.env"))
        
        # Read existing content
        lines = []
        if os.path.exists(env_path):
            with open(env_path, "r") as f:
                lines = f.readlines()
        
        # Update or append GEMINI_API_KEY
        key_found = False
        new_lines = []
        for line in lines:
            if line.startswith("GEMINI_API_KEY="):
                new_lines.append(f"GEMINI_API_KEY={cfg.gemini_api_key}\n")
                key_found = True
            else:
                new_lines.append(line)
        
        if not key_found:
            if new_lines and not new_lines[-1].endswith('\n'):
                new_lines[-1] += '\n'
            new_lines.append(f"GEMINI_API_KEY={cfg.gemini_api_key}\n")
            
        with open(env_path, "w") as f:
            f.writelines(new_lines)
            
        # Reload config module to reflect changes immediately
        os.environ["GEMINI_API_KEY"] = cfg.gemini_api_key
        from importlib import reload
        reload(config)
        
    return {"status": "updated"}

@app.get("/history")
async def get_history():
    mgr = HistoryManager()
    return mgr.get_all()

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
    # Save uploaded file to temp
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        shutil.copyfileobj(pdf_file.file, tmp)
        tmp_path = tmp.name

    try:
        # Extract text
        pages = pdf_parser.extract_content_from_pdf(tmp_path)
        
        # Convert to dict for ai_common
        pdf_content = [{"text": p.text, "images": p.images} for p in pages]
        
        # Compose content (mimicking a standard request to get realistic input token count)
        # We use a placeholder prompt to represent the instructions
        content = _compose_multimodal_content(pdf_content, "Analyze this PDF.")
        
        # Count tokens using Gemini API
        try:
            client = LecternAIClient()
            token_count = client.count_tokens(content)
        except Exception as e:
            print(f"Gemini token counting failed: {e}")
            # Fallback to heuristic if API fails (e.g. no key)
            total_text = " ".join([p.text for p in pages])
            word_count = len(total_text.split())
            token_count = int(word_count * 1.3)
        
        # Calculate cost ($0.50 per 1M tokens)
        estimated_cost = (token_count / 1_000_000) * 0.50
        
        return {
            "tokens": token_count,
            "cost": estimated_cost
        }
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
    model_name: str = Form(config.DEFAULT_BASIC_MODEL),
    tags: str = Form("[]"),  # JSON string
    context_deck: str = Form("")
):
    global CURRENT_GENERATION_SERVICE
    service = GenerationService()
    CURRENT_GENERATION_SERVICE = service
    
    # Parse tags from JSON string
    try:
        tags_list = json.loads(tags)
    except:
        tags_list = []

    # Manage session PDF
    global CURRENT_SESSION_PDF_PATH
    
    # Cleanup previous session file if it exists and is different
    if CURRENT_SESSION_PDF_PATH and os.path.exists(CURRENT_SESSION_PDF_PATH):
        try:
            os.remove(CURRENT_SESSION_PDF_PATH)
        except Exception as e:
            print(f"Warning: Failed to cleanup previous PDF: {e}")

    # Save uploaded file to temp
    # We use delete=False so it persists for thumbnail generation
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        shutil.copyfileobj(pdf_file.file, tmp)
        tmp_path = tmp.name
        
    CURRENT_SESSION_PDF_PATH = tmp_path

    # Create history entry
    history_mgr = HistoryManager()
    entry_id = history_mgr.add_entry(
        filename=pdf_file.filename,
        deck=deck_name,
        status="draft"
    )

    async def event_generator():
        try:
            async for event_json in service.run_generation(
                pdf_path=tmp_path,
                deck_name=deck_name,
                model_name=model_name,
                tags=tags_list,
                context_deck=context_deck,
                entry_id=entry_id
            ):
                yield f"{event_json}\n"
        except Exception as e:
            yield f'{{"type": "error", "message": "Generation failed: {str(e)}", "timestamp": 0}}\n'
            # If generation fails completely, we might want to keep the PDF for debugging 
            # or cleanup. For now, we keep it for consistency with the session.

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

@app.post("/stop")
async def stop_generation():
    global CURRENT_GENERATION_SERVICE
    if CURRENT_GENERATION_SERVICE:
        CURRENT_GENERATION_SERVICE.stop()
        return {"status": "stopped"}
    return {"status": "no_active_generation"}

# Draft API
@app.get("/drafts")
async def get_drafts():
    store = DraftStore()
    return {"cards": store.get_drafts()}

class DraftUpdate(BaseModel):
    card: dict

@app.put("/drafts/{index}")
async def update_draft(index: int, update: DraftUpdate):
    store = DraftStore()
    success = store.update_draft(index, update.card)
    if not success:
        raise HTTPException(status_code=404, detail="Draft not found")
    return {"status": "updated"}

@app.delete("/drafts/{index}")
async def delete_draft(index: int):
    store = DraftStore()
    success = store.delete_draft(index)
    if not success:
        raise HTTPException(status_code=404, detail="Draft not found")
    return {"status": "deleted"}

@app.post("/drafts/sync")
async def sync_drafts():
    store = DraftStore()
    cards = store.get_drafts()
    
    if not cards:
        return {"created": 0, "failed": 0}
        
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
            try:
                # Media handling
                for media in card.get("media", []) or []:
                    filename = media.get("filename", f"lectern-draft-{idx}.png")
                    data_b64 = media.get("data", "")
                    if data_b64:
                        data_bytes = base64.b64decode(data_b64) if isinstance(data_b64, str) else data_b64
                        store_media_file(filename, data_bytes)

                # Note creation
                card_model = str(card.get("model_name") or model_name).strip()
                lower_model = card_model.lower()
                if lower_model in ("basic", config.DEFAULT_BASIC_MODEL.lower()):
                    card_model = config.DEFAULT_BASIC_MODEL
                elif lower_model in ("cloze", config.DEFAULT_CLOZE_MODEL.lower()):
                    card_model = config.DEFAULT_CLOZE_MODEL
                
                note_fields = {str(k): str(v) for k, v in (card.get("fields") or {}).items()}
                
                ai_tags = [str(t) for t in (card.get("tags") or [])]
                merged_tags = list(dict.fromkeys(ai_tags + tags))
                if config.ENABLE_DEFAULT_TAG and config.DEFAULT_TAG and config.DEFAULT_TAG not in merged_tags:
                    merged_tags.append(config.DEFAULT_TAG)
                
                slide_topic = str(card.get("slide_topic") or "").strip()
                tag_deck_path = deck_name
                if slide_topic:
                    tag_deck_path = f"{deck_name}::{slide_topic}"
                
                final_tags = (
                    build_grouped_tags(tag_deck_path, merged_tags)
                    if getattr(config, "GROUP_TAGS_BY_DECK", False)
                    else merged_tags
                )
                
                note_id = add_note(deck_name, card_model, note_fields, final_tags)
                created += 1
                yield json.dumps({"type": "note_created", "message": f"Created note {note_id}", "data": {"id": note_id}}) + "\n"
                
            except Exception as e:
                failed += 1
                yield json.dumps({"type": "warning", "message": f"Failed to create note: {e}"}) + "\n"
            
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

    return StreamingResponse(sync_generator(), media_type="application/x-ndjson")

@app.get("/thumbnail/{page_num}")
async def get_thumbnail(page_num: int):
    """Serve a PNG thumbnail of the specified PDF page (1-based index)."""
    global CURRENT_SESSION_PDF_PATH
    
    if not CURRENT_SESSION_PDF_PATH or not os.path.exists(CURRENT_SESSION_PDF_PATH):
        raise HTTPException(status_code=404, detail="No active PDF session")
        
    try:
        doc = fitz.open(CURRENT_SESSION_PDF_PATH)
        # page_num is 1-based, fitz is 0-based
        if page_num < 1 or page_num > doc.page_count:
             raise HTTPException(status_code=404, detail="Page out of range")
             
        page = doc.load_page(page_num - 1)
        pix = page.get_pixmap(matrix=fitz.Matrix(0.5, 0.5)) # 0.5 scale for thumbnail
        img_data = pix.tobytes("png")
        
        return StreamingResponse(io.BytesIO(img_data), media_type="image/png")
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

