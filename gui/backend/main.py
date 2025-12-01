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
