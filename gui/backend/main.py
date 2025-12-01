from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import os
import sys

# Add parent directory to path to import ankiparse modules
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

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

class GenerateRequest(BaseModel):
    pdf_path: str
    deck_name: str
    model_name: str = config.DEFAULT_BASIC_MODEL
    tags: List[str] = []
    context_deck: str = ""

@app.get("/health")
async def health_check():
    anki_status = check_connection()
    return {
        "status": "ok",
        "anki_connected": anki_status,
        "gemini_configured": bool(config.GEMINI_API_KEY)
    }

@app.get("/decks")
async def get_decks():
    # Placeholder for deck fetching
    return {"decks": ["Default", "Medicine", "History", "Test Deck"]} 

@app.post("/generate")
async def generate_cards(request: GenerateRequest):
    service = GenerationService()
    
    async def event_generator():
        async for event_json in service.run_generation(
            pdf_path=request.pdf_path,
            deck_name=request.deck_name,
            model_name=request.model_name,
            tags=request.tags,
            context_deck=request.context_deck
        ):
            yield f"{event_json}\n"

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
        if full_path.startswith("api") or full_path.startswith("assets"):
            raise HTTPException(status_code=404)
        return FileResponse(os.path.join(frontend_dist, "index.html"))
else:
    print(f"Warning: Frontend build not found at {frontend_dist}")
