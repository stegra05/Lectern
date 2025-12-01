import asyncio
import json
import logging
import os
import time
import base64
from typing import AsyncGenerator, Dict, List, Any

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

class GenerationService:
    def __init__(self):
        self.logger = logging.getLogger("lectern.gui")
        self.core = LecternGenerationService()

    async def run_generation(
        self,
        pdf_path: str,
        deck_name: str,
        model_name: str,
        tags: List[str],
        context_deck: str = ""
    ) -> AsyncGenerator[str, None]:
        
        # Create the iterator
        # Note: resume=False for GUI by default as UI doesn't prompt for it yet, 
        # but state is saved so it could be enabled easily.
        # The request was "State/Resume should be supported".
        # Since GUI doesn't have interactive prompt, we can try to resume automatically if state exists?
        # Or just default False until UI supports it. 
        # Let's set resume=True. If no state exists, it proceeds. If state exists, it resumes. 
        # The core service handles the "if path matches" check.
        
        iterator = self.core.run(
            pdf_path=pdf_path,
            deck_name=deck_name,
            model_name=model_name,
            tags=tags,
            context_deck=context_deck,
            resume=True 
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
            # Execute the blocking next() in a thread
            event = await asyncio.to_thread(safe_next)
            
            if event is None:
                break
            
            # Map Core ServiceEvent to GUI ProgressEvent JSON
            
            # GUI Event Types: "status", "info", "warning", "error", "progress_start", "progress_update", "card_generated", "note_created", "done"
            # Core Event Types: 'status', 'info', 'warning', 'error', 'step_start', 'step_end', 'progress_start', 'progress_update', 'card', 'note', 'done'
            
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
                # Adjust message to match old GUI expectation if needed, but core message is fine
            elif event.type == "progress_start":
                gui_type = "progress_start"
            elif event.type == "progress_update":
                gui_type = "progress_update"
            elif event.type == "done":
                gui_type = "done"
            elif event.type == "step_start":
                # Map step start to status
                gui_type = "status"
                gui_msg = f"▶ {event.message}"
            elif event.type == "step_end":
                # Map step end to info or status
                if event.data.get("success"):
                    gui_type = "info"
                    gui_msg = f"✔ {event.message}"
                else:
                    gui_type = "warning"
                    # gui_msg = f"✖ {event.message}" # core might handle text
            
            yield ProgressEvent(gui_type, gui_msg, gui_data).to_json()
