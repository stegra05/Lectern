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

    def add_entry(self,
                  filename: str,
                  deck: str,
                  session_id: Optional[str] = None,
                  status: str = "draft") -> str:
        """Create a new history entry and return its ID."""
        return self.db.add_history(filename, deck, session_id, status)

    def update_entry(self,
                     entry_id: str,
                     status: Optional[str] = None,
                     card_count: Optional[int] = None) -> None:
        """Update an existing history entry."""
        self.db.update_history(entry_id, status, card_count)

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
