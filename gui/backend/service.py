import asyncio
import json
import logging
import os
import time
import base64
from typing import AsyncGenerator, Dict, List, Any, Optional

import config
from lectern_service import LecternGenerationService, ServiceEvent

# Mocking rich-like events for the GUI
class ProgressEvent:
    def __init__(self, type: str, message: str = "", data: Dict[str, Any] = None):
        self.type = type
        self.message = message
        self.data = data or {}

    def to_json(self):
        return json.dumps({
            "type": self.type,
            "message": self.message,
            "data": self.data,
            "timestamp": time.time()
        })

class DraftStore:
    def __init__(self):
        self.cards = []
        self.deck_name = ""
        self.slide_set_name = ""  # NOTE(Tags): Required for hierarchical tagging
        self.model_name = ""
        self.tags = []
        self.entry_id = None

    def set_drafts(
        self, 
        cards: List[Dict[str, Any]], 
        deck_name: str, 
        model_name: str, 
        tags: List[str], 
        entry_id: str = None,
        slide_set_name: str = "",  # NOTE(Tags): Pass through for hierarchical tagging
    ):
        self.cards = cards
        self.deck_name = deck_name
        self.slide_set_name = slide_set_name
        self.model_name = model_name
        self.tags = tags
        if entry_id:
            self.entry_id = entry_id
        
    def get_drafts(self):
        return self.cards
        
    def update_draft(self, index: int, card: Dict[str, Any]):
        if 0 <= index < len(self.cards):
            self.cards[index] = card
            return True
        return False
        
    def delete_draft(self, index: int):
        if 0 <= index < len(self.cards):
            self.cards.pop(index)
            return True
        return False
        
    def clear(self):
        self.cards = []
        self.deck_name = ""
        self.slide_set_name = ""
        self.model_name = ""
        self.tags = []
        self.entry_id = None

class GenerationService:
    def __init__(self, draft_store: DraftStore):
        self.logger = logging.getLogger("lectern.gui")
        self.core = LecternGenerationService()
        self.draft_store = draft_store
        self.stop_requested = False

    def stop(self):
        self.stop_requested = True

    async def run_generation(
        self,
        pdf_path: str,
        deck_name: str,
        model_name: str,
        tags: List[str],
        context_deck: str = "",
        entry_id: str = None,
        exam_mode: bool = False,
        source_type: str = "auto",  # "auto", "slides", "script"
        density_target: float = config.CARDS_PER_SLIDE_TARGET,  # Detail level
        max_notes_per_batch: int = config.MAX_NOTES_PER_BATCH,
        reflection_rounds: int = config.REFLECTION_MAX_ROUNDS,
        enable_reflection: bool = config.ENABLE_REFLECTION,
        session_id: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        
        # Clear previous drafts on new run
        self.draft_store.clear()
        
        iterator = self.core.run(
            pdf_path=pdf_path,
            deck_name=deck_name,
            model_name=model_name,
            tags=tags,
            context_deck=context_deck,
            resume=True,
            skip_export=True,  # Always skip export in GUI now
            stop_check=lambda: self.stop_requested,
            exam_mode=exam_mode,
            source_type=source_type,
            density_target=density_target,
            max_notes_per_batch=max_notes_per_batch,
            reflection_rounds=reflection_rounds,
            enable_reflection=enable_reflection,
            session_id=session_id,
        )

        # Helper to run next(iterator) in thread
        def safe_next():
            try:
                return next(iterator)
            except StopIteration:
                return None
            except Exception as e:
                # Wrap core errors into a special event if they bubble up
                return ServiceEvent("error", f"Core error: {e}")

        while True:
            if self.stop_requested:
                yield ProgressEvent("cancelled", "Generation cancelled by user", {}).to_json()
                break

            # Execute the blocking next() in a thread
            event = await asyncio.to_thread(safe_next)
            
            if event is None:
                break
            
            # Map Core ServiceEvent to GUI ProgressEvent JSON
            
            gui_type = "status"
            gui_msg = event.message
            gui_data = event.data
            
            if event.type == "error":
                gui_type = "error"
            elif event.type == "warning":
                gui_type = "warning"
            elif event.type == "info":
                gui_type = "info"
            elif event.type == "status":
                gui_type = "status"
            elif event.type == "card":
                gui_type = "card_generated"
            elif event.type == "note":
                gui_type = "note_created"
            elif event.type == "progress_start":
                gui_type = "progress_start"
            elif event.type == "progress_update":
                gui_type = "progress_update"
            elif event.type == "done":
                gui_type = "done"
                # Capture cards for draft store
                if gui_data and "cards" in gui_data:
                    self.draft_store.set_drafts(
                        gui_data["cards"], 
                        deck_name, 
                        model_name, 
                        tags,
                        entry_id,
                        slide_set_name=gui_data.get("slide_set_name", ""),  # NOTE(Tags): Pass through for hierarchical tagging
                    )
            elif event.type == "step_start":
                gui_type = "step_start"
                gui_msg = event.message
            elif event.type == "step_end":
                if event.data.get("success"):
                    gui_type = "info"
                    gui_msg = f"✔ {event.message}"
                else:
                    gui_type = "warning"
            
            yield ProgressEvent(gui_type, gui_msg, gui_data).to_json()
