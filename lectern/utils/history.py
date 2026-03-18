import logging
from typing import List, Dict, Any, Optional

from lectern.utils.database import DatabaseManager

logger = logging.getLogger(__name__)


class HistoryManager:
    def __init__(self):
        self.db = DatabaseManager()

    def get_all(self) -> List[Dict[str, Any]]:
        """Return all history entries, sorted by most recent activity desc."""
        return self.db.get_all_history()

    def add_entry(
        self,
        filename: str,
        deck: str,
        session_id: Optional[str] = None,
        status: str = "draft",
    ) -> str:
        """Create a new history entry and return its ID."""
        return self.db.add_history(filename, deck, session_id, status)

    def update_entry(
        self,
        entry_id: str,
        status: Optional[str] = None,
        card_count: Optional[int] = None,
    ) -> None:
        """Update an existing history entry."""
        self.db.update_history(entry_id, status, card_count)

    def sync_session_state(
        self,
        session_id: str,
        cards: List[Dict[str, Any]],
        status: Optional[str] = None,
        deck_name: Optional[str] = None,
        slide_set_name: Optional[str] = None,
        model_name: Optional[str] = None,
        tags: Optional[List[str]] = None,
        total_pages: Optional[int] = None,
        coverage_data: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Persist session cards, status, and metadata in one transaction."""
        if not session_id:
            return False

        # Update cards and metadata
        success = self.db.update_session_cards(
            session_id=session_id,
            cards=cards,
            deck_name=deck_name,
            slide_set_name=slide_set_name,
            model_name=model_name,
            tags=tags,
            total_pages=total_pages,
            coverage_data=coverage_data,
        )

        # If status or card_count provided, update core record
        if status or cards is not None:
            # Note: We use cards list as source of truth for count if cards provided
            entry = self.db.get_entry_by_session_id(session_id)
            if entry:
                self.db.update_history(
                    entry["id"],
                    status=status,
                    card_count=len(cards) if cards is not None else None,
                )

        return success

    def get_entry(self, entry_id: str) -> Optional[Dict[str, Any]]:
        return self.db.get_entry(entry_id)

    def get_entry_by_session_id(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Find a history entry by its session_id field."""
        return self.db.get_entry_by_session_id(session_id)

    def delete_entry(self, entry_id: str) -> bool:
        """Delete a specific history entry by ID."""
        return self.db.delete_entry(entry_id)

    def delete_entries(self, entry_ids: List[str]) -> int:
        """Delete multiple history entries by ID. Returns count of deleted entries."""
        return self.db.delete_entries(entry_ids)

    def get_entries_by_status(self, status: str) -> List[Dict[str, Any]]:
        """Return all history entries matching the given status."""
        return self.db.get_entries_by_status(status)

    def clear_all(self) -> None:
        """Clear all history entries."""
        self.db.clear_all()

    def update_session_logs(self, session_id: str, logs: List[Dict[str, Any]]) -> bool:
        """Update logs for a session."""
        return self.db.update_session_logs(session_id, logs)

    def update_session_phase(self, session_id: str, phase: str) -> bool:
        """Update the current phase for a session."""
        return self.db.update_session_phase(session_id, phase)

    def recover_interrupted_sessions(self) -> int:
        """Mark stale in-flight draft sessions as interrupted."""
        return self.db.recover_interrupted_sessions()
