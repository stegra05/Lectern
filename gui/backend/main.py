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

from anki_connector import check_connection
import config
from service import GenerationService

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration Models
class ConfigUpdate(BaseModel):
    gemini_api_key: Optional[str] = None
    default_model: Optional[str] = None
    anki_url: Optional[str] = None

@app.get("/health")
async def health_check():
    anki_status = check_connection()
    return {
        "status": "ok",
        "anki_connected": anki_status,
        "gemini_configured": bool(config.GEMINI_API_KEY)
    }

@app.get("/config")
async def get_config():
    return {
        "gemini_model": config.DEFAULT_GEMINI_MODEL,
        "anki_url": config.ANKI_CONNECT_URL,
        "basic_model": config.DEFAULT_BASIC_MODEL,
        "cloze_model": config.DEFAULT_CLOZE_MODEL
    }

@app.post("/generate")
async def generate_cards(
    pdf_file: UploadFile = File(...),
    deck_name: str = Form(...),
    model_name: str = Form(config.DEFAULT_BASIC_MODEL),
    tags: str = Form("[]"),  # JSON string
    context_deck: str = Form("")
):
    service = GenerationService()
    
    # Parse tags from JSON string
    try:
        tags_list = json.loads(tags)
    except:
        tags_list = []

    # Save uploaded file to temp
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        shutil.copyfileobj(pdf_file.file, tmp)
        tmp_path = tmp.name

    async def event_generator():
        try:
            async for event_json in service.run_generation(
                pdf_path=tmp_path,
                deck_name=deck_name,
                model_name=model_name,
                tags=tags_list,
                context_deck=context_deck
            ):
                yield f"{event_json}\n"
        finally:
            # Cleanup temp file
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

# Mount static files (Frontend Build)
# Helper to locate resources in both Dev and PyInstaller modes
def get_resource_path(relative_path):
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.dirname(__file__), relative_path)

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
        if full_path.startswith("api") or full_path.startswith("assets") or full_path == "health" or full_path == "generate" or full_path == "config":
            raise HTTPException(status_code=404)
        return FileResponse(os.path.join(frontend_dist, "index.html"))
else:
    print(f"Warning: Frontend build not found at {frontend_dist}")
