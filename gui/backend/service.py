import asyncio
import logging
import os
import base64
from typing import AsyncGenerator, Dict, List, Any, Optional

import config
from lectern_service import LecternGenerationService, ServiceEvent
from utils.state import load_state, save_state, StateFile

class DraftStore:
    def __init__(self, session_id: Optional[str] = None):
        self.session_id = session_id
        self.deck_name = ""
        self.slide_set_name = ""  # NOTE(Tags): Required for hierarchical tagging
        self.model_name = ""
        self.tags = []
        self.entry_id: Optional[str] = None
        self._state_cache: Optional[Dict[str, Any]] = None
        self._state_file = StateFile(session_id)

    def set_session_id(self, session_id: str) -> None:
        self.session_id = session_id
        self._state_file = StateFile(session_id)
        self._state_cache = None

    def _load_state(self, refresh: bool = False) -> Optional[Dict[str, Any]]:
        if not self.session_id:
            return None
        if self._state_cache is None or refresh:
            self._state_cache = load_state(self.session_id)
        return self._state_cache

    def _persist_state(self, cards: List[Dict[str, Any]]) -> None:
        state = self._load_state()
        if not state:
            return
        self._state_cache = {
            **state,
            "cards": cards,
            "deck_name": state.get("deck_name", self.deck_name),
            "slide_set_name": state.get("slide_set_name", self.slide_set_name),
            "model_name": state.get("model_name", self.model_name),
            "tags": state.get("tags", self.tags),
            "entry_id": state.get("entry_id", self.entry_id),
        }
        self._state_file.update_cards(cards, **{k: v for k, v in self._state_cache.items() if k != "cards"})

    def set_drafts(
        self, 
        cards: List[Dict[str, Any]], 
        deck_name: str, 
        model_name: str, 
        tags: List[str], 
        entry_id: str = None,
        slide_set_name: str = "",  # NOTE(Tags): Pass through for hierarchical tagging
    ):
        self.deck_name = deck_name
        self.slide_set_name = slide_set_name
        self.model_name = model_name
        self.tags = tags
        if entry_id:
            self.entry_id = entry_id
        self._persist_state(cards)
        
    def get_drafts(self):
        state = self._load_state()
        if state and "cards" in state:
            return state.get("cards", [])
        return []
        
    def update_draft(self, index: int, card: Dict[str, Any]):
        state = self._load_state()
        if not state or "cards" not in state:
            return False
        cards = state.get("cards", [])
        if 0 <= index < len(cards):
            cards[index] = card
            self._persist_state(cards)
            return True
        return False
        
    def delete_draft(self, index: int):
        state = self._load_state()
        if not state or "cards" not in state:
            return False
        cards = state.get("cards", [])
        if 0 <= index < len(cards):
            cards.pop(index)
            self._persist_state(cards)
            return True
        return False
        
    def clear(self):
        self.deck_name = ""
        self.slide_set_name = ""
        self.model_name = ""
        self.tags = []
        self.entry_id = None
        self._state_cache = None

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
        focus_prompt: str = "",
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
            entry_id=entry_id,
            resume=True,
            skip_export=True,  # Always skip export in GUI now
            stop_check=lambda: self.stop_requested,
            focus_prompt=focus_prompt,
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
                yield ServiceEvent("cancelled", "Generation cancelled by user", {}).to_json()
                break

            # Execute the blocking next() in a thread
            event = await asyncio.to_thread(safe_next)
            
            if event is None:
                break
            
            if event.type == "done":
                # Capture cards for draft store when generation completes
                if event.data and isinstance(event.data, dict) and "cards" in event.data:
                    self.draft_store.set_drafts(
                        event.data["cards"],
                        deck_name,
                        model_name,
                        tags,
                        entry_id,
                        slide_set_name=event.data.get("slide_set_name", ""),  # NOTE(Tags): hierarchical tagging
                    )
            elif event.type == "step_end":
                # Preserve success/failure in data but make message user-friendly
                if event.data.get("success"):
                    event.message = f"✔ {event.message}"

            yield event.to_json()
