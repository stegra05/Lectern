from fastapi import FastAPI, UploadFile, File, Form, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import json
import time
import asyncio

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "anki_connected": True,
        "gemini_configured": True,
        "backend_ready": True
    }

@app.get("/config")
async def get_config():
    return {
        "gemini_model": "gemini-2.0-flash",
        "anki_url": "http://localhost:8765",
        "basic_model": "Basic",
        "cloze_model": "Cloze",
        "gemini_configured": True
    }

@app.post("/config")
async def post_config(cfg: dict):
    return {"status": "updated", "fields": list(cfg.keys())}

@app.get("/history")
async def get_history():
    return [
        {
            "id": "1",
            "filename": "Lecture_01_Introduction.pdf",
            "deck": "University::Computer Science::ML",
            "timestamp": time.time() - 3600,
            "status": "completed",
            "card_count": 12
        }
    ]

@app.get("/decks")
async def get_decks():
    return {"decks": ["Default", "University::Subject", "University::Subject::Topic"]}

@app.post("/estimate")
async def estimate(pdf_file: UploadFile = File(...)):
    return {
        "page_count": 10,
        "estimated_tokens": 1500,
        "estimated_cost_usd": 0.05,
        "estimated_cards": 15
    }

@app.post("/generate")
async def generate(
    pdf_file: UploadFile = File(...),
    deck_name: str = Form(...),
):
    async def event_generator():
        yield json.dumps({"type": "session_start", "data": {"session_id": "mock_session"}}) + "\n"
        await asyncio.sleep(0.5)
        yield json.dumps({"type": "progress", "message": "Analyzing slides...", "percentage": 10}) + "\n"
        await asyncio.sleep(0.5)
        yield json.dumps({"type": "progress", "message": "Building concept map...", "percentage": 30}) + "\n"
        await asyncio.sleep(0.5)
        
        # Fake cards
        cards = [
            {"fields": {"Front": "What is Supervised Learning?", "Back": "Learning from labeled data."}, "type": "basic"},
            {"fields": {"Front": "The goal of {{c1::Loss Function}} is to {{c2::measure prediction error}}.", "Back": ""}, "type": "cloze"}
        ]
        
        yield json.dumps({"type": "cards_generated", "data": {"cards": cards}}) + "\n"
        yield json.dumps({"type": "done", "message": "Generation complete"}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

@app.get("/drafts")
async def get_drafts(session_id: str):
    return {
        "cards": [
            {"fields": {"Front": "What is Supervised Learning?", "Back": "Learning from labeled data."}, "type": "basic"},
            {"fields": {"Text": "The goal of {{c1::Loss Function}} is to {{c2::measure prediction error}}."}, "type": "cloze"}
        ],
        "session_id": session_id
    }

@app.get("/session/{session_id}")
async def get_session(session_id: str):
    return {
        "pdf_path": "test.pdf",
        "deck_name": "University::Computer Science::ML",
        "cards": [
            {
                "fields": {"Front": "What is Supervised Learning?", "Back": "Learning from labeled data."},
                "type": "basic",
                "anki_note_id": 123456
            },
            {
                "fields": {"Text": "The goal of {{c1::Loss Function}} is to {{c2::measure prediction error}}."},
                "type": "cloze",
                "anki_note_id": 123457
            },
            {
                "fields": {"Front": "What is Overfitting?", "Back": "When a model learns the noise in the training data too well."},
                "type": "basic"
            },
            {
                "fields": {"Front": "Regularization", "Back": "Technique used to prevent overfitting by adding a penalty term."},
                "type": "basic"
            }
        ],
        "concept_map": {"nodes": [], "edges": []},
        "history": [],
        "slide_set_name": "Lecture 01"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
