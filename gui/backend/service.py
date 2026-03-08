import asyncio
import logging
import os
import base64
from typing import AsyncGenerator, Dict, List, Any, Optional

from lectern import config
from lectern.lectern_service import LecternGenerationService, ServiceEvent
from lectern.utils.error_handling import capture_exception

class DraftStore:
    def __init__(self, session_id: Optional[str] = None):
        self.session_id = session_id
        self.deck_name = ""
        self.slide_set_name = ""  # NOTE(Tags): Required for hierarchical tagging
        self.model_name = ""
        self.tags = []
        self.entry_id: Optional[str] = None
        self.total_pages: Optional[int] = None
        self.coverage_data: Optional[Dict[str, Any]] = None
        self._cards: List[Dict[str, Any]] = []

    def set_session_id(self, session_id: str) -> None:
        self.session_id = session_id
        self._cards = []

    def set_drafts(
        self, 
        cards: List[Dict[str, Any]], 
        deck_name: str, 
        model_name: str, 
        tags: List[str], 
        entry_id: Optional[str] = None,
        slide_set_name: str = "",  # NOTE(Tags): Pass through for hierarchical tagging
        total_pages: Optional[int] = None,
        coverage_data: Optional[Dict[str, Any]] = None,
    ):
        self.deck_name = deck_name
        self.slide_set_name = slide_set_name
        self.model_name = model_name
        self.tags = tags
        self.total_pages = total_pages
        self.coverage_data = coverage_data
        if entry_id:
            self.entry_id = entry_id
        self._cards = cards
        
    def get_drafts(self):
        return self._cards
        
    def update_draft(self, index: int, card: Dict[str, Any]):
        if 0 <= index < len(self._cards):
            self._cards[index] = card
            return True
        return False
        
    def delete_draft(self, index: int):
        if 0 <= index < len(self._cards):
            self._cards.pop(index)
            return True
        return False

    def replace_drafts(self, cards: List[Dict[str, Any]]):
        """Replaces the entire list of drafts while preserving metadata."""
        self._cards = cards
        return True
        
    def add_card(self, card: Dict[str, Any]):
        self._cards.append(card)

    def set_cards(self, cards: List[Dict[str, Any]]):
        self._cards = cards

    def clear(self):
        self.deck_name = ""
        self.slide_set_name = ""
        self.model_name = ""
        self.tags = []
        self.entry_id = None
        self.total_pages = None
        self.coverage_data = None
        self._cards = []

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
        entry_id: Optional[str] = None,
        focus_prompt: str = "",
        target_card_count: int | None = None,
        session_id: Optional[str] = None,
    ) -> AsyncGenerator[ServiceEvent, None]:
        
        # Clear previous drafts on new run
        self.draft_store.clear()
        
        iterator = self.core.run(
            pdf_path=pdf_path,
            deck_name=deck_name,
            model_name=model_name,
            tags=tags,
            context_deck=context_deck,
            entry_id=entry_id,
            skip_export=True,  # Always skip export in GUI now
            stop_check=lambda: self.stop_requested,
            focus_prompt=focus_prompt,
            target_card_count=target_card_count,
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
                user_msg, _ = capture_exception(e, "Generation iterator")
                return ServiceEvent("error", f"Core error: {user_msg}")

        while True:
            if self.stop_requested:
                yield ServiceEvent("cancelled", "Generation cancelled by user", {})
                break

            # Execute the blocking next() in a thread
            event = await asyncio.to_thread(safe_next)
            
            if event is None:
                break
            
            # Record metadata in draft store on first sight
            if not self.draft_store.deck_name:
                self.draft_store.deck_name = deck_name
                self.draft_store.model_name = model_name
                self.draft_store.tags = tags
                self.draft_store.entry_id = entry_id

            if event.type == "card":
                # Incrementally update draft store for live checkpointing
                card = event.data.get("card")
                if card:
                    self.draft_store.add_card(card)
            elif event.type == "cards_replaced":
                # Sync bulk changes (e.g. from reflection)
                cards = event.data.get("cards")
                if isinstance(cards, list):
                    self.draft_store.set_cards(cards)
            elif event.type == "done":
                # Final capture for draft store when generation completes
                if event.data and isinstance(event.data, dict) and "cards" in event.data:
                    self.draft_store.set_drafts(
                        event.data["cards"],
                        deck_name,
                        model_name,
                        tags,
                        entry_id,
                        slide_set_name=event.data.get("slide_set_name", ""),
                        total_pages=event.data.get("total_pages"),
                        coverage_data=event.data.get("coverage_data"),
                    )
            elif event.type == "step_end":
                # Preserve success/failure in data but make message user-friendly
                if event.data.get("success"):
                    event.message = f"✔ {event.message}"
                # If slide_set_name was resolved, capture it
                if "slide_set_name" in event.data:
                    self.draft_store.slide_set_name = event.data["slide_set_name"]
                if "page_count" in event.data:
                    self.draft_store.total_pages = event.data["page_count"]
                if "coverage_data" in event.data:
                    self.draft_store.coverage_data = event.data["coverage_data"]

            yield event
